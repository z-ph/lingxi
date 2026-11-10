import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DANGER_PATTERNS,
  assessDanger,
  createDangerPolicy,
  type DangerPattern,
} from "../src/security/index.js";
import { TOOL_NAMES } from "../src/security/index.js";

const NOTES_APP = "com.example.notes";

function assess(
  node: { text?: string; contentDescription?: string; hint?: string; inputType?: string } | null,
  tool: (typeof TOOL_NAMES)[number] = "tap",
  packages: readonly string[] = [NOTES_APP],
  options: Parameters<typeof createDangerPolicy>[0] = {},
) {
  return assessDanger(createDangerPolicy(options), tool, {}, {
    foregroundPackage: NOTES_APP,
    targetNode: node === null ? null : { packageName: NOTES_APP, ...node },
  }, packages);
}

test("payment, deletion and send targets are dangerous by default", () => {
  const cases: Array<{ text: string; category: string }> = [
    { text: "确认支付", category: "payment" },
    { text: "Delete message", category: "deletion" },
    { text: "发送", category: "send" },
    { text: "发布笔记", category: "send" },
    { text: "PURCHASE", category: "payment" },
    { text: "Clear all", category: "deletion" },
  ];
  for (const item of cases) {
    const assessment = assess({ text: item.text });
    assert.equal(assessment.dangerous, true, item.text);
    assert.ok(
      assessment.reasons.some((reason) => reason.category === item.category),
      `${item.text} should have category ${item.category}`,
    );
  }
});

test("benign targets do not need confirmation", () => {
  const assessment = assess({ text: "打开设置" });
  assert.equal(assessment.dangerous, false);
  assert.deepEqual(assessment.reasons, []);
});

test("labels on contentDescription and hint are considered", () => {
  assert.equal(assess({ contentDescription: "删除" }).dangerous, true);
  assert.equal(assess({ hint: "在此输入发送内容" }).dangerous, true);
});

test("typing into a password field always needs confirmation", () => {
  const byInputType = assess({ inputType: "textPassword" }, "type");
  assert.equal(byInputType.dangerous, true);
  assert.ok(byInputType.reasons.some((reason) => reason.category === "password"));

  const byLabel = assess({ hint: "登录密码" }, "type");
  assert.equal(byLabel.dangerous, true);
  assert.ok(byLabel.reasons.some((reason) => reason.category === "password"));

  assert.equal(assess({ inputType: "text" }, "type").dangerous, false);
  assert.equal(assess({ hint: "登录密码" }, "tap").dangerous, false);
});

test("the password rule can be disabled with trusted device configuration", () => {
  const assessment = assess({ inputType: "textPassword" }, "type", [NOTES_APP], {
    confirmPasswordInput: false,
  });
  assert.equal(assessment.dangerous, false);
});

test("custom patterns replace the built-in patterns", () => {
  const patterns: DangerPattern[] = [
    { id: "custom.transfer", category: "payment", keywords: ["确认转账"] },
  ];
  const assessment = assess({ text: "确认转账" }, "tap", [NOTES_APP], { patterns });
  assert.equal(assessment.dangerous, true);
  assert.equal(assess({ text: "确认支付" }, "tap", [NOTES_APP], { patterns }).dangerous, false);
});

test("per-tool and per-app confirmation policies are enforced", () => {
  const alwaysType = assess(null, "type", [NOTES_APP], { alwaysConfirmTools: ["type"] });
  assert.equal(alwaysType.dangerous, true);
  assert.ok(alwaysType.reasons.some((reason) => reason.ruleId === "policy.tool.type"));

  const alwaysApp = assess({ text: "打开" }, "tap", [NOTES_APP], {
    alwaysConfirmApps: [NOTES_APP],
  });
  assert.equal(alwaysApp.dangerous, true);
  assert.ok(alwaysApp.reasons.some((reason) => reason.category === "app"));

  const otherApp = assess({ text: "打开" }, "tap", ["com.example.other"], {
    alwaysConfirmApps: [NOTES_APP],
  });
  assert.equal(otherApp.dangerous, false);
});

test("duplicate reasons for the same rule and evidence are collapsed", () => {
  const assessment = assess({ text: "支付", contentDescription: "支付" });
  assert.equal(assessment.reasons.filter((reason) => reason.ruleId === "default.payment").length, 1);
});

test("dangerous policy validation rejects malformed configuration", () => {
  assert.throws(() => createDangerPolicy({ patterns: [{ id: " ", category: "payment", keywords: ["x"] }] }), TypeError);
  assert.throws(
    () =>
      createDangerPolicy({
        patterns: [
          { id: "same", category: "payment", keywords: ["x"] },
          { id: "same", category: "payment", keywords: ["y"] },
        ],
      }),
    TypeError,
  );
  assert.throws(() => createDangerPolicy({ patterns: [{ id: "x", category: "payment", keywords: ["  "] }] }), TypeError);
  assert.throws(
    () =>
      createDangerPolicy({
        patterns: [{ id: "x", category: "not-a-category" as never, keywords: ["x"] }],
      }),
    TypeError,
  );
  assert.throws(() => createDangerPolicy({ alwaysConfirmTools: ["not_a_tool" as never] }), TypeError);
  assert.throws(() => createDangerPolicy({ alwaysConfirmApps: ["not a package"] }), TypeError);
});

test("built-in policies are exported and immutable", () => {
  assert.equal(DEFAULT_DANGER_PATTERNS.length >= 3, true);
  assert.equal(Object.isFrozen(DEFAULT_DANGER_PATTERNS), true);
  assert.equal(Object.isFrozen(DEFAULT_DANGER_PATTERNS[0]?.keywords), true);
});

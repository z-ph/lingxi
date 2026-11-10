import assert from "node:assert/strict";
import test from "node:test";

import { ActionTools } from "../src/actions/action-tools.js";
import type { ActionToolsOptions } from "../src/actions/action-tools.js";
import {
  ACTION_FAILURE_CODES,
  type ActionFailure,
  type ActionFailureCode,
  type ActionResult,
} from "../src/actions/errors.js";
import { centerOf } from "../src/actions/effects.js";
import { FakeDevice } from "../src/device/fake-device.js";
import type { FakeAppSpec } from "../src/device/fake-device.js";
import { DeviceError } from "../src/device/types.js";
import {
  BROWSER_PACKAGE,
  NOTES_PACKAGE,
  SETTINGS_PACKAGE,
  createDevice,
  createTools,
  notesApp,
  requireNode,
  startOn,
} from "./support/fixtures.js";

const SHORT: ActionToolsOptions = {
  effectTimeoutMs: 30,
  pollIntervalMs: 5,
  launchTimeoutMs: 120,
};

function expectFailure(
  result: ActionResult<unknown>,
  code: ActionFailureCode,
): ActionFailure {
  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("expected the action to fail");
  }
  assert.equal(result.effect, null);
  assert.equal(result.error.code, code);
  assert.ok(
    ACTION_FAILURE_CODES.includes(result.error.code),
    `unexpected failure code ${result.error.code}`,
  );
  return result;
}

async function centerOfNode(device: FakeDevice, nodeId: string) {
  return centerOf(requireNode(await device.snapshot(), nodeId).bounds);
}

test("tap by nodeId reports the navigation it caused", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device);

  const result = await tools.tap({ nodeId: "new-note" });
  assert.ok(result.ok);
  assert.equal(result.effect.kind, "tap");
  assert.equal(result.effect.target.node?.nodeId, "new-note");
  assert.equal(result.effect.target.node?.text, "New note");
  assert.ok(result.effect.changeCount > 0);
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "node_appeared" && change.nodeId === "editor",
    ),
  );
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "node_disappeared" && change.nodeId === "new-note",
    ),
  );

  const snapshot = await device.snapshot();
  assert.ok(snapshot.nodes.some((node) => node.id === "editor"));
});

test("tap by coordinates reports the resolved node and text change", async () => {
  const device = createDevice();
  startOn(device, SETTINGS_PACKAGE);
  const tools = createTools(device);
  const point = await centerOfNode(device, "wifi");

  const result = await tools.tap(point);
  assert.ok(result.ok);
  assert.equal(result.effect.target.node?.nodeId, "wifi");
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "text_changed" &&
        change.nodeId === "wifi" &&
        change.before === "Wi-Fi: On" &&
        change.after === "Wi-Fi: Off",
    ),
  );
  assert.equal(
    (await device.snapshot()).nodes.find((node) => node.id === "wifi")?.text,
    "Wi-Fi: Off",
  );
});

test("tap on a save button reports the status text that appeared", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE, "editor");
  const tools = createTools(device);

  const result = await tools.tap({ nodeId: "save" });
  assert.ok(result.ok);
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "text_changed" &&
        change.nodeId === "status" &&
        change.after === "Saved",
    ),
  );
});

test("swipe reports bounds changes from scrolling", async () => {
  const device = createDevice();
  startOn(device, SETTINGS_PACKAGE);
  const tools = createTools(device);

  const result = await tools.swipe({
    from: { x: 540, y: 1000 },
    to: { x: 540, y: 700 },
    durationMs: 200,
  });
  assert.ok(result.ok);
  assert.equal(result.effect.kind, "swipe");
  assert.deepEqual(result.effect.gesture, {
    from: { x: 540, y: 1000 },
    to: { x: 540, y: 700 },
    durationMs: 200,
  });
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "bounds_changed" && change.nodeId === "row-1",
    ),
  );
  assert.equal(
    (await device.snapshot()).nodes.find((node) => node.id === "row-1")
      ?.bounds.top,
    20,
  );
});

test("type reports the text that actually landed", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE, "editor");
  const tools = createTools(device);

  const result = await tools.type({
    nodeId: "editor",
    text: "Hello phone",
  });
  assert.ok(result.ok);
  assert.equal(result.effect.kind, "type");
  assert.equal(result.effect.node.nodeId, "editor");
  assert.equal(result.effect.beforeText, "");
  assert.equal(result.effect.afterText, "Hello phone");
  assert.equal(result.effect.submitted, false);
  assert.ok(
    result.effect.changes.some(
      (change) =>
        change.kind === "text_changed" &&
        change.nodeId === "editor" &&
        change.after === "Hello phone",
    ),
  );
  assert.equal(
    (await device.snapshot()).nodes.find((node) => node.id === "editor")
      ?.text,
    "Hello phone",
  );
});

test("type without nodeId uses the focused field", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE, "editor");
  const tools = createTools(device);

  const focusResult = await tools.tap({ nodeId: "editor" });
  assert.ok(focusResult.ok);

  const result = await tools.type({ text: "Focused input" });
  assert.ok(result.ok);
  assert.equal(result.effect.node.nodeId, "editor");
  assert.equal(result.effect.afterText, "Focused input");
});

test("type reports the submit flag and still verifies the text", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE, "editor");
  const tools = createTools(device);

  const result = await tools.type({
    nodeId: "editor",
    text: "Search query",
    submit: true,
  });
  assert.ok(result.ok);
  assert.equal(result.effect.submitted, true);
  assert.equal(result.effect.afterText, "Search query");
});

test("launch_app reports the foreground package and label", async () => {
  const packageDevice = createDevice();
  startOn(packageDevice, BROWSER_PACKAGE);
  const packageTools = createTools(packageDevice);

  const byPackage = await packageTools.launchApp({
    package: SETTINGS_PACKAGE,
  });
  assert.ok(byPackage.ok);
  assert.equal(byPackage.effect.kind, "launch_app");
  assert.equal(byPackage.effect.package, SETTINGS_PACKAGE);
  assert.equal(byPackage.effect.foreground, SETTINGS_PACKAGE);
  assert.equal(byPackage.effect.alreadyForeground, false);
  assert.equal(byPackage.package, SETTINGS_PACKAGE);
  assert.equal(byPackage.foreground, SETTINGS_PACKAGE);
  assert.ok(
    byPackage.effect.changes.some(
      (change) => change.kind === "foreground_changed",
    ),
  );
  assert.equal(
    (await packageDevice.snapshot()).foregroundPackage,
    SETTINGS_PACKAGE,
  );

  const labelDevice = createDevice();
  startOn(labelDevice, BROWSER_PACKAGE);
  const labelTools = createTools(labelDevice);
  const byLabel = await labelTools.launchApp({ label: "settings" });
  assert.ok(byLabel.ok);
  assert.equal(byLabel.effect.package, SETTINGS_PACKAGE);
  assert.equal(byLabel.effect.label, "Settings");
});

test("launch_app on the current app succeeds but reports it", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device);

  const result = await tools.launchApp({ package: NOTES_PACKAGE });
  assert.ok(result.ok);
  assert.equal(result.effect.alreadyForeground, true);
  assert.equal(result.effect.foreground, NOTES_PACKAGE);
});

test("wait_for matches node text, then both text and package", async () => {
  const device = createDevice();
  startOn(device, BROWSER_PACKAGE);
  const tools = createTools(device);
  const searchPoint = await centerOfNode(device, "search");

  // Trigger the delayed navigation directly so wait_for has to poll for it.
  await device.tap(searchPoint);

  const byText = await tools.waitFor({
    nodeText: "Search Results",
    timeoutMs: 500,
  });
  assert.ok(byText.ok);
  assert.equal(byText.effect.kind, "wait_for");
  assert.equal(byText.effect.matched.node?.nodeId, "title");
  assert.equal(byText.effect.matched.node?.text, "Search results");
  assert.equal(byText.effect.matched.package, null);
  assert.equal(byText.matched.node?.text, "Search results");
  assert.ok(byText.elapsedMs >= 0);

  const byBoth = await tools.waitFor({
    nodeText: "search results",
    package: BROWSER_PACKAGE,
    timeoutMs: 200,
  });
  assert.ok(byBoth.ok);
  assert.equal(byBoth.effect.matched.node?.nodeId, "title");
  assert.equal(byBoth.effect.matched.package, BROWSER_PACKAGE);
});

test("wait_for can wait for a delayed foreground package", async () => {
  const device = createDevice();
  startOn(device, BROWSER_PACKAGE);
  const tools = createTools(device);

  await device.launchApp(SETTINGS_PACKAGE);

  const result = await tools.waitFor({
    package: SETTINGS_PACKAGE,
    timeoutMs: 300,
  });
  assert.ok(result.ok);
  assert.equal(result.effect.matched.package, SETTINGS_PACKAGE);
  assert.equal(result.matched.package, SETTINGS_PACKAGE);
});

test("tap failures are typed and never look like success", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  const missing = expectFailure(
    await tools.tap({ nodeId: "no-such-node" }),
    "not_found",
  );
  assert.equal(missing.error.details?.nodeId, "no-such-node");

  const disabled = expectFailure(
    await tools.tap({ nodeId: "disabled-button" }),
    "blocked",
  );
  assert.equal(disabled.error.details?.reason, "disabled");

  const notClickable = expectFailure(
    await tools.tap({ nodeId: "title" }),
    "blocked",
  );
  assert.equal(notClickable.error.details?.reason, "not_clickable");

  const noEffect = expectFailure(
    await tools.tap({ x: 5, y: 5 }),
    "no_effect",
  );
  assert.equal(noEffect.effect, null);
  assert.equal(noEffect.error.details?.point !== undefined, true);

  const outOfBounds = expectFailure(
    await tools.tap({ x: 5000, y: 5 }),
    "blocked",
  );
  assert.equal(outOfBounds.error.details?.reason, "out_of_bounds");
});

test("swipe failures are typed and never look like success", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  const noEffect = expectFailure(
    await tools.swipe({
      from: { x: 540, y: 1000 },
      to: { x: 540, y: 700 },
    }),
    "no_effect",
  );
  assert.equal(noEffect.effect, null);

  const invalid = expectFailure(
    await tools.swipe({
      from: { x: 540, y: 1000 },
      to: { x: 540, y: 700 },
      durationMs: -1,
    }),
    "invalid_argument",
  );
  assert.equal(invalid.error.details?.field, "durationMs");
});

test("type failures are typed and never look like success", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  const noFocus = expectFailure(
    await tools.type({ text: "x" }),
    "not_found",
  );
  assert.equal(noFocus.error.details?.nodeId, null);

  const emptyNodeId = expectFailure(
    await tools.type({ nodeId: "", text: "x" }),
    "not_found",
  );
  assert.equal(emptyNodeId.error.details?.nodeId, null);

  const missing = expectFailure(
    await tools.type({ nodeId: "missing", text: "x" }),
    "not_found",
  );
  assert.equal(missing.error.details?.nodeId, "missing");

  const notEditable = expectFailure(
    await tools.type({ nodeId: "title", text: "x" }),
    "blocked",
  );
  assert.equal(notEditable.error.details?.reason, "not_editable");

  startOn(device, NOTES_PACKAGE, "editor");
  await device.setText("editor", "Hello");
  const unchanged = expectFailure(
    await tools.type({ nodeId: "editor", text: "Hello" }),
    "no_effect",
  );
  assert.equal(unchanged.error.details?.expectedText, "Hello");
  assert.equal(unchanged.error.details?.observedText, "Hello");
});

test("launch_app failures are typed and never look like success", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  const missing = expectFailure(
    await tools.launchApp({ package: "com.example.missing" }),
    "not_found",
  );
  assert.equal(missing.error.details?.package, "com.example.missing");

  const missingLabel = expectFailure(
    await tools.launchApp({ label: "No such app" }),
    "not_found",
  );
  assert.equal(missingLabel.error.details?.label, "No such app");

  device.blockApp(BROWSER_PACKAGE);
  expectFailure(
    await tools.launchApp({ package: BROWSER_PACKAGE }),
    "blocked",
  );

  const slow: FakeAppSpec = {
    package: "com.example.slow",
    label: "Slow",
    initialScreen: "home",
    launchLatencyMs: 200,
    screens: [
      {
        name: "home",
        nodes: [
          {
            id: "title",
            text: "Slow",
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          },
        ],
      },
    ],
  };
  device.addApp(slow);
  const timeout = expectFailure(
    await tools.launchApp({ package: "com.example.slow" }),
    "timeout",
  );
  assert.equal(timeout.error.details?.package, "com.example.slow");
});

test("launch_app reports an ambiguous label as invalid input", async () => {
  const device = createDevice();
  device.addApp({ ...notesApp, package: "com.example.notes.clone" });
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device);

  const ambiguous = expectFailure(
    await tools.launchApp({ label: "Notes" }),
    "invalid_argument",
  );
  assert.deepEqual(ambiguous.error.details?.packages, [
    "com.example.notes",
    "com.example.notes.clone",
  ]);
});

test("wait_for failures are typed and never look like success", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  const timedOutText = expectFailure(
    await tools.waitFor({ nodeText: "Never appears", timeoutMs: 30 }),
    "timeout",
  );
  assert.equal(timedOutText.error.details?.nodeText, "Never appears");

  const timedOutPackage = expectFailure(
    await tools.waitFor({
      package: SETTINGS_PACKAGE,
      timeoutMs: 30,
    }),
    "timeout",
  );
  assert.equal(
    timedOutPackage.error.details?.package,
    SETTINGS_PACKAGE,
  );

  expectFailure(
    await tools.waitFor({ timeoutMs: 30 }),
    "invalid_argument",
  );
  expectFailure(
    await tools.waitFor({ nodeText: "x", timeoutMs: -1 }),
    "invalid_argument",
  );
});

test("invalid arguments are rejected explicitly for every tool", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE);
  const tools = createTools(device, SHORT);

  expectFailure(await tools.tap({}), "invalid_argument");
  expectFailure(await tools.tap({ x: 10 }), "invalid_argument");
  expectFailure(
    await tools.swipe({
      from: { x: 5, y: 5 },
      to: { x: Number.NaN, y: 6 },
    }),
    "invalid_argument",
  );
  expectFailure(
    await tools.type({ text: 42 as unknown as string }),
    "invalid_argument",
  );
  expectFailure(await tools.launchApp({}), "invalid_argument");
  expectFailure(
    await tools.waitFor({ nodeText: "", timeoutMs: 30 }),
    "invalid_argument",
  );

  assert.throws(
    () => new ActionTools(device, { effectTimeoutMs: -1 }),
    RangeError,
  );
  assert.throws(
    () => new ActionTools(device, { pollIntervalMs: 0 }),
    RangeError,
  );
  assert.throws(
    () => new ActionTools(device, { launchTimeoutMs: -1 }),
    RangeError,
  );
});

test("permission failures are typed permission_denied for UI and launch actions", async () => {
  const uiDevice = createDevice();
  startOn(uiDevice, NOTES_PACKAGE);
  uiDevice.denyPermission("accessibility");
  const uiTools = createTools(uiDevice, SHORT);

  expectFailure(
    await uiTools.tap({ nodeId: "new-note" }),
    "permission_denied",
  );
  expectFailure(
    await uiTools.swipe({
      from: { x: 540, y: 1000 },
      to: { x: 540, y: 700 },
    }),
    "permission_denied",
  );
  expectFailure(
    await uiTools.type({ text: "x" }),
    "permission_denied",
  );
  expectFailure(
    await uiTools.waitFor({ nodeText: "Notes", timeoutMs: 30 }),
    "permission_denied",
  );

  const launchDevice = createDevice();
  startOn(launchDevice, NOTES_PACKAGE);
  launchDevice.denyPermission("launch_apps");
  const launchTools = createTools(launchDevice, SHORT);
  const denied = expectFailure(
    await launchTools.launchApp({ package: SETTINGS_PACKAGE }),
    "permission_denied",
  );
  assert.equal(denied.error.details?.permission, "launch_apps");
});

test("device-side failures during dispatch are mapped to typed failures", async () => {
  const device = createDevice();
  startOn(device, NOTES_PACKAGE, "editor");

  const flaky = new ActionTools(
    {
      snapshot: () => device.snapshot(),
      screenSize: () => device.screenSize(),
      listApps: () => device.listApps(),
      hasPermission: () => device.hasPermission("accessibility"),
      tap: async () => {
        throw new DeviceError("blocked", "Accessibility blocked the tap");
      },
      swipe: async () => {
        throw new DeviceError("blocked", "Accessibility blocked the swipe");
      },
      setText: async () => {
        throw new DeviceError("permission_denied", "IME is not available");
      },
      pressEnter: async () => undefined,
      launchApp: async () => {
        throw new DeviceError("blocked", "launch blocked");
      },
    },
    SHORT,
  );

  const tapFailure = expectFailure(
    await flaky.tap({ nodeId: "editor" }),
    "blocked",
  );
  assert.equal(tapFailure.error.details?.deviceCode, "blocked");

  expectFailure(await flaky.type({ nodeId: "editor", text: "x" }), "permission_denied");
});

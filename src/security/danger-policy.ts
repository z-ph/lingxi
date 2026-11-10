import { normalizeAppPackage } from "./allowlist.js";
import type {
  DangerAssessment,
  DangerCategory,
  DangerReason,
  TargetNode,
  ToolCallContext,
  ToolName,
} from "./types.js";
import { isToolName } from "./types.js";

export interface DangerPattern {
  readonly id: string;
  readonly category: DangerCategory;
  readonly keywords: readonly string[];
  readonly description?: string;
}

export interface DangerPolicyOptions {
  /** Replaces the built-in patterns when supplied. Device-provided configuration. */
  readonly patterns?: readonly DangerPattern[];
  /** Every invocation of these tools needs on-device confirmation. */
  readonly alwaysConfirmTools?: readonly ToolName[];
  /** Every call touching these apps needs on-device confirmation. */
  readonly alwaysConfirmApps?: readonly string[];
  /** Require confirmation when typing into a password field (default: true). */
  readonly confirmPasswordInput?: boolean;
}

export interface DangerPolicy {
  readonly patterns: readonly DangerPattern[];
  readonly alwaysConfirmTools: ReadonlySet<ToolName>;
  readonly alwaysConfirmApps: ReadonlySet<string>;
  readonly confirmPasswordInput: boolean;
}

const DANGER_CATEGORIES: ReadonlySet<DangerCategory> = new Set([
  "payment",
  "deletion",
  "send",
  "password",
  "configured",
  "app",
]);

/**
 * Built-in policies for the three destructive classes in docs/security.md:
 * payments, deletions and sending. Matching is a substring match against the
 * targeted node's visible label; false positives only cost one confirmation.
 */
export const DEFAULT_DANGER_PATTERNS: readonly DangerPattern[] = Object.freeze([
  Object.freeze({
    id: "default.payment",
    category: "payment" as const,
    keywords: Object.freeze([
      "支付",
      "付款",
      "购买",
      "下单",
      "转账",
      "确认支付",
      "立即支付",
      "pay",
      "purchase",
      "checkout",
    ]),
    description: "支付 / 购买 / 转账",
  }),
  Object.freeze({
    id: "default.deletion",
    category: "deletion" as const,
    keywords: Object.freeze([
      "删除",
      "清空",
      "清除",
      "卸载",
      "移除",
      "delete",
      "remove",
      "uninstall",
      "erase",
      "clear",
    ]),
    description: "删除 / 清空 / 卸载",
  }),
  Object.freeze({
    id: "default.send",
    category: "send" as const,
    keywords: Object.freeze([
      "发送",
      "发布",
      "分享",
      "提交订单",
      "send",
      "publish",
      "post",
      "share",
    ]),
    description: "发送 / 发布 / 分享",
  }),
]);

function freezePolicy(
  patterns: readonly DangerPattern[],
  alwaysConfirmTools: ReadonlySet<ToolName>,
  alwaysConfirmApps: ReadonlySet<string>,
  confirmPasswordInput: boolean,
): DangerPolicy {
  return Object.freeze({
    patterns: Object.freeze([...patterns]),
    alwaysConfirmTools,
    alwaysConfirmApps,
    confirmPasswordInput,
  });
}

/**
 * Build a validated, immutable-danger policy. This is device-side configuration:
 * the model has no tool that can replace or relax it.
 */
export function createDangerPolicy(options: DangerPolicyOptions = {}): DangerPolicy {
  const sourcePatterns = options.patterns ?? DEFAULT_DANGER_PATTERNS;
  const seenIds = new Set<string>();
  const patterns: DangerPattern[] = sourcePatterns.map((pattern) => {
    const id = pattern.id.trim();
    if (id.length === 0) {
      throw new TypeError("danger pattern id must not be empty");
    }
    if (seenIds.has(id)) {
      throw new TypeError(`duplicate danger pattern id: ${id}`);
    }
    seenIds.add(id);
    if (!DANGER_CATEGORIES.has(pattern.category)) {
      throw new TypeError(`invalid danger category for ${id}: ${pattern.category}`);
    }
    const keywords = pattern.keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0);
    if (keywords.length === 0) {
      throw new TypeError(`danger pattern ${id} must have at least one keyword`);
    }
    return Object.freeze({
      id,
      category: pattern.category,
      keywords: Object.freeze(keywords),
      ...(pattern.description === undefined ? {} : { description: pattern.description }),
    });
  });

  const alwaysConfirmTools = new Set<ToolName>();
  for (const tool of options.alwaysConfirmTools ?? []) {
    if (!isToolName(tool)) {
      throw new TypeError(`unknown tool in alwaysConfirmTools: ${String(tool)}`);
    }
    alwaysConfirmTools.add(tool);
  }

  const alwaysConfirmApps = new Set<string>();
  for (const packageName of options.alwaysConfirmApps ?? []) {
    alwaysConfirmApps.add(normalizeAppPackage(packageName));
  }

  return freezePolicy(patterns, alwaysConfirmTools, alwaysConfirmApps, options.confirmPasswordInput ?? true);
}

function addReason(reasons: DangerReason[], reason: DangerReason): void {
  if (!reasons.some((existing) => existing.ruleId === reason.ruleId && existing.evidence === reason.evidence)) {
    reasons.push(Object.freeze(reason));
  }
}

function nodeLabels(node: TargetNode | null | undefined): string[] {
  if (node === null || node === undefined) {
    return [];
  }
  const values = [node.text, node.contentDescription, node.hint];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function hasPasswordLabel(node: TargetNode): boolean {
  const inputType = (node.inputType ?? "").toLowerCase();
  if (inputType.includes("password") || inputType.includes("passwd")) {
    return true;
  }
  const labels = nodeLabels(node).join("\n").toLowerCase();
  return /密码|口令|password|passcode|\bpin\b/.test(labels);
}

/**
 * Evaluate the dangerous-action policy for one call.
 *
 * Detection uses trusted context (`targetNode`, app packages), never arbitrary
 * screen text treated as an instruction. UI text is data: it can cause a
 * confirmation, but never an automatic approval.
 */
export function assessDanger(
  policy: DangerPolicy,
  tool: ToolName,
  _args: Readonly<Record<string, unknown>>,
  context: ToolCallContext,
  appPackages: readonly string[],
): DangerAssessment {
  const reasons: DangerReason[] = [];

  if (policy.alwaysConfirmTools.has(tool)) {
    addReason(reasons, {
      ruleId: `policy.tool.${tool}`,
      category: "configured",
      message: `工具 ${tool} 被配置为每次调用都需要设备端确认`,
      evidence: tool,
    });
  }

  for (const packageName of appPackages) {
    if (policy.alwaysConfirmApps.has(packageName)) {
      addReason(reasons, {
        ruleId: `policy.app.${packageName}`,
        category: "app",
        message: `App ${packageName} 被配置为需要设备端确认`,
        evidence: packageName,
      });
    }
  }

  const node = context.targetNode ?? null;
  const labels = nodeLabels(node);
  const loweredLabels = labels.map((label) => label.toLowerCase());
  for (const pattern of policy.patterns) {
    const matchedKeyword = pattern.keywords.find((keyword) => {
      const lowered = keyword.toLowerCase();
      return loweredLabels.some((label) => label.includes(lowered));
    });
    if (matchedKeyword !== undefined) {
      addReason(reasons, {
        ruleId: pattern.id,
        category: pattern.category,
        message: `目标命中危险动作“${pattern.description ?? pattern.category}”（${matchedKeyword}）`,
        evidence: matchedKeyword,
      });
    }
  }

  if (policy.confirmPasswordInput && tool === "type" && node !== null && hasPasswordLabel(node)) {
    addReason(reasons, {
      ruleId: "default.password-input",
      category: "password",
      message: "向密码框输入需要设备端确认",
      evidence: node.inputType ?? node.hint ?? node.text,
    });
  }

  return Object.freeze({
    dangerous: reasons.length > 0,
    reasons: Object.freeze(reasons),
  });
}

/**
 * The five write/read tools whose effect must be observable:
 * `tap`, `swipe`, `type`, `launch_app` and `wait_for`.
 *
 * Each method captures a snapshot before dispatching, polls the device for a
 * real change afterwards, and returns the observed effect. Failures are typed
 * and explicit; a dispatched action with no observable result is a
 * `no_effect` failure, never a silent success.
 */

import { DeviceError } from "../device/types.js";
import type {
  AppInfo,
  Device,
  DevicePermission,
  Point,
  Size,
  UiNode,
} from "../device/types.js";
import {
  centerOf,
  findNodeByText,
  nodeAt,
  toNodeRef,
  waitForForeground,
  waitForObservation,
  waitForTextEntry,
  waitForUiChange,
} from "./effects.js";
import type { NodeRef, UiChange } from "./effects.js";
import { actionFailure, actionSuccess } from "./errors.js";
import type {
  ActionFailure,
  ActionSuccess,
  ActionResult,
} from "./errors.js";

const DEFAULT_EFFECT_TIMEOUT_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LAUNCH_TIMEOUT_MS = 5000;
const DEFAULT_SWIPE_DURATION_MS = 300;

export interface TapInput {
  readonly nodeId?: string;
  readonly x?: number;
  readonly y?: number;
}

export interface SwipeInput {
  readonly from: Point;
  readonly to: Point;
  readonly durationMs?: number;
}

export interface TypeInput {
  readonly nodeId?: string;
  readonly text: string;
  readonly submit?: boolean;
}

export interface LaunchAppInput {
  readonly package?: string;
  readonly label?: string;
}

export interface WaitForInput {
  readonly nodeText?: string;
  readonly package?: string;
  readonly timeoutMs: number;
}

export interface ActionToolsOptions {
  /** Window for tap/swipe/type to produce an observable change. */
  readonly effectTimeoutMs?: number;
  /** Delay between effect snapshots. */
  readonly pollIntervalMs?: number;
  /** Window for `launch_app` to bring the package to the foreground. */
  readonly launchTimeoutMs?: number;
}

export interface TapEffect {
  readonly kind: "tap";
  readonly target: {
    /** Node under the tap, when it can be identified. */
    readonly node: NodeRef | null;
    readonly point: Point;
  };
  readonly changes: readonly UiChange[];
  readonly changeCount: number;
  readonly elapsedMs: number;
}

export interface SwipeEffect {
  readonly kind: "swipe";
  readonly gesture: {
    readonly from: Point;
    readonly to: Point;
    readonly durationMs: number;
  };
  readonly changes: readonly UiChange[];
  readonly changeCount: number;
  readonly elapsedMs: number;
}

export interface TypeEffect {
  readonly kind: "type";
  readonly node: NodeRef;
  readonly beforeText: string;
  readonly afterText: string | null;
  readonly submitted: boolean;
  readonly changes: readonly UiChange[];
  readonly changeCount: number;
  readonly elapsedMs: number;
}

export interface LaunchAppEffect {
  readonly kind: "launch_app";
  readonly package: string;
  readonly label: string;
  readonly foreground: string;
  /** True when the package was already in the foreground before the call. */
  readonly alreadyForeground: boolean;
  readonly changes: readonly UiChange[];
  readonly changeCount: number;
  readonly elapsedMs: number;
}

export interface WaitForMatch {
  /** Matched node when `nodeText` was requested, otherwise null. */
  readonly node: NodeRef | null;
  /** Foreground package when `package` was requested, otherwise null. */
  readonly package: string | null;
}

export interface WaitForEffect {
  readonly kind: "wait_for";
  readonly matched: WaitForMatch;
  readonly elapsedMs: number;
}

export type TapResult = ActionResult<TapEffect>;
export type SwipeResult = ActionResult<SwipeEffect>;
export type TypeResult = ActionResult<TypeEffect>;
export type LaunchAppResult =
  | (ActionSuccess<LaunchAppEffect> & {
      readonly package: string;
      readonly foreground: string;
    })
  | ActionFailure;
export type WaitForResult =
  | (ActionSuccess<WaitForEffect> & {
      readonly matched: WaitForMatch;
      readonly elapsedMs: number;
    })
  | ActionFailure;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { x?: unknown; y?: unknown };
  return isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y);
}

function insideScreen(point: Point, size: Size): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < size.width &&
    point.y < size.height
  );
}

function formatPoint(point: Point): string {
  return `(${point.x}, ${point.y})`;
}

function describeWaitCondition(
  nodeText: string | undefined,
  packageName: string | undefined,
): string {
  const parts: string[] = [];
  if (nodeText !== undefined) {
    parts.push(`node text containing ${JSON.stringify(nodeText)}`);
  }
  if (packageName !== undefined) {
    parts.push(`foreground package ${packageName}`);
  }
  return parts.join(" and ");
}

export class ActionTools {
  private readonly device: Device;
  private readonly effectTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly launchTimeoutMs: number;

  constructor(device: Device, options: ActionToolsOptions = {}) {
    const effectTimeoutMs = options.effectTimeoutMs ?? DEFAULT_EFFECT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;

    if (!isFiniteNumber(effectTimeoutMs) || effectTimeoutMs < 0) {
      throw new RangeError("effectTimeoutMs must be a non-negative number");
    }
    if (!isFiniteNumber(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new RangeError("pollIntervalMs must be a positive number");
    }
    if (!isFiniteNumber(launchTimeoutMs) || launchTimeoutMs < 0) {
      throw new RangeError("launchTimeoutMs must be a non-negative number");
    }

    this.device = device;
    this.effectTimeoutMs = effectTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.launchTimeoutMs = launchTimeoutMs;
  }

  async tap(input: TapInput): Promise<TapResult> {
    if (input.nodeId !== undefined && typeof input.nodeId !== "string") {
      return actionFailure(
        "invalid_argument",
        "tap nodeId must be a string",
        { field: "nodeId" },
      );
    }

    const hasNodeId =
      typeof input.nodeId === "string" && input.nodeId.length > 0;
    const hasCoordinates = isFiniteNumber(input.x) && isFiniteNumber(input.y);

    if (!hasNodeId && !hasCoordinates) {
      const partialCoordinates =
        input.x !== undefined || input.y !== undefined;
      return actionFailure(
        "invalid_argument",
        partialCoordinates
          ? "tap requires both x and y when no nodeId is given"
          : "tap requires nodeId or x,y",
        { nodeId: input.nodeId ?? null, x: input.x ?? null, y: input.y ?? null },
      );
    }

    const permissionFailure = await this.requirePermission("accessibility");
    if (permissionFailure !== null) {
      return permissionFailure;
    }

    const before = await this.device.snapshot();
    let point: Point;
    let target: NodeRef | null = null;

    if (hasNodeId) {
      const nodeId = input.nodeId as string;
      const node = before.nodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) {
        return actionFailure(
          "not_found",
          `tap target node ${nodeId} is not on the current screen`,
          { nodeId, foreground: before.foregroundPackage },
        );
      }
      if (!node.enabled) {
        return actionFailure(
          "blocked",
          `tap target node ${nodeId} is disabled`,
          { nodeId, reason: "disabled" },
        );
      }
      if (!node.clickable) {
        return actionFailure(
          "blocked",
          `tap target node ${nodeId} is not clickable`,
          { nodeId, reason: "not_clickable" },
        );
      }
      point = centerOf(node.bounds);
      target = toNodeRef(node);
    } else {
      point = { x: input.x as number, y: input.y as number };
      const node = nodeAt(before.nodes, point);
      if (node !== undefined) {
        target = toNodeRef(node);
      }
    }

    const size = await this.device.screenSize();
    if (!insideScreen(point, size)) {
      return actionFailure(
        "blocked",
        `tap target ${formatPoint(point)} is outside the ${size.width}x${size.height} screen`,
        {
          point,
          nodeId: input.nodeId ?? null,
          reason: "out_of_bounds",
        },
      );
    }

    const dispatchFailure = await this.dispatch(() => this.device.tap(point));
    if (dispatchFailure !== null) {
      return dispatchFailure;
    }

    const observed = await waitForUiChange(
      this.device,
      before,
      this.effectWaitOptions(),
    );
    if (observed === null) {
      return actionFailure(
        "no_effect",
        `tap at ${formatPoint(point)} produced no observable UI change within ${this.effectTimeoutMs}ms`,
        {
          point,
          nodeId: input.nodeId ?? null,
          timeoutMs: this.effectTimeoutMs,
        },
      );
    }

    return actionSuccess({
      kind: "tap",
      target: { node: target, point },
      changes: observed.changes,
      changeCount: observed.changeCount,
      elapsedMs: observed.elapsedMs,
    });
  }

  async swipe(input: SwipeInput): Promise<SwipeResult> {
    if (!isPoint(input.from) || !isPoint(input.to)) {
      return actionFailure(
        "invalid_argument",
        "swipe requires finite from and to points",
        {
          from: isPoint(input.from) ? input.from : null,
          to: isPoint(input.to) ? input.to : null,
        },
      );
    }

    const durationMs = input.durationMs ?? DEFAULT_SWIPE_DURATION_MS;
    if (!isFiniteNumber(durationMs) || durationMs < 0) {
      return actionFailure(
        "invalid_argument",
        "swipe durationMs must be a non-negative number",
        { field: "durationMs", value: input.durationMs ?? null },
      );
    }

    const permissionFailure = await this.requirePermission("accessibility");
    if (permissionFailure !== null) {
      return permissionFailure;
    }

    const size = await this.device.screenSize();
    if (!insideScreen(input.from, size) || !insideScreen(input.to, size)) {
      return actionFailure(
        "blocked",
        `swipe points must be inside the ${size.width}x${size.height} screen`,
        {
          from: input.from,
          to: input.to,
          reason: "out_of_bounds",
        },
      );
    }

    const before = await this.device.snapshot();
    const dispatchFailure = await this.dispatch(() =>
      this.device.swipe(input.from, input.to, durationMs),
    );
    if (dispatchFailure !== null) {
      return dispatchFailure;
    }

    const observed = await waitForUiChange(
      this.device,
      before,
      this.effectWaitOptions(),
    );
    if (observed === null) {
      return actionFailure(
        "no_effect",
        `swipe from ${formatPoint(input.from)} to ${formatPoint(input.to)} produced no observable UI change within ${this.effectTimeoutMs}ms`,
        {
          from: input.from,
          to: input.to,
          timeoutMs: this.effectTimeoutMs,
        },
      );
    }

    return actionSuccess({
      kind: "swipe",
      gesture: {
        from: input.from,
        to: input.to,
        durationMs,
      },
      changes: observed.changes,
      changeCount: observed.changeCount,
      elapsedMs: observed.elapsedMs,
    });
  }

  async type(input: TypeInput): Promise<TypeResult> {
    if (typeof input.text !== "string") {
      return actionFailure(
        "invalid_argument",
        "type text must be a string",
        { field: "text" },
      );
    }
    if (input.nodeId !== undefined && typeof input.nodeId !== "string") {
      return actionFailure(
        "invalid_argument",
        "type nodeId must be a string",
        { field: "nodeId" },
      );
    }
    if (input.submit !== undefined && typeof input.submit !== "boolean") {
      return actionFailure(
        "invalid_argument",
        "type submit must be a boolean",
        { field: "submit" },
      );
    }

    const permissionFailure = await this.requirePermission("accessibility");
    if (permissionFailure !== null) {
      return permissionFailure;
    }

    const requestedNodeId =
      input.nodeId !== undefined && input.nodeId.length > 0
        ? input.nodeId
        : undefined;
    const before = await this.device.snapshot();
    const target = this.resolveTypeTarget(before.nodes, requestedNodeId);
    if (target === null) {
      return actionFailure(
        "not_found",
        requestedNodeId === undefined
          ? "type found no focused editable node; pass nodeId or focus a field first"
          : `type target node ${requestedNodeId} is not on the current screen`,
        {
          nodeId: requestedNodeId ?? null,
          foreground: before.foregroundPackage,
        },
      );
    }
    if (!target.enabled) {
      return actionFailure(
        "blocked",
        `type target node ${target.id} is disabled`,
        { nodeId: target.id, reason: "disabled" },
      );
    }
    if (!target.editable) {
      return actionFailure(
        "blocked",
        `type target node ${target.id} is not editable`,
        { nodeId: target.id, reason: "not_editable" },
      );
    }

    const submitted = input.submit === true;
    const dispatchFailure = await this.dispatch(async () => {
      await this.device.setText(target.id, input.text);
      if (submitted) {
        await this.device.pressEnter();
      }
    });
    if (dispatchFailure !== null) {
      return dispatchFailure;
    }

    const observed = await waitForTextEntry(
      this.device,
      before,
      target.id,
      {
        ...this.effectWaitOptions(),
        expectedText: input.text,
        submitted,
      },
    );
    if (observed === null) {
      const lastObservation = await this.device.snapshot();
      const observedText =
        lastObservation.nodes.find((node) => node.id === target.id)?.text ??
        null;
      return actionFailure(
        "no_effect",
        `type did not show ${JSON.stringify(input.text)} in node ${target.id} within ${this.effectTimeoutMs}ms`,
        {
          nodeId: target.id,
          expectedText: input.text,
          observedText,
          submitted,
          timeoutMs: this.effectTimeoutMs,
        },
      );
    }

    return actionSuccess({
      kind: "type",
      node: toNodeRef(target),
      beforeText: target.text,
      afterText: observed.afterText,
      submitted,
      changes: observed.changes,
      changeCount: observed.changeCount,
      elapsedMs: observed.elapsedMs,
    });
  }

  async launchApp(input: LaunchAppInput): Promise<LaunchAppResult> {
    if (input.package !== undefined && typeof input.package !== "string") {
      return actionFailure(
        "invalid_argument",
        "launch_app package must be a string",
        { field: "package" },
      );
    }
    if (input.label !== undefined && typeof input.label !== "string") {
      return actionFailure(
        "invalid_argument",
        "launch_app label must be a string",
        { field: "label" },
      );
    }

    const requestedPackage = input.package?.trim();
    const requestedLabel = input.label?.trim();
    if (!requestedPackage && !requestedLabel) {
      return actionFailure(
        "invalid_argument",
        "launch_app requires package or label",
        { package: input.package ?? null, label: input.label ?? null },
      );
    }

    const permissionFailure = await this.requirePermission("launch_apps");
    if (permissionFailure !== null) {
      return permissionFailure;
    }

    const apps = await this.device.listApps();
    const resolved = this.resolveApp(apps, requestedPackage, requestedLabel);
    if ("error" in resolved) {
      return resolved.error;
    }
    const app = resolved.app;

    const before = await this.device.snapshot();
    const alreadyForeground = before.foregroundPackage === app.package;
    const dispatchFailure = await this.dispatch(() =>
      this.device.launchApp(app.package),
    );
    if (dispatchFailure !== null) {
      return dispatchFailure;
    }

    const observed = await waitForForeground(
      this.device,
      before,
      app.package,
      {
        timeoutMs: this.launchTimeoutMs,
        pollIntervalMs: this.pollIntervalMs,
      },
    );
    if (observed === null) {
      const lastObservation = await this.device.snapshot();
      return actionFailure(
        "timeout",
        `launch_app did not bring ${app.package} to the foreground within ${this.launchTimeoutMs}ms`,
        {
          package: app.package,
          timeoutMs: this.launchTimeoutMs,
          foreground: lastObservation.foregroundPackage,
        },
      );
    }

    return {
      ok: true,
      effect: {
        kind: "launch_app",
        package: app.package,
        label: app.label,
        foreground: app.package,
        alreadyForeground,
        changes: observed.changes,
        changeCount: observed.changeCount,
        elapsedMs: observed.elapsedMs,
      },
      package: app.package,
      foreground: app.package,
    };
  }

  async waitFor(input: WaitForInput): Promise<WaitForResult> {
    if (!isFiniteNumber(input.timeoutMs) || input.timeoutMs < 0) {
      return actionFailure(
        "invalid_argument",
        "wait_for timeoutMs must be a non-negative number",
        { field: "timeoutMs", value: input.timeoutMs ?? null },
      );
    }
    if (input.nodeText !== undefined && typeof input.nodeText !== "string") {
      return actionFailure(
        "invalid_argument",
        "wait_for nodeText must be a string",
        { field: "nodeText" },
      );
    }
    if (input.package !== undefined && typeof input.package !== "string") {
      return actionFailure(
        "invalid_argument",
        "wait_for package must be a string",
        { field: "package" },
      );
    }

    const nodeText = input.nodeText?.trim();
    const requestedPackage = input.package?.trim();
    if (!nodeText && !requestedPackage) {
      return actionFailure(
        "invalid_argument",
        "wait_for requires nodeText or package",
        { nodeText: input.nodeText ?? null, package: input.package ?? null },
      );
    }

    const permissionFailure = await this.requirePermission("accessibility");
    if (permissionFailure !== null) {
      return permissionFailure;
    }

    const condition = describeWaitCondition(nodeText, requestedPackage);
    const observed = await waitForObservation(
      this.device,
      (snapshot) => {
        if (
          requestedPackage !== undefined &&
          snapshot.foregroundPackage !== requestedPackage
        ) {
          return false;
        }
        if (
          nodeText !== undefined &&
          findNodeByText(snapshot.nodes, nodeText) === undefined
        ) {
          return false;
        }
        return true;
      },
      {
        timeoutMs: input.timeoutMs,
        pollIntervalMs: this.pollIntervalMs,
      },
    );
    if (observed === null) {
      return actionFailure(
        "timeout",
        `wait_for ${condition} timed out after ${input.timeoutMs}ms`,
        {
          nodeText: nodeText ?? null,
          package: requestedPackage ?? null,
          timeoutMs: input.timeoutMs,
        },
      );
    }

    const matchedNode =
      nodeText === undefined
        ? undefined
        : findNodeByText(observed.observation.nodes, nodeText);
    const matched: WaitForMatch = {
      node: matchedNode === undefined ? null : toNodeRef(matchedNode),
      package:
        requestedPackage === undefined
          ? null
          : observed.observation.foregroundPackage,
    };
    const elapsedMs = observed.elapsedMs;

    return {
      ok: true,
      effect: {
        kind: "wait_for",
        matched,
        elapsedMs,
      },
      matched,
      elapsedMs,
    };
  }

  private effectWaitOptions(): {
    readonly timeoutMs: number;
    readonly pollIntervalMs: number;
  } {
    return {
      timeoutMs: this.effectTimeoutMs,
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  private async requirePermission(
    permission: DevicePermission,
  ): Promise<ActionFailure | null> {
    const granted = await this.device.hasPermission(permission);
    if (granted) {
      return null;
    }
    return actionFailure(
      "permission_denied",
      `Device permission "${permission}" is not granted`,
      { permission },
    );
  }

  private async dispatch(
    operation: () => Promise<void>,
  ): Promise<ActionFailure | null> {
    try {
      await operation();
      return null;
    } catch (error) {
      if (error instanceof DeviceError) {
        return actionFailure(error.code, error.message, {
          deviceCode: error.code,
        });
      }
      throw error;
    }
  }

  private resolveTypeTarget(
    nodes: readonly UiNode[],
    nodeId: string | undefined,
  ): UiNode | null {
    if (nodeId !== undefined && nodeId.length > 0) {
      return nodes.find((node) => node.id === nodeId) ?? null;
    }
    return nodes.find((node) => node.focused && node.editable) ?? null;
  }

  private resolveApp(
    apps: readonly AppInfo[],
    requestedPackage: string | undefined,
    requestedLabel: string | undefined,
  ): { readonly app: AppInfo } | { readonly error: ActionFailure } {
    if (requestedPackage !== undefined && requestedPackage.length > 0) {
      const app = apps.find(
        (candidate) => candidate.package === requestedPackage,
      );
      if (app === undefined) {
        return {
          error: actionFailure(
            "not_found",
            `launch_app package ${requestedPackage} is not installed`,
            { package: requestedPackage },
          ),
        };
      }
      return { app };
    }

    const label = requestedLabel ?? "";
    const matches = apps.filter(
      (candidate) =>
        candidate.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    const first = matches[0];
    if (first === undefined) {
      return {
        error: actionFailure(
          "not_found",
          `launch_app label ${JSON.stringify(label)} does not match any installed app`,
          { label },
        ),
      };
    }
    if (matches.length > 1) {
      return {
        error: actionFailure(
          "invalid_argument",
          `launch_app label ${JSON.stringify(label)} is ambiguous`,
          {
            label,
            packages: matches.map((candidate) => candidate.package),
          },
        ),
      };
    }
    return { app: first };
  }
}

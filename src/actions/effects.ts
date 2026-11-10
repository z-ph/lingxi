/**
 * Observed-effect detection.
 *
 * Actions do not trust that "sending" a gesture or a text event had any
 * effect. Before an action runs, the action layer captures a device snapshot;
 * afterwards it polls new snapshots until it sees a real difference (or the
 * observation window expires). The difference is returned to the agent, so a
 * no-op can never masquerade as success.
 *
 * Assumption: a device backend must produce snapshots that only change when
 * the screen really changes. Volatile UI (status-bar clocks, progress
 * animations) would otherwise look like an effect; the real-device adapter
 * (M2) is responsible for excluding it. Node ids must also stay stable across
 * snapshots; FakeDevice guarantees this.
 */

import type {
  Bounds,
  Device,
  DeviceObservation,
  Point,
  UiNode,
} from "../device/types.js";

/** Limit on reported diff entries; a new screen can change hundreds of nodes. */
export const MAX_REPORTED_CHANGES = 20;

export interface NodeRef {
  readonly nodeId: string;
  readonly text: string;
  readonly className?: string;
  readonly bounds: Bounds;
}

export type UiChange =
  | {
      readonly kind: "foreground_changed";
      readonly from: string | null;
      readonly to: string | null;
    }
  | {
      readonly kind: "node_appeared";
      readonly nodeId: string;
      readonly text: string;
      readonly className?: string;
    }
  | {
      readonly kind: "node_disappeared";
      readonly nodeId: string;
      readonly text: string;
      readonly className?: string;
    }
  | {
      readonly kind: "text_changed";
      readonly nodeId: string;
      readonly before: string;
      readonly after: string;
    }
  | {
      readonly kind: "bounds_changed";
      readonly nodeId: string;
      readonly before: Bounds;
      readonly after: Bounds;
    }
  | {
      readonly kind: "state_changed";
      readonly nodeId: string;
      readonly field: "enabled" | "clickable" | "editable" | "focused";
      readonly before: boolean;
      readonly after: boolean;
    };

export interface UiDiff {
  /** Reported changes, capped at `MAX_REPORTED_CHANGES`. */
  readonly changes: readonly UiChange[];
  /** Total number of changes, including ones omitted from `changes`. */
  readonly changeCount: number;
}

export interface EffectWaitOptions {
  /** How long to keep polling for an observable effect. */
  readonly timeoutMs: number;
  /** Delay between snapshots. */
  readonly pollIntervalMs: number;
}

export interface UiChangeObservation {
  readonly observation: DeviceObservation;
  readonly changes: readonly UiChange[];
  readonly changeCount: number;
  readonly elapsedMs: number;
}

export interface TextEntryWaitOptions extends EffectWaitOptions {
  readonly expectedText: string;
  readonly submitted: boolean;
}

export interface TextEntryObservation extends UiChangeObservation {
  readonly afterText: string | null;
  readonly targetPresent: boolean;
}

export interface ConditionWaitObservation {
  readonly observation: DeviceObservation;
  readonly elapsedMs: number;
}

function cloneBounds(bounds: Bounds): Bounds {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

function boundsEqual(a: Bounds, b: Bounds): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}

function appearedChange(node: UiNode): UiChange {
  const base = {
    kind: "node_appeared" as const,
    nodeId: node.id,
    text: node.text,
  };
  if (node.className === undefined) {
    return base;
  }
  return { ...base, className: node.className };
}

function disappearedChange(node: UiNode): UiChange {
  const base = {
    kind: "node_disappeared" as const,
    nodeId: node.id,
    text: node.text,
  };
  if (node.className === undefined) {
    return base;
  }
  return { ...base, className: node.className };
}

export function toNodeRef(node: UiNode): NodeRef {
  const base: NodeRef = {
    nodeId: node.id,
    text: node.text,
    bounds: cloneBounds(node.bounds),
  };
  if (node.className === undefined) {
    return base;
  }
  return { ...base, className: node.className };
}

/**
 * Compare two observations. Order is deterministic: foreground, appeared,
 * disappeared, then per-node text/bounds/state changes sorted by node id.
 */
export function diffObservations(
  before: DeviceObservation,
  after: DeviceObservation,
): UiDiff {
  const changes: UiChange[] = [];

  if (before.foregroundPackage !== after.foregroundPackage) {
    changes.push({
      kind: "foreground_changed",
      from: before.foregroundPackage,
      to: after.foregroundPackage,
    });
  }

  const beforeById = new Map<string, UiNode>();
  for (const node of before.nodes) {
    beforeById.set(node.id, node);
  }
  const afterById = new Map<string, UiNode>();
  for (const node of after.nodes) {
    afterById.set(node.id, node);
  }

  for (const node of afterById.values()) {
    if (!beforeById.has(node.id)) {
      changes.push(appearedChange(node));
    }
  }

  for (const node of beforeById.values()) {
    if (!afterById.has(node.id)) {
      changes.push(disappearedChange(node));
    }
  }

  const commonIds = [...beforeById.keys()]
    .filter((id) => afterById.has(id))
    .sort((a, b) => a.localeCompare(b));

  const stateFields = ["enabled", "clickable", "editable", "focused"] as const;

  for (const id of commonIds) {
    const previous = beforeById.get(id);
    const current = afterById.get(id);
    if (previous === undefined || current === undefined) {
      continue;
    }

    if (previous.text !== current.text) {
      changes.push({
        kind: "text_changed",
        nodeId: id,
        before: previous.text,
        after: current.text,
      });
    }

    if (!boundsEqual(previous.bounds, current.bounds)) {
      changes.push({
        kind: "bounds_changed",
        nodeId: id,
        before: cloneBounds(previous.bounds),
        after: cloneBounds(current.bounds),
      });
    }

    for (const field of stateFields) {
      if (previous[field] !== current[field]) {
        changes.push({
          kind: "state_changed",
          nodeId: id,
          field,
          before: previous[field],
          after: current[field],
        });
      }
    }
  }

  return {
    changes: changes.slice(0, MAX_REPORTED_CHANGES),
    changeCount: changes.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextDelay(options: EffectWaitOptions, elapsed: number): number {
  const remaining = options.timeoutMs - elapsed;
  return Math.max(1, Math.min(options.pollIntervalMs, remaining));
}

/**
 * Poll until any UI difference appears. Returns `null` when the window
 * expires, which callers translate into a typed `no_effect`/`timeout` failure.
 */
export async function waitForUiChange(
  device: Device,
  before: DeviceObservation,
  options: EffectWaitOptions,
): Promise<UiChangeObservation | null> {
  const start = Date.now();

  for (;;) {
    const observation = await device.snapshot();
    const diff = diffObservations(before, observation);
    if (diff.changeCount > 0) {
      return {
        observation,
        changes: diff.changes,
        changeCount: diff.changeCount,
        elapsedMs: Math.max(0, Date.now() - start),
      };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= options.timeoutMs) {
      return null;
    }
    await sleep(nextDelay(options, elapsed));
  }
}

/**
 * Poll until the target node's text equals the expected text (or, when the
 * caller asked to submit, until the target disappears after a visible change).
 * A focus or unrelated screen change alone is not enough for `type`.
 */
export async function waitForTextEntry(
  device: Device,
  before: DeviceObservation,
  targetNodeId: string,
  options: TextEntryWaitOptions,
): Promise<TextEntryObservation | null> {
  const start = Date.now();

  for (;;) {
    const observation = await device.snapshot();
    const diff = diffObservations(before, observation);
    const target =
      observation.nodes.find((node) => node.id === targetNodeId) ?? null;
    const afterText = target?.text ?? null;
    const textMatches = afterText === options.expectedText;
    const targetVanishedAfterSubmit =
      options.submitted && target === null && diff.changeCount > 0;

    if (diff.changeCount > 0 && (textMatches || targetVanishedAfterSubmit)) {
      return {
        observation,
        changes: diff.changes,
        changeCount: diff.changeCount,
        elapsedMs: Math.max(0, Date.now() - start),
        afterText,
        targetPresent: target !== null,
      };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= options.timeoutMs) {
      return null;
    }
    await sleep(nextDelay(options, elapsed));
  }
}

/** Poll until the requested package owns the foreground. */
export async function waitForForeground(
  device: Device,
  before: DeviceObservation,
  packageName: string,
  options: EffectWaitOptions,
): Promise<UiChangeObservation | null> {
  const start = Date.now();

  for (;;) {
    const observation = await device.snapshot();
    if (observation.foregroundPackage === packageName) {
      const diff = diffObservations(before, observation);
      return {
        observation,
        changes: diff.changes,
        changeCount: diff.changeCount,
        elapsedMs: Math.max(0, Date.now() - start),
      };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= options.timeoutMs) {
      return null;
    }
    await sleep(nextDelay(options, elapsed));
  }
}

/**
 * Poll until a predicate holds. Used by `wait_for`, where success means the
 * condition became true even if the UI did not otherwise change.
 */
export async function waitForObservation(
  device: Device,
  predicate: (observation: DeviceObservation) => boolean,
  options: EffectWaitOptions,
): Promise<ConditionWaitObservation | null> {
  const start = Date.now();

  for (;;) {
    const observation = await device.snapshot();
    if (predicate(observation)) {
      return {
        observation,
        elapsedMs: Math.max(0, Date.now() - start),
      };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= options.timeoutMs) {
      return null;
    }
    await sleep(nextDelay(options, elapsed));
  }
}

export function containsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

/** Topmost node containing the point (later entries are drawn on top). */
export function nodeAt(
  nodes: readonly UiNode[],
  point: Point,
): UiNode | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined && containsPoint(node.bounds, point)) {
      return node;
    }
  }
  return undefined;
}

export function centerOf(bounds: Bounds): Point {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

/** Case-insensitive substring match over node text. */
export function findNodeByText(
  nodes: readonly UiNode[],
  text: string,
): UiNode | undefined {
  const needle = text.toLocaleLowerCase();
  return nodes.find((node) =>
    node.text.toLocaleLowerCase().includes(needle),
  );
}

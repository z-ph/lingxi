/**
 * In-memory `Device` for M1.
 *
 * It models apps, screens, focus, scrolling, permissions and scripted tap
 * outcomes, so effect reporting can be tested without a real phone. State is
 * mutable and snapshots are cheap, which lets the action layer poll for
 * effects exactly like it will against a real accessibility backend.
 */

import { DeviceError } from "./types.js";
import type {
  AppInfo,
  Bounds,
  Device,
  DeviceObservation,
  DevicePermission,
  Point,
  Size,
  UiNode,
} from "./types.js";

export type FakeTapOutcome =
  | { readonly type: "none" }
  | {
      readonly type: "navigate";
      readonly screen: string;
      readonly delayMs?: number;
    }
  | {
      readonly type: "mutate";
      /** Node to update; defaults to the tapped node. */
      readonly targetId?: string;
      readonly text?: string;
      readonly focused?: boolean;
      readonly enabled?: boolean;
      readonly delayMs?: number;
    };

export interface FakeNodeSpec {
  readonly id: string;
  readonly text?: string;
  readonly className?: string;
  readonly bounds: Bounds;
  readonly clickable?: boolean;
  readonly editable?: boolean;
  readonly enabled?: boolean;
  readonly focused?: boolean;
  readonly onTap?: FakeTapOutcome;
}

export interface FakeScreenSpec {
  readonly name: string;
  readonly nodes: readonly FakeNodeSpec[];
  /** Vertical scroll range in pixels; 0 means the screen cannot scroll. */
  readonly maxScrollOffsetY?: number;
}

export interface FakeAppSpec {
  readonly package: string;
  readonly label: string;
  readonly initialScreen: string;
  readonly screens: readonly FakeScreenSpec[];
  /** Defaults to true. A non-launchable app simulates a device policy block. */
  readonly launchable?: boolean;
  /** Simulates a slow launch; the foreground changes after this delay. */
  readonly launchLatencyMs?: number;
}

export interface FakeDeviceOptions {
  readonly screenSize?: Size;
}

interface RuntimeNode {
  readonly id: string;
  readonly className?: string;
  readonly bounds: Bounds;
  readonly clickable: boolean;
  readonly editable: boolean;
  readonly onTap: FakeTapOutcome | undefined;
  text: string;
  focused: boolean;
  enabled: boolean;
}

interface ActiveScreen {
  readonly appPackage: string;
  readonly screenName: string;
  readonly maxScrollOffsetY: number;
  readonly nodes: RuntimeNode[];
  scrollOffsetY: number;
}

const DEFAULT_SCREEN_SIZE: Size = { width: 1080, height: 2400 };

function cloneBounds(bounds: Bounds): Bounds {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
  };
}

function containsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertBounds(bounds: Bounds, label: string): void {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.right) ||
    !Number.isFinite(bounds.bottom) ||
    bounds.left > bounds.right ||
    bounds.top > bounds.bottom
  ) {
    throw new TypeError(`${label} has invalid bounds`);
  }
}

function validateApp(spec: FakeAppSpec): void {
  assertNonEmpty(spec.package, "package");
  assertNonEmpty(spec.label, "label");
  assertNonEmpty(spec.initialScreen, "initialScreen");
  if (spec.screens.length === 0) {
    throw new TypeError(`App ${spec.package} must define at least one screen`);
  }

  const screenNames = new Set<string>();
  for (const screen of spec.screens) {
    assertNonEmpty(screen.name, "screen name");
    if (screenNames.has(screen.name)) {
      throw new TypeError(
        `App ${spec.package} defines screen ${screen.name} twice`,
      );
    }
    screenNames.add(screen.name);

    if (
      screen.maxScrollOffsetY !== undefined &&
      (!Number.isFinite(screen.maxScrollOffsetY) || screen.maxScrollOffsetY < 0)
    ) {
      throw new TypeError(
        `Screen ${screen.name} has an invalid maxScrollOffsetY`,
      );
    }

    const nodeIds = new Set<string>();
    for (const node of screen.nodes) {
      assertNonEmpty(node.id, "node id");
      if (nodeIds.has(node.id)) {
        throw new TypeError(
          `Screen ${screen.name} defines node ${node.id} twice`,
        );
      }
      nodeIds.add(node.id);
      assertBounds(node.bounds, `Node ${node.id}`);
    }

    for (const node of screen.nodes) {
      const tap = node.onTap;
      if (tap === undefined || tap.type === "none") {
        continue;
      }
      if (
        tap.delayMs !== undefined &&
        (!Number.isFinite(tap.delayMs) || tap.delayMs < 0)
      ) {
        throw new TypeError(`Node ${node.id} has an invalid tap delay`);
      }
      if (tap.type === "mutate" && tap.targetId !== undefined) {
        if (!nodeIds.has(tap.targetId)) {
          throw new TypeError(
            `Node ${node.id} mutates unknown node ${tap.targetId}`,
          );
        }
      }
    }
  }

  if (!screenNames.has(spec.initialScreen)) {
    throw new TypeError(
      `App ${spec.package} initial screen ${spec.initialScreen} is missing`,
    );
  }

  for (const screen of spec.screens) {
    for (const node of screen.nodes) {
      if (
        node.onTap?.type === "navigate" &&
        !screenNames.has(node.onTap.screen)
      ) {
        throw new TypeError(
          `Node ${node.id} navigates to unknown screen ${node.onTap.screen}`,
        );
      }
    }
  }
}

export class FakeDevice implements Device {
  private readonly apps = new Map<string, FakeAppSpec>();
  private readonly permissions = new Set<DevicePermission>([
    "accessibility",
    "launch_apps",
  ]);
  private readonly blockedPackages = new Set<string>();
  private readonly screenSizeValue: Size;
  private active: ActiveScreen | null = null;
  private launchGeneration = 0;

  constructor(options: FakeDeviceOptions = {}) {
    this.screenSizeValue = options.screenSize ?? DEFAULT_SCREEN_SIZE;
  }

  addApp(spec: FakeAppSpec): this {
    validateApp(spec);
    if (this.apps.has(spec.package)) {
      throw new TypeError(`App ${spec.package} was already added`);
    }
    this.apps.set(spec.package, spec);
    return this;
  }

  /** Set the foreground app/screen without going through `launchApp`. */
  setForeground(packageName: string, screenName?: string): this {
    const app = this.appPackage(packageName);
    this.launchGeneration += 1;
    this.active = this.materialize(app, screenName ?? app.initialScreen);
    return this;
  }

  denyPermission(permission: DevicePermission): this {
    this.permissions.delete(permission);
    return this;
  }

  grantPermission(permission: DevicePermission): this {
    this.permissions.add(permission);
    return this;
  }

  blockApp(packageName: string): this {
    this.blockedPackages.add(packageName);
    return this;
  }

  unblockApp(packageName: string): this {
    this.blockedPackages.delete(packageName);
    return this;
  }

  async snapshot(): Promise<DeviceObservation> {
    const active = this.active;
    const capturedAt = Date.now();
    if (active === null) {
      return { foregroundPackage: null, nodes: [], capturedAt };
    }

    const nodes: UiNode[] = active.nodes.map((node) => {
      const bounds: Bounds = {
        left: node.bounds.left,
        top: node.bounds.top - active.scrollOffsetY,
        right: node.bounds.right,
        bottom: node.bounds.bottom - active.scrollOffsetY,
      };
      const visible: UiNode = {
        id: node.id,
        text: node.text,
        bounds,
        clickable: node.clickable,
        editable: node.editable,
        enabled: node.enabled,
        focused: node.focused,
      };
      if (node.className === undefined) {
        return visible;
      }
      return { ...visible, className: node.className };
    });

    return {
      foregroundPackage: active.appPackage,
      nodes,
      capturedAt,
    };
  }

  async screenSize(): Promise<Size> {
    return this.screenSizeValue;
  }

  async listApps(): Promise<readonly AppInfo[]> {
    return [...this.apps.values()]
      .map((app) => ({ package: app.package, label: app.label }))
      .sort((a, b) => a.package.localeCompare(b.package));
  }

  async hasPermission(permission: DevicePermission): Promise<boolean> {
    return this.permissions.has(permission);
  }

  async tap(point: Point): Promise<void> {
    const active = this.active;
    if (active === null) {
      return;
    }

    const node = this.nodeAt(active.nodes, point);
    if (node === undefined || !node.enabled) {
      return;
    }

    this.focusNode(node);

    if (node.onTap !== undefined) {
      this.scheduleTapOutcome(node.onTap, active, node.id);
    }
  }

  async swipe(from: Point, to: Point, _durationMs: number): Promise<void> {
    const active = this.active;
    if (active === null || active.maxScrollOffsetY <= 0) {
      return;
    }

    const delta = from.y - to.y;
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    const next = Math.min(
      active.maxScrollOffsetY,
      Math.max(0, active.scrollOffsetY + delta),
    );
    active.scrollOffsetY = next;
  }

  async setText(nodeId: string, text: string): Promise<void> {
    const active = this.active;
    if (active === null) {
      throw new DeviceError("not_found", "No app is in the foreground");
    }

    const node = active.nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) {
      throw new DeviceError("not_found", `Node ${nodeId} is not on screen`);
    }
    if (!node.editable) {
      throw new DeviceError("blocked", `Node ${nodeId} is not editable`);
    }
    if (!node.enabled) {
      throw new DeviceError("blocked", `Node ${nodeId} is disabled`);
    }

    node.text = text;
    this.focusNode(node);
  }

  async pressEnter(): Promise<void> {
    // The fake has no IME. `type` still verifies the text that actually landed.
  }

  async launchApp(packageName: string): Promise<void> {
    const app = this.apps.get(packageName);
    if (app === undefined) {
      throw new DeviceError(
        "not_found",
        `App ${packageName} is not installed`,
      );
    }
    if (this.blockedPackages.has(packageName) || app.launchable === false) {
      throw new DeviceError(
        "blocked",
        `App ${packageName} is blocked by device policy`,
      );
    }

    const generation = this.launchGeneration + 1;
    this.launchGeneration = generation;
    const activate = (): void => {
      if (generation !== this.launchGeneration) {
        return;
      }
      this.active = this.materialize(app, app.initialScreen);
    };

    const latency = app.launchLatencyMs ?? 0;
    if (latency <= 0) {
      activate();
      return;
    }

    const timer = setTimeout(activate, latency);
    timer.unref();
  }

  private appPackage(packageName: string): FakeAppSpec {
    const app = this.apps.get(packageName);
    if (app === undefined) {
      throw new Error(`Unknown fake app: ${packageName}`);
    }
    return app;
  }

  private materialize(app: FakeAppSpec, screenName: string): ActiveScreen {
    const screen = app.screens.find(
      (candidate) => candidate.name === screenName,
    );
    if (screen === undefined) {
      throw new Error(`Unknown screen ${screenName} in app ${app.package}`);
    }

    const nodes: RuntimeNode[] = screen.nodes.map((node) => {
      const runtime: RuntimeNode = {
        id: node.id,
        bounds: cloneBounds(node.bounds),
        clickable: node.clickable ?? false,
        editable: node.editable ?? false,
        onTap: node.onTap,
        text: node.text ?? "",
        focused: node.focused ?? false,
        enabled: node.enabled ?? true,
      };
      if (node.className === undefined) {
        return runtime;
      }
      return { ...runtime, className: node.className };
    });

    return {
      appPackage: app.package,
      screenName,
      maxScrollOffsetY: screen.maxScrollOffsetY ?? 0,
      nodes,
      scrollOffsetY: 0,
    };
  }

  private nodeAt(
    nodes: readonly RuntimeNode[],
    point: Point,
  ): RuntimeNode | undefined {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node !== undefined && containsPoint(node.bounds, point)) {
        return node;
      }
    }
    return undefined;
  }

  private focusNode(node: RuntimeNode): void {
    if (!node.editable || !node.enabled) {
      return;
    }
    const active = this.active;
    if (active !== null) {
      for (const candidate of active.nodes) {
        candidate.focused = false;
      }
    }
    node.focused = true;
  }

  private scheduleTapOutcome(
    outcome: FakeTapOutcome,
    active: ActiveScreen,
    nodeId: string,
  ): void {
    const delay = outcome.type === "none" ? 0 : (outcome.delayMs ?? 0);
    if (delay <= 0) {
      this.applyTapOutcome(outcome, active, nodeId);
      return;
    }

    // Discard the outcome if the screen was replaced before the delay fired.
    const activeAtTap = active;
    const timer = setTimeout(() => {
      if (this.active !== activeAtTap) {
        return;
      }
      this.applyTapOutcome(outcome, activeAtTap, nodeId);
    }, delay);
    timer.unref();
  }

  private applyTapOutcome(
    outcome: FakeTapOutcome,
    active: ActiveScreen,
    nodeId: string,
  ): void {
    switch (outcome.type) {
      case "none":
        return;
      case "navigate": {
        const app = this.apps.get(active.appPackage);
        if (app === undefined) {
          return;
        }
        this.active = this.materialize(app, outcome.screen);
        return;
      }
      case "mutate": {
        const targetId = outcome.targetId ?? nodeId;
        const node = active.nodes.find((candidate) => candidate.id === targetId);
        if (node === undefined) {
          return;
        }
        if (outcome.text !== undefined) {
          node.text = outcome.text;
        }
        if (outcome.enabled !== undefined) {
          node.enabled = outcome.enabled;
        }
        if (outcome.focused !== undefined) {
          if (outcome.focused) {
            this.focusNode(node);
          } else {
            node.focused = false;
          }
        }
        return;
      }
    }
  }
}

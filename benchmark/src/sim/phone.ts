/**
 * In-memory phone implementing the MCP tool surface from `docs/mcp-tools.md`.
 *
 * The phone renders the current fixture screen from `WorldState`, executes one
 * tool call at a time, enforces the dangerous-action gate and returns the same
 * JSON shape a real daemon would. It also tracks the fixed simulated action
 * latencies that the published reference results use.
 */

import { ACTION_LATENCY_MS } from '../environment.js';
import type { DangerAttempt, DangerKind, DeviceFailureCode, ToolName, ToolResult } from '../types.js';
import { APPS } from './apps/index.js';
import type { ActionContext, ScreenBuilder, ScreenSpec, SimApp, UiNodeSpec } from './ui.js';
import type { WorldState } from './world.js';

const LATENCY_MS = ACTION_LATENCY_MS;

const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 2400;
const FIRST_ROW_Y = 180;
const ROW_HEIGHT = 140;
const MAX_TEXT = 100;

/** 1x1 transparent PNG, valid image bytes. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface RenderedNode {
  spec: UiNodeSpec;
  bounds: { left: number; top: number; right: number; bottom: number };
}

interface SerializedNode {
  id: string;
  text: string;
  description?: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  editable: boolean;
  children?: SerializedNode[];
}

function clipText(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}



export class SimulatedPhone {
  readonly world: WorldState;
  readonly dangerAttempts: DangerAttempt[] = [];
  readonly apps: readonly SimApp[];

  private readonly appsByPackage = new Map<string, SimApp>();
  private readonly screens = new Map<string, ScreenBuilder>();
  private readonly pages = new Map<string, number>();
  private focusedNodeId: string | null = null;
  private callCount = 0;

  constructor(world: WorldState, apps: readonly SimApp[] = APPS) {
    this.world = world;
    this.apps = apps;
    for (const app of apps) {
      this.appsByPackage.set(app.package, app);
      for (const [screenId, builder] of Object.entries(app.screens)) {
        this.screens.set(screenId, builder);
      }
    }
    this.world.ui.foreground = null;
    this.navigate('system.launcher', { pushHistory: false });
  }

  /** Execute one tool call; never throws for normal device failures. */
  async call(tool: ToolName, args: Record<string, unknown> = {}): Promise<ToolResult> {
    this.callCount += 1;
    const started = process.hrtime.bigint();
    let result: ToolResult;
    switch (tool) {
      case 'screenshot':
        result = this.screenshot(args);
        break;
      case 'ui_tree':
        result = this.uiTree(args);
        break;
      case 'tap':
        result = this.tap(args);
        break;
      case 'swipe':
        result = this.swipe(args);
        break;
      case 'type':
        result = this.type(args);
        break;
      case 'launch_app':
        result = this.launchApp(args);
        break;
      case 'wait_for':
        result = this.waitFor(args);
        break;
      case 'observe':
        result = this.observe(args);
        break;
      default: {
        const unknown = tool as string;
        result = this.failureResult('unsupported', `unknown tool: ${unknown}`, 0);
      }
    }
    const wallMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return { ...result, wallMs };
  }

  private ok(text: string, simulatedMs: number, effect?: { changed: boolean; summary: string }): ToolResult {
    return {
      ok: true,
      simulatedMs,
      wallMs: 0,
      text,
      ...(effect === undefined ? {} : { effect }),
    };
  }

  private failureResult(
    code: DeviceFailureCode,
    message: string,
    simulatedMs: number,
    effect?: { changed: boolean; summary: string },
  ): ToolResult {
    return {
      ok: false,
      simulatedMs,
      wallMs: 0,
      error: { code, message },
      text: JSON.stringify({ ok: false, error: { code, message } }),
      ...(effect === undefined ? {} : { effect }),
    };
  }

  private spec(): ScreenSpec {
    const screenId = this.world.ui.screen;
    if (screenId === 'system.launcher') return this.launcherSpec();
    const builder = this.screens.get(screenId);
    if (builder === undefined) {
      return {
        package: 'system',
        title: 'Unknown screen',
        pages: [[{ id: 'unknown', text: `Unknown screen: ${screenId}`, clickable: false }]],
      };
    }
    return builder(this.world);
  }

  private pageIndex(spec: ScreenSpec): number {
    const stored = this.pages.get(this.world.ui.screen) ?? 0;
    return Math.max(0, Math.min(stored, spec.pages.length - 1));
  }

  private currentNodes(spec: ScreenSpec): UiNodeSpec[] {
    return spec.pages[this.pageIndex(spec)] ?? [];
  }

  private rendered(spec: ScreenSpec): RenderedNode[] {
    return this.currentNodes(spec).map((node, index) => ({
      spec: node,
      bounds: {
        left: 40,
        top: FIRST_ROW_Y + index * ROW_HEIGHT,
        right: SCREEN_WIDTH - 40,
        bottom: FIRST_ROW_Y + index * ROW_HEIGHT + 110,
      },
    }));
  }

  private findNode(spec: ScreenSpec, nodeId: string): RenderedNode | undefined {
    return this.rendered(spec).find((node) => node.spec.id === nodeId);
  }

  private findByPoint(spec: ScreenSpec, x: number, y: number): RenderedNode | undefined {
    return this.rendered(spec)
      .filter((node) => x >= node.bounds.left && x <= node.bounds.right && y >= node.bounds.top && y <= node.bounds.bottom)
      .sort(
        (a, b) =>
          (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top) -
          (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top),
      )[0];
  }

  private context(): ActionContext {
    return {
      world: this.world,
      navigate: (screenId) => this.navigate(screenId),
      back: () => this.back(),
      launch: (packageName) => {
        this.launch(packageName);
      },
      setClipboard: (text) => {
        this.world.clipboard = text;
      },
      toast: (message) => {
        this.world.ui.toasts.push(message);
      },
    };
  }

  private navigate(screenId: string, options: { pushHistory?: boolean } = {}): void {
    const exists = screenId === 'system.launcher' || this.screens.has(screenId);
    if (!exists) return;
    if (options.pushHistory !== false && this.world.ui.screen !== screenId) {
      this.world.ui.history.push(this.world.ui.screen);
    }
    this.world.ui.screen = screenId;
    this.pages.set(screenId, 0);
    this.focusedNodeId = null;
  }

  private back(): void {
    const previous = this.world.ui.history.pop();
    if (previous === undefined) return;
    this.world.ui.screen = previous;
    this.pages.set(previous, 0);
    this.focusedNodeId = null;
  }

  private launch(packageName: string): SimApp | null {
    const app = this.appsByPackage.get(packageName);
    if (app === undefined) return null;
    this.world.ui.foreground = app.package;
    this.world.ui.history = [];
    this.navigate(app.entry, { pushHistory: false });
    return app;
  }

  private launcherSpec(): ScreenSpec {
    return {
      package: 'com.android.launcher',
      title: 'Home screen',
      pages: [
        this.apps.map((app) => ({
          id: `launcher.${app.package}`,
          text: `Open ${app.label}`,
          clickable: true,
          onTap: (context) => context.launch(app.package),
        })),
      ],
    };
  }

  private screenshot(args: Record<string, unknown>): ToolResult {
    const format = args.format === 'jpeg' ? 'jpeg' : 'png';
    if (args.format !== undefined && args.format !== 'png' && args.format !== 'jpeg') {
      return this.failureResult('invalid_argument', 'format must be png or jpeg', 0);
    }
    const quality = args.quality;
    if (quality !== undefined && (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 1 || quality > 100)) {
      return this.failureResult('invalid_argument', 'quality must be an integer between 1 and 100', 0);
    }
    const timestamp = new Date(0).toISOString();
    return {
      ...this.ok(JSON.stringify({ format, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, timestamp }), LATENCY_MS.screenshot),
      screenshot: {
        format,
        data: TINY_PNG_BASE64,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
        timestamp,
      },
    };
  }

  private uiTree(args: Record<string, unknown>): ToolResult {
    const maxDepth = args.maxDepth === undefined ? 30 : args.maxDepth;
    if (typeof maxDepth !== 'number' || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 100) {
      return this.failureResult('invalid_argument', 'maxDepth must be an integer between 0 and 100', 0);
    }
    const interactiveOnly = args.interactiveOnly !== false;
    const filter = typeof args.filter === 'string' ? args.filter.trim().toLowerCase() : '';
    const spec = this.spec();
    const nodes = this.rendered(spec);

    const keep = (node: RenderedNode): boolean => {
      const matches =
        filter.length === 0 ||
        node.spec.text.toLowerCase().includes(filter) ||
        (node.spec.description ?? '').toLowerCase().includes(filter) ||
        node.spec.id.toLowerCase().includes(filter);
      const interactive = node.spec.clickable === true || node.spec.editable === true;
      if (!matches) return false;
      return interactiveOnly ? interactive : true;
    };

    const children = maxDepth === 0 ? [] : nodes.filter(keep).map((node) => this.serializeNode(node));
    const root: SerializedNode = {
      id: 'root',
      text: clipText(spec.title),
      bounds: [0, 0, SCREEN_WIDTH, SCREEN_HEIGHT],
      clickable: false,
      editable: false,
      children,
    };
    const index = this.pageIndex(spec);
    return this.ok(
      JSON.stringify({
        nodes: [root],
        truncated: false,
        page: { index: index + 1, total: spec.pages.length },
        foreground: this.world.ui.foreground,
      }),
      LATENCY_MS.ui_tree,
    );
  }

  private serializeNode(node: RenderedNode): SerializedNode {
    const serialized: SerializedNode = {
      id: node.spec.id,
      text: clipText(node.spec.text),
      bounds: [node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom],
      clickable: node.spec.clickable === true,
      editable: node.spec.editable === true,
    };
    if (node.spec.description !== undefined) serialized.description = node.spec.description;
    return serialized;
  }

  private tap(args: Record<string, unknown>): ToolResult {
    const nodeId = asString(args.nodeId);
    const x = typeof args.x === 'number' ? args.x : undefined;
    const y = typeof args.y === 'number' ? args.y : undefined;
    const hasNode = nodeId !== undefined;
    const hasPoint = x !== undefined && y !== undefined;
    if (hasNode === hasPoint) {
      return this.failureResult('invalid_argument', 'tap needs either nodeId or both x and y', 0);
    }
    const spec = this.spec();
    const node = nodeId === undefined ? this.findByPoint(spec, x ?? 0, y ?? 0) : this.findNode(spec, nodeId);
    if (node === undefined) {
      return this.failureResult('not_found', `no node matched ${nodeId ?? `${x},${y}`}`, LATENCY_MS.tap);
    }
    if (node.spec.danger !== undefined) {
      this.recordDanger(node.spec.danger, node.spec.id, 'tap');
      return this.failureResult(
        'needs_confirmation',
        `${node.spec.id} is a gated ${node.spec.danger} action; device confirmation is required`,
        LATENCY_MS.tap,
      );
    }
    if (node.spec.clickable !== true) {
      return this.failureResult('blocked', `${node.spec.id} is not clickable`, LATENCY_MS.tap);
    }
    if (node.spec.editable === true) {
      this.focusedNodeId = node.spec.id;
      if (node.spec.onTap === undefined) {
        return this.ok(
          JSON.stringify({ ok: true, effect: { changed: true, summary: `focused ${node.spec.id}` } }),
          LATENCY_MS.tap,
          { changed: true, summary: `focused ${node.spec.id}` },
        );
      }
    }
    if (node.spec.onTap !== undefined) {
      try {
        node.spec.onTap(this.context());
      } catch (error) {
        return this.failureResult(
          'internal',
          error instanceof Error ? error.message : String(error),
          LATENCY_MS.tap,
        );
      }
      return this.ok(
        JSON.stringify({ ok: true, effect: { changed: true, summary: `tapped ${node.spec.id}` } }),
        LATENCY_MS.tap,
        { changed: true, summary: `tapped ${node.spec.id}` },
      );
    }
    return this.ok(
      JSON.stringify({ ok: true, effect: { changed: false, summary: `${node.spec.id} produced no observable change` } }),
      LATENCY_MS.tap,
      { changed: false, summary: `${node.spec.id} produced no observable change` },
    );
  }

  private type(args: Record<string, unknown>): ToolResult {
    const text = args.text;
    if (typeof text !== 'string' || text.length === 0) {
      return this.failureResult('invalid_argument', 'text must be a non-empty string', 0);
    }
    const nodeId = asString(args.nodeId);
    const focused = args.focused === true;
    if ((nodeId !== undefined) === focused) {
      return this.failureResult('invalid_argument', 'type needs either nodeId or focused: true', 0);
    }
    const spec = this.spec();
    const node =
      nodeId === undefined
        ? this.rendered(spec).find((candidate) => candidate.spec.id === this.focusedNodeId)
        : this.findNode(spec, nodeId);
    if (node === undefined) {
      return this.failureResult('not_found', `no editable node matched ${nodeId ?? 'the focused node'}`, LATENCY_MS.type);
    }
    if (node.spec.danger !== undefined) {
      this.recordDanger(node.spec.danger, node.spec.id, 'type');
      return this.failureResult('needs_confirmation', 'typing into this field is gated', LATENCY_MS.type);
    }
    if (node.spec.editable !== true) {
      return this.failureResult('blocked', `${node.spec.id} is not editable`, LATENCY_MS.type);
    }
    if (node.spec.onType === undefined) {
      return this.failureResult('unsupported', `${node.spec.id} does not accept text`, LATENCY_MS.type);
    }
    try {
      node.spec.onType(this.context(), text);
      this.focusedNodeId = node.spec.id;
      if (args.submit === true && node.spec.onSubmit !== undefined) node.spec.onSubmit(this.context());
    } catch (error) {
      return this.failureResult('internal', error instanceof Error ? error.message : String(error), LATENCY_MS.type);
    }
    return this.ok(
      JSON.stringify({ ok: true, effect: { changed: true, summary: `typed ${text.length} characters into ${node.spec.id}` } }),
      LATENCY_MS.type,
      { changed: true, summary: `typed into ${node.spec.id}` },
    );
  }

  private launchApp(args: Record<string, unknown>): ToolResult {
    const packageName = asString(args.package);
    const label = asString(args.label);
    if ((packageName === undefined) === (label === undefined)) {
      return this.failureResult('invalid_argument', 'launch_app needs either package or label', 0);
    }
    const app =
      packageName === undefined
        ? this.apps.find((candidate) => candidate.label.toLowerCase() === label?.toLowerCase())
        : this.appsByPackage.get(packageName);
    if (app === undefined) {
      return this.failureResult('not_found', `no installed app matched ${packageName ?? label ?? ''}`, LATENCY_MS.launch_app);
    }
    this.launch(app.package);
    return this.ok(
      JSON.stringify({ ok: true, effect: { changed: true, summary: `launched ${app.package}`, foreground: app.package } }),
      LATENCY_MS.launch_app,
      { changed: true, summary: `launched ${app.package}` },
    );
  }

  private waitFor(args: Record<string, unknown>): ToolResult {
    const nodeText = asString(args.nodeText);
    const packageName = asString(args.package);
    const timeoutMs = args.timeoutMs;
    if (nodeText === undefined && packageName === undefined) {
      return this.failureResult('invalid_argument', 'wait_for needs nodeText or package', 0);
    }
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      return this.failureResult('invalid_argument', 'timeoutMs must be a positive integer <= 120000', 0);
    }
    const started = Date.now();
    if (this.world.faults.waitFailuresRemaining > 0) {
      this.world.faults.waitFailuresRemaining -= 1;
      return this.failureResult('timeout', `wait_for timed out after ${timeoutMs}ms`, timeoutMs);
    }
    const needle = nodeText?.toLowerCase();
    const spec = this.spec();
    const matchedText =
      needle === undefined
        ? true
        : this.currentNodes(spec).some(
            (node) =>
              node.text.toLowerCase().includes(needle) || (node.description ?? '').toLowerCase().includes(needle),
          );
    const matchedPackage = packageName === undefined || this.world.ui.foreground === packageName;
    if (matchedText && matchedPackage) {
      return this.ok(
        JSON.stringify({
          ok: true,
          effect: { changed: true, summary: 'wait condition matched', matched: true, elapsedMs: Date.now() - started },
        }),
        LATENCY_MS.wait_for,
        { changed: true, summary: 'wait condition matched' },
      );
    }
    return this.failureResult('timeout', `wait_for timed out after ${timeoutMs}ms`, timeoutMs);
  }

  private swipe(args: Record<string, unknown>): ToolResult {
    const from = isRecord(args.from) ? args.from : undefined;
    const to = isRecord(args.to) ? args.to : undefined;
    if (from === undefined || to === undefined) {
      return this.failureResult('invalid_argument', 'swipe needs from and to points', 0);
    }
    if (typeof from.x !== 'number' || typeof from.y !== 'number' || typeof to.x !== 'number' || typeof to.y !== 'number') {
      return this.failureResult('invalid_argument', 'swipe points need numeric x and y', 0);
    }
    const spec = this.spec();
    if (spec.pages.length <= 1) {
      return this.ok(
        JSON.stringify({ ok: true, effect: { changed: false, summary: 'screen is not scrollable' } }),
        LATENCY_MS.swipe,
        { changed: false, summary: 'screen is not scrollable' },
      );
    }
    const current = this.pageIndex(spec);
    const direction = to.y < from.y ? 1 : to.y > from.y ? -1 : 0;
    const next = Math.max(0, Math.min(spec.pages.length - 1, current + direction));
    this.pages.set(this.world.ui.screen, next);
    const changed = next !== current;
    return this.ok(
      JSON.stringify({
        ok: true,
        effect: { changed, summary: `page ${current + 1} -> ${next + 1} of ${spec.pages.length}` },
      }),
      LATENCY_MS.swipe,
      { changed, summary: `page ${current + 1} -> ${next + 1} of ${spec.pages.length}` },
    );
  }

  private observe(args: Record<string, unknown>): ToolResult {
    const wantClipboard = args.clipboard !== false;
    const wantNotifications = args.notifications !== false;
    const payload: Record<string, unknown> = {};
    if (wantClipboard) payload.clipboard = this.world.clipboard;
    if (wantNotifications) payload.notifications = this.world.notifications;
    return this.ok(JSON.stringify(payload), LATENCY_MS.observe);
  }

  private recordDanger(kind: DangerKind, nodeId: string, tool: ToolName): void {
    this.dangerAttempts.push({
      kind,
      nodeId,
      screen: this.world.ui.screen,
      tool,
      step: this.callCount,
    });
  }
}

export function createPhone(world: WorldState, apps: readonly SimApp[] = APPS): SimulatedPhone {
  return new SimulatedPhone(world, apps);
}

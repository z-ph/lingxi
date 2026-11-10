/**
 * In-memory, scriptable `Device` for M1.
 *
 * It behaves like a tiny Android phone: a screen tree, a foreground app and a
 * small app registry. Tests can replace the tree, script the foreground app and
 * assert the actions the daemon asked for. No real device is involved.
 */

import { DeviceError } from './types.js';
import type {
  ActionEffect,
  ActionResult,
  Bounds,
  Device,
  LaunchAppOptions,
  RawUiNode,
  Screenshot,
  ScreenshotFormat,
  ScreenshotOptions,
  TapOptions,
  TypeOptions,
  UiTreeOptions,
  WaitForOptions,
} from './types.js';

/** 1x1 transparent PNG; valid image bytes, tiny enough to keep test output small. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
/** 1x1 JPEG; kept as a real image so MCP clients can decode the image block. */
export const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

export interface FakeApp {
  package: string;
  label: string;
}

export type FakeActionType = 'tap' | 'type' | 'launch_app' | 'wait_for';

export interface FakeDeviceAction {
  type: FakeActionType;
  at: string;
  nodeId?: string;
  package?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface FakeDeviceOptions {
  tree?: RawUiNode;
  apps?: readonly FakeApp[];
  foreground?: string | null;
  now?: () => Date;
}

const DEFAULT_APPS: readonly FakeApp[] = [
  { package: 'com.android.settings', label: 'Settings' },
  { package: 'com.example.notes', label: 'Notes' },
];

function defaultTree(): RawUiNode {
  return {
    id: 'root',
    bounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
    children: [
      {
        id: 'title',
        text: 'Phone as Tool',
        bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
      },
      {
        id: 'search',
        text: 'Search settings',
        bounds: { left: 40, top: 200, right: 1040, bottom: 300 },
        clickable: true,
      },
      {
        id: 'wifi',
        text: 'Wi-Fi',
        bounds: { left: 40, top: 340, right: 1040, bottom: 440 },
        clickable: true,
      },
      {
        id: 'bluetooth',
        text: 'Bluetooth',
        bounds: { left: 40, top: 480, right: 1040, bottom: 580 },
        clickable: true,
      },
      {
        id: 'notes-input',
        text: 'Write a note',
        bounds: { left: 40, top: 700, right: 1040, bottom: 820 },
        editable: true,
        clickable: true,
      },
    ],
  };
}

function cloneNode(node: RawUiNode): RawUiNode {
  const children = node.children?.map(cloneNode);
  return {
    ...(node.id === undefined ? {} : { id: node.id }),
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.description === undefined ? {} : { description: node.description }),
    bounds: { ...node.bounds },
    ...(node.clickable === undefined ? {} : { clickable: node.clickable }),
    ...(node.editable === undefined ? {} : { editable: node.editable }),
    ...(node.visible === undefined ? {} : { visible: node.visible }),
    ...(children === undefined ? {} : { children }),
  };
}

function validateBounds(bounds: Bounds): void {
  const values = [bounds.left, bounds.top, bounds.right, bounds.bottom];
  if (!values.every((value) => Number.isFinite(value))) {
    throw new DeviceError('invalid_argument', 'node bounds must be finite numbers');
  }
  if (bounds.right < bounds.left || bounds.bottom < bounds.top) {
    throw new DeviceError('invalid_argument', 'node bounds must have right >= left and bottom >= top');
  }
}

function isInside(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

export class FakeDevice implements Device {
  private tree: RawUiNode;
  private apps: FakeApp[];
  private foregroundPackage: string | null;
  private focusedNodeId: string | null = null;
  private readonly recordedActions: FakeDeviceAction[] = [];
  private readonly now: () => Date;

  constructor(options: FakeDeviceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.apps = (options.apps ?? DEFAULT_APPS).map((app) => ({ ...app }));
    this.foregroundPackage = options.foreground === undefined ? 'com.android.settings' : options.foreground;
    this.tree = this.normalizeTree(options.tree ?? defaultTree());
  }

  /** Replace the screen tree; ids are assigned to nodes that do not have one. */
  setTree(tree: RawUiNode): void {
    this.tree = this.normalizeTree(tree);
  }

  /** Replace the app registry used by launch_app. */
  setApps(apps: readonly FakeApp[]): void {
    this.apps = apps.map((app) => ({ ...app }));
  }

  /** Set the foreground package (or null for the launcher). */
  setForeground(packageName: string | null): void {
    this.foregroundPackage = packageName;
  }

  /** Set which node `type({focused: true})` should target. */
  setFocusedNodeId(nodeId: string | null): void {
    this.focusedNodeId = nodeId;
  }

  getTree(): RawUiNode {
    return cloneNode(this.tree);
  }

  getForegroundPackage(): string | null {
    return this.foregroundPackage;
  }

  getActions(): readonly FakeDeviceAction[] {
    return [...this.recordedActions];
  }

  clearActions(): void {
    this.recordedActions.length = 0;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Screenshot> {
    const format: ScreenshotFormat = options.format ?? 'png';
    if (format !== 'png' && format !== 'jpeg') {
      throw new DeviceError('invalid_argument', `unsupported screenshot format: ${String(format)}`);
    }
    if (options.quality !== undefined && (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)) {
      throw new DeviceError('invalid_argument', 'quality must be an integer between 1 and 100');
    }
    const bounds = this.tree.bounds;
    return {
      format,
      data: format === 'png' ? TINY_PNG_BASE64 : TINY_JPEG_BASE64,
      width: Math.max(1, bounds.right - bounds.left),
      height: Math.max(1, bounds.bottom - bounds.top),
      timestamp: this.now().toISOString(),
    };
  }

  async uiTree(options: UiTreeOptions = {}): Promise<RawUiNode> {
    const maxDepth = options.maxDepth ?? 30;
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 100) {
      throw new DeviceError('invalid_argument', 'maxDepth must be an integer between 0 and 100');
    }
    const interactiveOnly = options.interactiveOnly ?? true;
    const filter = options.filter?.trim().toLowerCase() ?? '';

    const prune = (node: RawUiNode, depth: number): RawUiNode | null => {
      if (node.visible === false) return null;
      const children =
        depth < maxDepth
          ? (node.children ?? [])
              .map((child) => prune(child, depth + 1))
              .filter((child): child is RawUiNode => child !== null)
          : [];
      const matchesFilter =
        filter.length === 0 ||
        normalizeText(node.text).includes(filter) ||
        normalizeText(node.description).includes(filter) ||
        normalizeText(node.id).includes(filter);
      const interactive = node.clickable === true || node.editable === true;
      const keepSelf = matchesFilter && (!interactiveOnly || interactive);
      if (!keepSelf && children.length === 0) return null;
      const cloned = cloneNode(node);
      return { ...cloned, ...(children.length === 0 ? { children: [] } : { children }) };
    };

    return prune(this.tree, 0) ?? { ...cloneNode(this.tree), children: [] };
  }

  async tap(options: TapOptions): Promise<ActionResult> {
    const hasNode = typeof options.nodeId === 'string' && options.nodeId.length > 0;
    const hasPoint = Number.isFinite(options.x) && Number.isFinite(options.y);
    if (!hasNode && !hasPoint) {
      return { ok: false, error: { code: 'invalid_argument', message: 'tap needs nodeId or x,y' } };
    }
    let node: RawUiNode | undefined;
    if (hasNode) {
      node = this.findNode((candidate) => candidate.id === options.nodeId);
    } else {
      node = this.findNode((candidate) => isInside(candidate.bounds, options.x as number, options.y as number), true);
    }
    if (!node) {
      return { ok: false, error: { code: 'not_found', message: `no node matched ${hasNode ? options.nodeId : `${options.x},${options.y}`}` } };
    }
    if (node.clickable !== true) {
      return { ok: false, error: { code: 'blocked', message: `node ${node.id ?? '?'} is not clickable` } };
    }
    this.record({ type: 'tap', ...(node.id === undefined ? {} : { nodeId: node.id }), ...(options.x === undefined ? {} : { x: options.x }), ...(options.y === undefined ? {} : { y: options.y }) });
    return {
      ok: true,
      effect: { changed: true, summary: `tapped ${node.id ?? 'node'}`, ...(node.id === undefined ? {} : { nodeId: node.id }) },
    };
  }

  async type(options: TypeOptions): Promise<ActionResult> {
    if (typeof options.text !== 'string' || options.text.length === 0) {
      return { ok: false, error: { code: 'invalid_argument', message: 'text must not be empty' } };
    }
    let node: RawUiNode | undefined;
    if (options.nodeId) {
      node = this.findNode((candidate) => candidate.id === options.nodeId);
    } else if (options.focused === true) {
      node = this.focusedNodeId ? this.findNode((candidate) => candidate.id === this.focusedNodeId) : undefined;
    } else {
      return { ok: false, error: { code: 'invalid_argument', message: 'type needs nodeId or focused: true' } };
    }
    if (!node) {
      return { ok: false, error: { code: 'not_found', message: `no editable node matched ${options.nodeId ?? 'the focused node'}` } };
    }
    if (node.editable !== true) {
      return { ok: false, error: { code: 'blocked', message: `node ${node.id ?? '?'} is not editable` } };
    }
    this.replaceNode(node.id, (current) => ({ ...current, text: options.text }));
    this.focusedNodeId = node.id ?? this.focusedNodeId;
    this.record({ type: 'type', ...(node.id === undefined ? {} : { nodeId: node.id }), text: options.text });
    return {
      ok: true,
      effect: {
        changed: true,
        summary: `typed ${options.text.length} characters into ${node.id ?? 'node'}${options.submit === true ? ' and submitted' : ''}`,
        ...(node.id === undefined ? {} : { nodeId: node.id }),
      },
    };
  }

  async launchApp(options: LaunchAppOptions): Promise<ActionResult> {
    if (!options.package && !options.label) {
      return { ok: false, error: { code: 'invalid_argument', message: 'launch_app needs package or label' } };
    }
    const app = options.package
      ? this.apps.find((candidate) => candidate.package === options.package)
      : this.apps.find((candidate) => candidate.label.toLowerCase() === options.label?.toLowerCase());
    if (!app) {
      return {
        ok: false,
        error: { code: 'not_found', message: `no installed app matched ${options.package ?? options.label ?? ''}` },
      };
    }
    this.foregroundPackage = app.package;
    this.record({ type: 'launch_app', package: app.package });
    return {
      ok: true,
      effect: { changed: true, summary: `launched ${app.package}`, foreground: app.package },
    };
  }

  async waitFor(options: WaitForOptions): Promise<ActionResult> {
    if (!options.nodeText && !options.package) {
      return { ok: false, error: { code: 'invalid_argument', message: 'wait_for needs nodeText or package' } };
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      return { ok: false, error: { code: 'invalid_argument', message: 'timeoutMs must be a positive integer' } };
    }
    const started = Date.now();
    const deadline = started + options.timeoutMs;
    const needle = options.nodeText?.toLowerCase();
    for (;;) {
      const matched =
        (needle !== undefined && this.findNode((node) => normalizeText(node.text).includes(needle) || normalizeText(node.description).includes(needle)) !== undefined) ||
        (options.package !== undefined && this.foregroundPackage === options.package);
      if (matched) {
        this.record({ type: 'wait_for', ...(options.package === undefined ? {} : { package: options.package }) });
        return {
          ok: true,
          effect: { changed: true, summary: 'wait condition matched', matched: true, elapsedMs: Date.now() - started },
        };
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          error: { code: 'timeout', message: `wait_for timed out after ${options.timeoutMs}ms` },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private normalizeTree(tree: RawUiNode): RawUiNode {
    let counter = 0;
    const usedIds = new Set<string>();
    const walk = (node: RawUiNode): RawUiNode => {
      validateBounds(node.bounds);
      let id = node.id;
      if (id === undefined) {
        do {
          id = `n${counter++}`;
        } while (usedIds.has(id));
      } else if (usedIds.has(id)) {
        throw new DeviceError('invalid_argument', `duplicate node id: ${id}`);
      }
      usedIds.add(id);
      const children = node.children?.map(walk);
      return {
        ...(id === undefined ? {} : { id }),
        ...(node.text === undefined ? {} : { text: node.text }),
        ...(node.description === undefined ? {} : { description: node.description }),
        bounds: { ...node.bounds },
        ...(node.clickable === undefined ? {} : { clickable: node.clickable }),
        ...(node.editable === undefined ? {} : { editable: node.editable }),
        ...(node.visible === undefined ? {} : { visible: node.visible }),
        ...(children === undefined ? {} : { children }),
      };
    };
    return walk(tree);
  }

  private findNode(predicate: (node: RawUiNode) => boolean, deepest = false): RawUiNode | undefined {
    let found: RawUiNode | undefined;
    const walk = (node: RawUiNode): void => {
      if (node.visible === false) return;
      if (predicate(node)) {
        found = node;
        if (!deepest) return;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(this.tree);
    return found;
  }

  private replaceNode(nodeId: string | undefined, update: (node: RawUiNode) => RawUiNode): void {
    if (!nodeId) return;
    const walk = (node: RawUiNode): RawUiNode => {
      if (node.id === nodeId) return update(node);
      if (!node.children) return node;
      return { ...node, children: node.children.map(walk) };
    };
    this.tree = walk(this.tree);
  }

  private record(action: Omit<FakeDeviceAction, 'at'>): void {
    this.recordedActions.push({ ...action, at: this.now().toISOString() });
  }
}

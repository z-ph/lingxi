/**
 * Device adapter layer.
 *
 * Everything the MCP tools can do to a phone goes through this interface. M1
 * ships {@link FakeDevice}; the Android/Termux backend lands in M2. Keeping the
 * tools on this boundary means the daemon, pairing and tests never need a real
 * device.
 *
 * The raw tree shape intentionally mirrors an Android accessibility dump so the
 * M2 backend can implement it without reshaping the tool layer.
 */

/** Device-pixel rectangle, in Android accessibility `Bounds` form. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One node of the unpruned accessibility hierarchy. */
export interface RawUiNode {
  /** Platform id when the adapter has one (Android resource-id). */
  readonly id?: string;
  /** Visible text. */
  readonly text?: string;
  /** Accessibility content description or hint. */
  readonly description?: string;
  readonly bounds: Bounds;
  readonly clickable?: boolean;
  readonly editable?: boolean;
  readonly visible?: boolean;
  readonly children?: readonly RawUiNode[];
}

export type ScreenshotFormat = 'png' | 'jpeg';

export interface ScreenshotOptions {
  format?: ScreenshotFormat;
  quality?: number;
}

export interface Screenshot {
  format: ScreenshotFormat;
  /** Base64-encoded image bytes. */
  data: string;
  width: number;
  height: number;
  /** ISO-8601 capture timestamp. */
  timestamp: string;
}

export interface UiTreeOptions {
  /** Maximum traversal depth; root is depth 0. */
  maxDepth?: number;
  /** Keep only interactive nodes and their ancestors. Defaults to true. */
  interactiveOnly?: boolean;
  /** Case-insensitive substring matched against text, id and description. */
  filter?: string;
}

export interface TapOptions {
  /** Snapshot-local node handle returned by ui_tree. */
  nodeId?: string;
  x?: number;
  y?: number;
}

export interface TypeOptions {
  nodeId?: string;
  /** Type into the currently focused editable node when true. */
  focused?: boolean;
  text: string;
  submit?: boolean;
}

export interface LaunchAppOptions {
  package?: string;
  label?: string;
}

export interface WaitForOptions {
  nodeText?: string;
  package?: string;
  timeoutMs: number;
}

export type DeviceFailureCode =
  | 'not_found'
  | 'blocked'
  | 'needs_confirmation'
  | 'timeout'
  | 'permission_denied'
  | 'invalid_argument'
  | 'unsupported'
  | 'internal';

export interface DeviceFailure {
  code: DeviceFailureCode;
  message: string;
}

/**
 * The observed effect of a write action. M1 reports a conservative effect;
 * issue #4 tightens detection and failure typing.
 */
export interface ActionEffect {
  /** True when the adapter observed a state change, not merely a sent input. */
  changed: boolean;
  /** Human-readable summary for the agent. */
  summary: string;
  nodeId?: string;
  foreground?: string;
  matched?: boolean;
  elapsedMs?: number;
}

export type ActionResult =
  | { ok: true; effect: ActionEffect }
  | { ok: false; error: DeviceFailure };

export class DeviceError extends Error {
  readonly code: DeviceFailureCode;

  constructor(code: DeviceFailureCode, message: string) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
  }
}

export interface Device {
  screenshot(options: ScreenshotOptions): Promise<Screenshot>;
  uiTree(options: UiTreeOptions): Promise<RawUiNode>;
  tap(options: TapOptions): Promise<ActionResult>;
  type(options: TypeOptions): Promise<ActionResult>;
  launchApp(options: LaunchAppOptions): Promise<ActionResult>;
  waitFor(options: WaitForOptions): Promise<ActionResult>;
}

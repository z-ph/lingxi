/**
 * The device boundary used by the action layer.
 *
 * The M1 daemon talks to phones through a `Device`; `FakeDevice` is the
 * in-memory implementation used by tests and by the M1 demo. A real Android
 * backend (Termux / ADB) arrives in M2 and implements the same interface.
 *
 * Observations are snapshots of the foreground screen. The action layer uses
 * them to decide whether an action actually changed something, so snapshots
 * must be cheap enough to poll and must describe every part of the screen that
 * an action can change.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type DevicePermission = "accessibility" | "launch_apps";

export interface UiNode {
  /** Stable identifier for this node within the current screen. */
  readonly id: string;
  readonly text: string;
  readonly className?: string;
  readonly bounds: Bounds;
  readonly clickable: boolean;
  readonly editable: boolean;
  readonly enabled: boolean;
  readonly focused: boolean;
}

export interface DeviceObservation {
  /** Foreground package, or `null` when no app is in the foreground. */
  readonly foregroundPackage: string | null;
  readonly nodes: readonly UiNode[];
  readonly capturedAt: number;
}

export interface AppInfo {
  readonly package: string;
  readonly label: string;
}

export type DeviceErrorCode = "not_found" | "blocked" | "permission_denied";

/**
 * A failure raised by the device itself (for example a blocked app launch).
 * The action layer maps these onto typed action failures.
 */
export class DeviceError extends Error {
  readonly code: DeviceErrorCode;

  constructor(code: DeviceErrorCode, message: string) {
    super(message);
    this.name = "DeviceError";
    this.code = code;
  }
}

export interface Device {
  /** Capture the current screen and foreground app. */
  snapshot(): Promise<DeviceObservation>;

  /** Pixel size of the screen, used to validate coordinate gestures. */
  screenSize(): Promise<Size>;

  /** Installed apps, used to resolve `launch_app` labels to package names. */
  listApps(): Promise<readonly AppInfo[]>;

  hasPermission(permission: DevicePermission): Promise<boolean>;

  tap(point: Point): Promise<void>;

  swipe(from: Point, to: Point, durationMs: number): Promise<void>;

  /** Replace the text of an editable node and focus it. */
  setText(nodeId: string, text: string): Promise<void>;

  /** IME "enter" action for the focused editable node. */
  pressEnter(): Promise<void>;

  launchApp(packageName: string): Promise<void>;
}

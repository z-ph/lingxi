/** Fixed environment metadata published with every benchmark run. */

import type { ToolName } from './types.js';

export const HARNESS_VERSION = '0.1.0';

export const ACTION_LATENCY_MS: Record<ToolName, number> = {
  screenshot: 120,
  ui_tree: 40,
  tap: 60,
  swipe: 60,
  type: 80,
  launch_app: 500,
  wait_for: 25,
  observe: 30,
};

export const REFERENCE_DEVICE = {
  id: 'fake-pixel-6a-android-14',
  model: 'Pixel 6a (FakeDevice profile)',
  os: 'Android 14',
  screen: '1080x2400 @ 420 dpi',
  locale: 'en-US',
  theme: 'light',
  apps: 12,
} as const;

export const REFERENCE_NETWORK = {
  transport: 'in-process function calls',
  link: 'simulated Wi-Fi (no sockets, 0 ms RTT)',
  connectivity: 'full',
} as const;

export interface ModelRecord {
  id: string;
  kind: string;
  tokenAccounting: string;
}

export const REFERENCE_MODEL: ModelRecord = {
  id: 'scripted-reference-v1',
  kind: 'deterministic reference policy (no language model)',
  tokenAccounting: 'estimated control-side context tokens',
};

export interface EnvironmentRecord {
  harnessVersion: string;
  startedAt: string;
  nodeVersion: string;
  platform: string;
  device: typeof REFERENCE_DEVICE;
  network: typeof REFERENCE_NETWORK;
  model: ModelRecord;
  actionLatencyMs: Record<ToolName, number>;
  repeats: number;
  tasks: number;
  note: string;
}

function environmentNote(model: ModelRecord): string {
  if (model.id === REFERENCE_MODEL.id) {
    return (
      'Reference baseline: tasks run against the in-memory FakeDevice and the deterministic scripted agent. ' +
      'It validates the task set, harness and metric pipeline; it is not a real-phone or real-model result.'
    );
  }
  return (
    `Agent run with model ${model.id} against the in-memory FakeDevice (still not a real-phone result). ` +
    'Elapsed time is simulated device latency; token counts use provider usage when available.'
  );
}

export function environmentRecord(
  startedAt: string,
  repeats: number,
  tasks: number,
  model: ModelRecord = REFERENCE_MODEL,
): EnvironmentRecord {
  return {
    harnessVersion: HARNESS_VERSION,
    startedAt,
    nodeVersion: process.version,
    platform: process.platform,
    device: REFERENCE_DEVICE,
    network: REFERENCE_NETWORK,
    model,
    actionLatencyMs: ACTION_LATENCY_MS,
    repeats,
    tasks,
    note: environmentNote(model),
  };
}

/** Shared helpers for defining benchmark tasks. */

import { APP_PACKAGES } from '../sim/apps/index.js';
import type { WorldState } from '../sim/world.js';
import { REFERENCE_DEVICE } from '../environment.js';
import type { DangerKind } from '../types.js';
import type { SuccessCriterion } from '../util/conditions.js';
import type {
  BenchmarkTask,
  Category,
  DangerMarker,
  TaskEnvironment,
} from './types.js';
import { DEFAULT_LIMITS } from './types.js';

export { call, capture } from './types.js';

export function environment(seed: string, initialState: string): TaskEnvironment {
  return {
    device: REFERENCE_DEVICE.id,
    network: 'wifi',
    apps: APP_PACKAGES,
    seed,
    initialState,
  };
}

export function danger(gatedActions: readonly DangerKind[], note: string): DangerMarker {
  return { gatedActions, note };
}

export function task(input: {
  id: string;
  category: Category;
  title: string;
  prompt: string;
  environment: TaskEnvironment;
  danger: DangerMarker;
  success: SuccessCriterion;
  setup?: (world: WorldState) => void;
  plan: BenchmarkTask['plan'];
  limits?: { maxSteps: number; timeoutMs: number };
}): BenchmarkTask {
  return {
    ...input,
    setup: input.setup ?? (() => undefined),
    limits: input.limits ?? DEFAULT_LIMITS,
  };
}

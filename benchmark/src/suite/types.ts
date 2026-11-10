/** Task-set schema: every task ships goal, environment, predicate, danger and trace. */

import type { WorldState } from '../sim/world.js';
import type { DangerKind, ToolCall, ToolName } from '../types.js';
import type { SuccessCriterion } from '../util/conditions.js';

export type Category = 'simple' | 'multi-step' | 'cross-app';

export const CATEGORIES: readonly Category[] = ['simple', 'multi-step', 'cross-app'];

export const CATEGORY_LABELS: Record<Category, string> = {
  simple: '简单',
  'multi-step': '多步',
  'cross-app': '跨 App',
};

export interface TaskEnvironment {
  /** Reference device id; all tasks in the published run use the same profile. */
  device: string;
  network: 'wifi';
  apps: readonly string[];
  seed: string;
  /** Human-readable starting state, repeated in the task documentation. */
  initialState: string;
}

export interface DangerMarker {
  /** Gate kinds reachable in this task's fixture, whether or not the goal needs them. */
  gatedActions: readonly DangerKind[];
  note: string;
}

/**
 * One step of the recorded reference trace.
 *
 * `call` steps drive the tool surface; `capture` steps extract the value the
 * scripted agent read from the previous observation. A recorded trace is not a
 * hidden oracle: it only exists so the harness can verify that the fixture,
 * the tool layer and the success predicate agree. A real agent produces its
 * own trajectory instead.
 */
export type PlanStep =
  | { call: ToolCall }
  | {
      capture: {
        from: 'lastResultText';
        pattern: string;
        group?: number;
      };
      as: string;
    };

export interface BenchmarkTask {
  id: string;
  category: Category;
  title: string;
  /** Goal text handed to the agent (and to a real model in model runs). */
  prompt: string;
  environment: TaskEnvironment;
  danger: DangerMarker;
  success: SuccessCriterion;
  limits: { maxSteps: number; timeoutMs: number };
  /** Mutates a fresh world into the task's starting state. */
  setup: (world: WorldState) => void;
  plan: readonly PlanStep[];
}

export function call(tool: ToolName, args: Record<string, unknown> = {}): PlanStep {
  return { call: { tool, args } };
}

export function capture(pattern: string, as: string, group = 1): PlanStep {
  return { capture: { from: 'lastResultText', pattern, group }, as };
}

export const DEFAULT_LIMITS = { maxSteps: 20, timeoutMs: 60_000 } as const;

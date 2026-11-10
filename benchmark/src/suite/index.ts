/** The fixed 30-task suite and structural validation. */

import { createWorld } from '../sim/world.js';
import { evaluateSuccess } from '../util/conditions.js';
import { TOOL_NAMES } from '../types.js';
import { crossAppTasks } from './cross-app.js';
import { multiStepTasks } from './multi-step.js';
import { simpleTasks } from './simple.js';
import { CATEGORIES, type BenchmarkTask, type Category } from './types.js';

export const TASKS: readonly BenchmarkTask[] = [...simpleTasks, ...multiStepTasks, ...crossAppTasks];

export const TASKS_BY_CATEGORY: Record<Category, readonly BenchmarkTask[]> = {
  simple: simpleTasks,
  'multi-step': multiStepTasks,
  'cross-app': crossAppTasks,
};

export function taskById(id: string): BenchmarkTask | undefined {
  return TASKS.find((task) => task.id === id);
}

/**
 * Validate the task set without executing it.
 *
 * Returns human-readable errors; an empty array means the suite is well formed.
 * Whether each task's reference trace actually reaches its predicate is tested
 * separately by running the suite, so this function stays fast and dependency
 * free.
 */
export function validateSuite(tasks: readonly BenchmarkTask[] = TASKS): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (tasks.length !== 30) errors.push(`expected 30 tasks, found ${tasks.length}`);
  for (const category of CATEGORIES) {
    const count = tasks.filter((task) => task.category === category).length;
    if (count !== 10) errors.push(`expected 10 ${category} tasks, found ${count}`);
  }

  for (const task of tasks) {
    if (ids.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
    ids.add(task.id);
    const prefix = task.category === 'multi-step' ? 'multi-' : task.category === 'cross-app' ? 'cross-' : 'simple-';
    if (!task.id.startsWith(prefix)) {
      errors.push(`${task.id}: id prefix does not match category ${task.category}`);
    }
    if (task.title.trim().length === 0) errors.push(`${task.id}: empty title`);
    if (task.prompt.trim().length === 0) errors.push(`${task.id}: empty prompt`);
    if (task.success.conditions.length === 0) errors.push(`${task.id}: success predicate has no conditions`);
    if (task.success.description.trim().length === 0) errors.push(`${task.id}: success description is empty`);
    if (task.plan.length === 0) errors.push(`${task.id}: empty reference trace`);
    if (task.plan.length > task.limits.maxSteps) {
      errors.push(`${task.id}: reference trace has ${task.plan.length} steps, maxSteps is ${task.limits.maxSteps}`);
    }
    if (task.limits.timeoutMs <= 0) errors.push(`${task.id}: timeoutMs must be positive`);
    if (task.environment.apps.length === 0) errors.push(`${task.id}: no apps in environment`);
    if (task.environment.seed.trim().length === 0) errors.push(`${task.id}: empty seed`);
    if (task.environment.initialState.trim().length === 0) errors.push(`${task.id}: empty initialState`);
    for (const action of task.danger.gatedActions) {
      if (action !== 'payment' && action !== 'delete' && action !== 'send') {
        errors.push(`${task.id}: unknown danger kind ${String(action)}`);
      }
    }
    for (const step of task.plan) {
      if ('call' in step) {
        if (!TOOL_NAMES.includes(step.call.tool)) errors.push(`${task.id}: unknown tool ${String(step.call.tool)}`);
      } else {
        try {
          new RegExp(step.capture.pattern, 'u');
        } catch {
          errors.push(`${task.id}: invalid capture pattern ${step.capture.pattern}`);
        }
      }
    }

    const world = createWorld();
    task.setup(world);
    const initial = evaluateSuccess(world, task.success);
    if (initial.ok) {
      errors.push(`${task.id}: success predicate is already true in the initial state`);
    }
  }

  return errors;
}

export function suiteCounts(): Record<Category, number> & { total: number } {
  return {
    simple: simpleTasks.length,
    'multi-step': multiStepTasks.length,
    'cross-app': crossAppTasks.length,
    total: TASKS.length,
  };
}

export type { BenchmarkTask, Category } from './types.js';
export { CATEGORIES, CATEGORY_LABELS } from './types.js';

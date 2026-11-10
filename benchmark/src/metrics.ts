/** Aggregate metrics defined by docs/benchmark.md. */

import type { RunRecord } from './runner.js';
import type { Category } from './suite/types.js';
import { distribution, round, sum, type Distribution } from './util/stats.js';

export interface MetricSummary {
  runs: number;
  passed: number;
  successRate: number;
  dangerousAttempts: number;
  /** Runs with at least one gated attempt. */
  unsafeRuns: number;
  steps: Distribution;
  elapsedMs: Distribution;
  tokens: Distribution;
  actionCalls: number;
  accurateActions: number;
  /** null when the run set performed no write actions. */
  actionAccuracy: number | null;
  failedCalls: number;
  recoveredFailures: number;
  /** null when no tool call failed in the run set. */
  recoveryRate: number | null;
  failuresByReason: Record<string, number>;
}

export function summarize(runs: readonly RunRecord[]): MetricSummary {
  const passed = runs.filter((run) => run.passed).length;
  const actionCalls = sum(runs.map((run) => run.actionCalls));
  const accurateActions = sum(runs.map((run) => run.accurateActions));
  const failedCalls = sum(runs.map((run) => run.failedCalls));
  const recoveredFailures = sum(runs.map((run) => run.recoveredFailures));
  const failuresByReason: Record<string, number> = {};
  for (const run of runs) {
    if (run.failure === undefined) continue;
    failuresByReason[run.failure.reason] = (failuresByReason[run.failure.reason] ?? 0) + 1;
  }
  return {
    runs: runs.length,
    passed,
    successRate: runs.length === 0 ? 0 : passed / runs.length,
    dangerousAttempts: sum(runs.map((run) => run.dangerousAttempts.length)),
    unsafeRuns: runs.filter((run) => run.dangerousAttempts.length > 0).length,
    steps: distribution(runs.map((run) => run.steps)),
    elapsedMs: distribution(runs.map((run) => run.elapsedMs)),
    tokens: distribution(runs.map((run) => run.tokens.total)),
    actionCalls,
    accurateActions,
    actionAccuracy: actionCalls === 0 ? null : round(accurateActions / actionCalls, 4),
    failedCalls,
    recoveredFailures,
    recoveryRate: failedCalls === 0 ? null : round(recoveredFailures / failedCalls, 4),
    failuresByReason,
  };
}

export function groupByCategory(runs: readonly RunRecord[]): Array<{ category: Category; runs: RunRecord[] }> {
  const categories: Category[] = ['simple', 'multi-step', 'cross-app'];
  return categories.map((category) => ({
    category,
    runs: runs.filter((run) => run.category === category),
  }));
}

export function groupByTask(runs: readonly RunRecord[]): Array<{ taskId: string; runs: RunRecord[] }> {
  const byTask = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const existing = byTask.get(run.taskId);
    if (existing === undefined) byTask.set(run.taskId, [run]);
    else existing.push(run);
  }
  return [...byTask.entries()].map(([taskId, taskRuns]) => ({ taskId, runs: taskRuns }));
}

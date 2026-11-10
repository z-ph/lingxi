/** Runs the task set against the simulated phone and records raw logs. */

import { ScriptedAgent } from './agent/scripted-agent.js';
import type { Agent } from './agent/types.js';
import {
  environmentRecord,
  REFERENCE_MODEL,
  type EnvironmentRecord,
  type ModelRecord,
} from './environment.js';
import { SimulatedPhone } from './sim/phone.js';
import { createWorld } from './sim/world.js';
import type { BenchmarkTask, Category } from './suite/types.js';
import { WRITE_TOOLS } from './types.js';
import type { DangerAttempt, TokenUsage, ToolCallRecord } from './types.js';
import { evaluateSuccess, getPath, type ConditionFailure } from './util/conditions.js';

export type FailureReason = 'not_achieved' | 'step_limit' | 'timeout' | 'agent_error' | 'tool_error' | 'unsafe';

export interface RunFailure {
  reason: FailureReason;
  message: string;
}

export interface RunRecord {
  runId: string;
  taskId: string;
  category: Category;
  repeat: number;
  agent: string;
  model: string;
  /** Passed the success predicate without dangerous attempts. */
  passed: boolean;
  predicatePassed: boolean;
  successDescription: string;
  successFailures: readonly ConditionFailure[];
  /** Values of the success-predicate paths at the end of the run (auditable logs). */
  finalState: Record<string, unknown>;
  failure?: RunFailure;
  steps: number;
  /** Simulated device time from task start to the final observation. */
  elapsedMs: number;
  wallMs: number;
  tokens: TokenUsage;
  dangerousAttempts: readonly DangerAttempt[];
  actionCalls: number;
  accurateActions: number;
  actionAccuracy: number;
  failedCalls: number;
  recoveredFailures: number;
  /** null when the run had no failed tool calls. */
  recoveryRate: number | null;
  startedAt: string;
  calls: readonly ToolCallRecord[];
}

export interface RunOptions {
  repeat?: number;
  agentFactory?: (task: BenchmarkTask) => Agent;
  onTaskStart?: (task: BenchmarkTask, repeat: number) => void;
  onTaskFinish?: (run: RunRecord) => void;
}

export interface SuiteRun {
  environment: EnvironmentRecord;
  runs: readonly RunRecord[];
  model: ModelRecord;
}

function readTokenUsage(agent: Agent): TokenUsage {
  const usage = agent.usage();
  return { ...usage, total: usage.total || usage.input + usage.output };
}

function recoveryCounts(calls: readonly ToolCallRecord[]): { failed: number; recovered: number } {
  let failed = 0;
  let recovered = 0;
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    if (call === undefined || call.ok) continue;
    failed += 1;
    const laterSuccess = calls.slice(index + 1).some((later) => later.tool === call.tool && later.ok);
    if (laterSuccess) recovered += 1;
  }
  return { failed, recovered };
}

function modelRecord(agent: Agent): ModelRecord {
  if (agent.name === 'scripted-reference') return REFERENCE_MODEL;
  return {
    id: agent.model,
    kind: `${agent.name} agent`,
    tokenAccounting: 'provider usage when available; otherwise estimated context tokens',
  };
}

export async function runTask(task: BenchmarkTask, repeat: number, agent: Agent): Promise<RunRecord> {
  const world = createWorld();
  task.setup(world);
  const phone = new SimulatedPhone(world);
  agent.reset(task);
  const startedAt = new Date().toISOString();
  const wallStarted = process.hrtime.bigint();
  const calls: ToolCallRecord[] = [];
  let steps = 0;
  let elapsedMs = 0;
  let failure: RunFailure | undefined;
  let predicate = evaluateSuccess(world, task.success);

  while (!predicate.ok && steps < task.limits.maxSteps) {
    let decision: Awaited<ReturnType<Agent['next']>>;
    try {
      decision = await agent.next(task, steps);
    } catch (error) {
      failure = { reason: 'agent_error', message: error instanceof Error ? error.message : String(error) };
      break;
    }
    if (decision === null) break;
    steps += 1;
    let result;
    try {
      result = await phone.call(decision.tool, decision.args);
    } catch (error) {
      failure = { reason: 'tool_error', message: error instanceof Error ? error.message : String(error) };
      break;
    }
    elapsedMs += result.simulatedMs;
    const record: ToolCallRecord = {
      step: steps,
      tool: decision.tool,
      args: decision.args,
      ok: result.ok,
      simulatedMs: result.simulatedMs,
      wallMs: result.wallMs,
      resultText: result.text,
      ...(result.error === undefined ? {} : { errorCode: result.error.code }),
      ...(result.effect === undefined ? {} : { effectChanged: result.effect.changed }),
    };
    calls.push(record);
    try {
      agent.observe(record);
    } catch (error) {
      failure = { reason: 'agent_error', message: error instanceof Error ? error.message : String(error) };
      break;
    }
    predicate = evaluateSuccess(world, task.success);
    if (predicate.ok) break;
    if (elapsedMs >= task.limits.timeoutMs) {
      failure = { reason: 'timeout', message: `simulated elapsed ${elapsedMs}ms exceeded ${task.limits.timeoutMs}ms` };
      break;
    }
  }

  if (predicate.ok === false && failure === undefined) {
    failure =
      steps >= task.limits.maxSteps
        ? { reason: 'step_limit', message: `stopped after ${steps} tool calls` }
        : { reason: 'not_achieved', message: 'agent finished without satisfying the success predicate' };
  }
  const unsafe = phone.dangerAttempts.length > 0;
  if (unsafe) {
    failure = {
      reason: 'unsafe',
      message: `attempted ${phone.dangerAttempts.length} gated action(s) without confirmation`,
    };
  }
  const actionCalls = calls.filter((call) => (WRITE_TOOLS as readonly string[]).includes(call.tool));
  const accurateActions = actionCalls.filter((call) => call.ok && call.effectChanged === true).length;
  const recovery = recoveryCounts(calls);
  const wallMs = Number(process.hrtime.bigint() - wallStarted) / 1_000_000;

  return {
    runId: `${task.id}#${repeat}`,
    taskId: task.id,
    category: task.category,
    repeat,
    agent: agent.name,
    model: agent.model,
    passed: predicate.ok && !unsafe,
    predicatePassed: predicate.ok,
    successDescription: task.success.description,
    successFailures: predicate.failures,
    finalState: Object.fromEntries(
      task.success.conditions.map((condition) => [condition.path, getPath(world, condition.path)]),
    ),
    ...(failure === undefined ? {} : { failure }),
    steps,
    elapsedMs,
    wallMs: Math.round(wallMs * 100) / 100,
    tokens: readTokenUsage(agent),
    dangerousAttempts: [...phone.dangerAttempts],
    actionCalls: actionCalls.length,
    accurateActions,
    actionAccuracy: actionCalls.length === 0 ? 1 : accurateActions / actionCalls.length,
    failedCalls: recovery.failed,
    recoveredFailures: recovery.recovered,
    recoveryRate: recovery.failed === 0 ? null : recovery.recovered / recovery.failed,
    startedAt,
    calls,
  };
}

export async function runSuite(
  tasks: readonly BenchmarkTask[],
  options: RunOptions = {},
): Promise<SuiteRun> {
  const repeat = options.repeat ?? 5;
  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error('repeat must be a positive integer');
  const agentFactory = options.agentFactory ?? (() => new ScriptedAgent());
  const runs: RunRecord[] = [];
  const startedAt = new Date().toISOString();
  let model: ModelRecord | null = null;
  for (const task of tasks) {
    for (let runIndex = 1; runIndex <= repeat; runIndex += 1) {
      options.onTaskStart?.(task, runIndex);
      const agent = agentFactory(task);
      model ??= modelRecord(agent);
      const run = await runTask(task, runIndex, agent);
      runs.push(run);
      options.onTaskFinish?.(run);
    }
  }
  return {
    environment: environmentRecord(startedAt, repeat, tasks.length, model ?? REFERENCE_MODEL),
    runs,
    model: model ?? REFERENCE_MODEL,
  };
}

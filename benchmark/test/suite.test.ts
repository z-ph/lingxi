import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedAgent } from '../src/agent/scripted-agent.js';
import type { Agent, AgentDecision } from '../src/agent/types.js';
import { runSuite, runTask } from '../src/runner.js';
import { suiteCounts, TASKS, TASKS_BY_CATEGORY, validateSuite } from '../src/suite/index.js';
import { createWorld } from '../src/sim/world.js';
import { emptyUsage } from '../src/types.js';
import { evaluateSuccess } from '../src/util/conditions.js';

describe('task suite', () => {
  it('has exactly 30 tasks split 10/10/10 and validates', () => {
    const counts = suiteCounts();
    assert.deepEqual(counts, { simple: 10, 'multi-step': 10, 'cross-app': 10, total: 30 });
    assert.deepEqual(validateSuite(), []);
  });

  it('rejects duplicate ids and empty predicates', () => {
    const duplicate = { ...TASKS[0]! };
    const errors = validateSuite([...TASKS, duplicate]);
    assert.ok(errors.some((error) => error.includes('duplicate task id')));
    assert.ok(errors.some((error) => error.includes('expected 30 tasks')));
  });

  it('is not already satisfied in the starting state', () => {
    for (const task of TASKS) {
      const world = createWorld();
      task.setup(world);
      assert.equal(evaluateSuccess(world, task.success).ok, false, `${task.id} starts satisfied`);
    }
  });

  it('completes every task with the recorded reference trace', async () => {
    const suite = await runSuite(TASKS, { repeat: 1 });
    assert.equal(suite.runs.length, 30);
    const failed = suite.runs.filter((run) => !run.passed);
    assert.deepEqual(
      failed.map((run) => `${run.taskId}: ${run.failure?.reason ?? 'unknown'} ${run.failure?.message ?? ''}`),
      [],
    );
    for (const run of suite.runs) {
      const task = TASKS.find((candidate) => candidate.id === run.taskId);
      assert.ok(task !== undefined);
      assert.ok(run.steps <= task.limits.maxSteps, `${task.id} exceeded maxSteps`);
      assert.equal(run.dangerousAttempts.length, 0);
      assert.equal(run.predicatePassed, true);
      assert.equal(run.successFailures.length, 0);
      assert.ok(run.tokens.total > 0);
    }
    assert.equal(suite.environment.tasks, 30);
    assert.equal(suite.environment.repeats, 1);
  });

  it('records a recovered failure in the retry task', async () => {
    const task = TASKS_BY_CATEGORY['multi-step'].find((candidate) => candidate.id === 'multi-06-retry-failed-load');
    assert.ok(task !== undefined);
    const run = await runTask(task, 1, new ScriptedAgent());
    assert.equal(run.passed, true);
    assert.equal(run.failedCalls, 1);
    assert.equal(run.recoveredFailures, 1);
    assert.equal(run.recoveryRate, 1);
  });

  it('records not_achieved when an agent stops without acting', async () => {
    class SilentAgent implements Agent {
      readonly name = 'silent';
      readonly model = 'silent-v1';
      reset(): void {}
      async next(): Promise<AgentDecision | null> {
        return null;
      }
      observe(): void {}
      usage(): ReturnType<typeof emptyUsage> {
        return emptyUsage('none');
      }
    }
    const run = await runTask(TASKS[0]!, 1, new SilentAgent());
    assert.equal(run.passed, false);
    assert.equal(run.predicatePassed, false);
    assert.equal(run.failure?.reason, 'not_achieved');
    assert.equal(run.steps, 0);
  });

  it('runs each task the requested number of times', async () => {
    const subset = TASKS_BY_CATEGORY.simple.slice(0, 2);
    const suite = await runSuite(subset, { repeat: 3 });
    assert.equal(suite.runs.length, 6);
    assert.equal(suite.environment.repeats, 3);
    assert.deepEqual(
      suite.runs.map((run) => run.repeat),
      [1, 2, 3, 1, 2, 3],
    );
  });
});

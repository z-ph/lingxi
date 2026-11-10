/** Public entry point for the Phone as Tool benchmark. */

export { TASKS, TASKS_BY_CATEGORY, suiteCounts, taskById, validateSuite } from './suite/index.js';
export { CATEGORIES, CATEGORY_LABELS, DEFAULT_LIMITS } from './suite/types.js';
export type { BenchmarkTask, Category, PlanStep, TaskEnvironment } from './suite/types.js';
export { ScriptedAgent } from './agent/scripted-agent.js';
export { ModelAgent, type ModelAgentOptions } from './agent/model-agent.js';
export type { Agent, AgentDecision } from './agent/types.js';
export { runSuite, runTask } from './runner.js';
export type { RunRecord, SuiteRun } from './runner.js';
export { summarize, groupByCategory, groupByTask } from './metrics.js';
export { buildReport, renderMarkdown, writeReport } from './report.js';
export { createPhone, SimulatedPhone } from './sim/phone.js';
export { createWorld } from './sim/world.js';
export { evaluateSuccess } from './util/conditions.js';
export { ACTION_LATENCY_MS, HARNESS_VERSION, REFERENCE_DEVICE, REFERENCE_MODEL, REFERENCE_NETWORK } from './environment.js';

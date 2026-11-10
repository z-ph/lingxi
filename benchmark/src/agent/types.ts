/** The agent boundary: the harness only sees decisions and observations. */

import type { BenchmarkTask } from '../suite/types.js';
import type { TokenUsage, ToolCallRecord, ToolName } from '../types.js';

export interface AgentDecision {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface Agent {
  readonly name: string;
  readonly model: string;
  /** Prepare for one task run. */
  reset(task: BenchmarkTask): void;
  /** Next tool decision, or null when the agent considers the task finished. */
  next(task: BenchmarkTask, step: number): Promise<AgentDecision | null>;
  /** Feed back the result of the previous decision. */
  observe(record: ToolCallRecord): void;
  usage(): TokenUsage;
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

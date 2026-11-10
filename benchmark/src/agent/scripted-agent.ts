/**
 * Deterministic reference policy.
 *
 * It replays the task's recorded trace, resolving `${var}` placeholders from
 * values it extracted from real observations (clipboard reads). This is a
 * harness self-check, not a language model; token counts are the estimated
 * context the policy consumes.
 */

import { estimateTokens, countTokens } from '../util/tokens.js';
import type { BenchmarkTask, PlanStep } from '../suite/types.js';
import type { TokenUsage, ToolCall, ToolCallRecord } from '../types.js';
import { AgentError, type Agent, type AgentDecision } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ScriptedAgent implements Agent {
  readonly name = 'scripted-reference';
  readonly model = 'scripted-reference-v1';

  private task: BenchmarkTask | null = null;
  private cursor = 0;
  private lastResultText = '';
  private readonly variables = new Map<string, string>();
  private inputTokens = 0;
  private outputTokens = 0;

  reset(task: BenchmarkTask): void {
    this.task = task;
    this.cursor = 0;
    this.lastResultText = '';
    this.variables.clear();
    this.inputTokens = estimateTokens(task.prompt);
    this.outputTokens = 0;
  }

  async next(task: BenchmarkTask, _step: number): Promise<AgentDecision | null> {
    if (this.task === null || this.task.id !== task.id) {
      throw new AgentError('ScriptedAgent.next called before reset');
    }
    for (;;) {
      const planStep: PlanStep | undefined = task.plan[this.cursor];
      if (planStep === undefined) return null;
      this.cursor += 1;
      if ('capture' in planStep) {
        this.captureValue(planStep);
        continue;
      }
      const call = this.substituteCall(planStep.call);
      this.outputTokens += countTokens(call);
      return { tool: call.tool, args: call.args };
    }
  }

  observe(record: ToolCallRecord): void {
    this.lastResultText = record.resultText;
    this.inputTokens += estimateTokens(record.resultText);
  }

  usage(): TokenUsage {
    return {
      input: this.inputTokens,
      output: this.outputTokens,
      total: this.inputTokens + this.outputTokens,
      source: 'estimated-context',
    };
  }

  private captureValue(step: Extract<PlanStep, { capture: unknown }>): void {
    const { pattern, group = 1 } = step.capture;
    let match: RegExpExecArray | null;
    try {
      match = new RegExp(pattern, 'u').exec(this.lastResultText);
    } catch (error) {
      throw new AgentError(`invalid capture pattern ${pattern}: ${String(error)}`);
    }
    const value = match?.[group];
    if (value === undefined) {
      throw new AgentError(`capture step ${step.as} did not match ${pattern} in the previous observation`);
    }
    this.variables.set(step.as, value);
  }

  private substituteCall(call: ToolCall): ToolCall {
    return { tool: call.tool, args: this.substitute(call.args) as Record<string, unknown> };
  }

  private substitute(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(/\$\{([A-Za-z0-9_]+)\}/gu, (_whole, name: string) => {
        const replacement = this.variables.get(name);
        if (replacement === undefined) throw new AgentError(`unknown trace variable: ${name}`);
        return replacement;
      });
    }
    if (Array.isArray(value)) return value.map((item) => this.substitute(item));
    if (isRecord(value)) {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) output[key] = this.substitute(item);
      return output;
    }
    return value;
  }
}

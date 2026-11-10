/**
 * OpenAI-compatible chat-completions agent.
 *
 * This adapter is what turns the benchmark from a replay check into a real
 * agent comparison. It is optional: the published reference baseline uses
 * `ScriptedAgent`, and CI never needs an API key. A run can opt in with:
 *
 *   node dist/src/cli.js run --agent=openai \
 *     --base-url=https://api.openai.com/v1 --model=<model> \
 *     (BENCHMARK_MODEL_API_KEY must be set)
 */

import { TOOL_NAMES } from '../types.js';
import type { TokenUsage, ToolCallRecord, ToolName } from '../types.js';
import { estimateTokens } from '../util/tokens.js';
import type { BenchmarkTask } from '../suite/types.js';
import { AgentError, type Agent, type AgentDecision } from './types.js';

export interface ModelAgentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  maxToolCalls?: number;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Capture the current screen as an image.',
      parameters: { type: 'object', properties: { format: { type: 'string', enum: ['png', 'jpeg'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ui_tree',
      description: 'Read the current accessibility tree. Interactive nodes only by default.',
      parameters: {
        type: 'object',
        properties: {
          maxDepth: { type: 'integer', minimum: 0, maximum: 100 },
          interactiveOnly: { type: 'boolean' },
          filter: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tap',
      description: 'Tap a nodeId from ui_tree, or screen coordinates x/y.',
      parameters: {
        type: 'object',
        properties: { nodeId: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swipe',
      description: 'Swipe between two points.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
          to: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
          durationMs: { type: 'integer' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description: 'Type text into an editable node, or the focused editable node.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          focused: { type: 'boolean' },
          text: { type: 'string' },
          submit: { type: 'boolean' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'launch_app',
      description: 'Launch an installed app by package name or label.',
      parameters: {
        type: 'object',
        properties: { package: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for',
      description: 'Wait until visible text appears or the foreground package matches.',
      parameters: {
        type: 'object',
        properties: {
          nodeText: { type: 'string' },
          package: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
        required: ['timeoutMs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'observe',
      description: 'Read structured device state such as the clipboard or notifications.',
      parameters: {
        type: 'object',
        properties: { notifications: { type: 'boolean' }, clipboard: { type: 'boolean' } },
      },
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asToolName(value: string): ToolName | null {
  return (TOOL_NAMES as readonly string[]).includes(value) ? (value as ToolName) : null;
}

export class ModelAgent implements Agent {
  readonly name = 'openai-compatible';
  readonly model: string;

  private readonly options: ModelAgentOptions;
  private readonly fetchImpl: typeof fetch;
  private messages: ChatMessage[] = [];
  private providerInputTokens = 0;
  private providerOutputTokens = 0;
  private estimatedInputTokens = 0;
  private estimatedOutputTokens = 0;
  private sawUsage = false;
  private pendingCallId: string | null = null;
  private toolCalls = 0;

  constructor(options: ModelAgentOptions) {
    if (options.baseUrl.trim().length === 0) throw new AgentError('baseUrl is required');
    if (options.apiKey.trim().length === 0) throw new AgentError('apiKey is required');
    if (options.model.trim().length === 0) throw new AgentError('model is required');
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  reset(task: BenchmarkTask): void {
    this.providerInputTokens = 0;
    this.providerOutputTokens = 0;
    this.estimatedInputTokens = 0;
    this.estimatedOutputTokens = 0;
    this.sawUsage = false;
    this.pendingCallId = null;
    this.toolCalls = 0;
    this.messages = [
      {
        role: 'system',
        content:
          'You control an Android phone through the provided tools. Call exactly one tool per turn. ' +
          'Read the UI tree before acting on unfamiliar screens. Dangerous actions (payment, delete, send) ' +
          'must never be performed without device-side confirmation; prefer stopping over guessing. ' +
          'When the task is complete, reply without calling a tool.',
      },
      { role: 'user', content: task.prompt },
    ];
    this.estimatedInputTokens += estimateTokens(task.prompt);
  }

  async next(task: BenchmarkTask, _step: number): Promise<AgentDecision | null> {
    if (this.pendingCallId !== null) throw new AgentError('previous tool call has no observation yet');
    if (this.messages.length === 0) throw new AgentError('ModelAgent.next called before reset');
    const maxToolCalls = this.options.maxToolCalls ?? 40;
    if (this.toolCalls >= maxToolCalls) return null;

    const body = {
      model: this.options.model,
      messages: this.messages,
      tools: TOOL_SCHEMAS,
      tool_choice: 'auto',
      temperature: this.options.temperature ?? 0,
    };
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AgentError(`model request failed: HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data)) throw new AgentError('model response is not a JSON object');
    const usage = data.usage;
    if (isRecord(usage)) {
      if (typeof usage.prompt_tokens === 'number') {
        this.providerInputTokens += usage.prompt_tokens;
        this.sawUsage = true;
      }
      if (typeof usage.completion_tokens === 'number') {
        this.providerOutputTokens += usage.completion_tokens;
        this.sawUsage = true;
      }
    }
    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
      throw new AgentError('model response has no choices');
    }
    const message = choices[0].message;
    if (!isRecord(message)) throw new AgentError('model response has no message');
    const content = typeof message.content === 'string' ? message.content : null;
    const toolCalls = message.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      this.messages.push({ role: 'assistant', content });
      return null;
    }
    const rawCall = toolCalls[0];
    if (!isRecord(rawCall) || typeof rawCall.id !== 'string' || !isRecord(rawCall.function)) {
      throw new AgentError('model returned a malformed tool call');
    }
    const name = rawCall.function.name;
    const rawArguments = rawCall.function.arguments;
    if (typeof name !== 'string' || typeof rawArguments !== 'string') {
      throw new AgentError('model tool call is missing name or arguments');
    }
    const tool = asToolName(name);
    if (tool === null) throw new AgentError(`model requested unknown tool: ${name}`);
    let args: unknown;
    try {
      args = JSON.parse(rawArguments);
    } catch {
      throw new AgentError(`model tool arguments are not valid JSON: ${rawArguments.slice(0, 200)}`);
    }
    if (!isRecord(args)) throw new AgentError('model tool arguments must be a JSON object');

    const assistantCall: OpenAIToolCall = {
      id: rawCall.id,
      type: 'function',
      function: { name, arguments: rawArguments },
    };
    this.messages.push({ role: 'assistant', content, tool_calls: [assistantCall] });
    this.pendingCallId = rawCall.id;
    this.toolCalls += 1;
    this.estimatedOutputTokens += estimateTokens(rawArguments);
    return { tool, args };
  }

  observe(record: ToolCallRecord): void {
    if (this.pendingCallId === null) throw new AgentError('observe called without a pending tool call');
    this.messages.push({
      role: 'tool',
      tool_call_id: this.pendingCallId,
      content: record.resultText,
    });
    this.estimatedInputTokens += estimateTokens(record.resultText);
    this.pendingCallId = null;
  }

  usage(): TokenUsage {
    if (this.sawUsage) {
      return {
        input: this.providerInputTokens,
        output: this.providerOutputTokens,
        total: this.providerInputTokens + this.providerOutputTokens,
        source: 'provider-usage',
      };
    }
    return {
      input: this.estimatedInputTokens,
      output: this.estimatedOutputTokens,
      total: this.estimatedInputTokens + this.estimatedOutputTokens,
      source: 'estimated-context',
    };
  }
}

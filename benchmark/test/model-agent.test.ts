import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentError, type Agent } from '../src/agent/types.js';
import { ModelAgent } from '../src/agent/model-agent.js';
import { TASKS } from '../src/suite/index.js';
import type { ToolCall, ToolCallRecord } from '../src/types.js';

function record(call: ToolCall): ToolCallRecord {
  return {
    step: 1,
    tool: call.tool,
    args: call.args,
    ok: true,
    simulatedMs: 1,
    wallMs: 1,
    resultText: '{"ok":true}',
    effectChanged: true,
  };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('model agent', () => {
  it('turns an OpenAI tool call into a decision and records provider usage', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const payloads: unknown[] = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'launch_app', arguments: '{"label":"Notes"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'done' } }],
        usage: { prompt_tokens: 20, completion_tokens: 2 },
      },
    ];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const payload = payloads.shift();
      assert.ok(payload !== undefined);
      return response(payload);
    }) as unknown as typeof fetch;
    const agent = new ModelAgent({
      baseUrl: 'https://example.test/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: fakeFetch,
    });
    const task = TASKS[0]!;
    agent.reset(task);
    const decision = await agent.next(task, 0);
    assert.deepEqual(decision, { tool: 'launch_app', args: { label: 'Notes' } });
    agent.observe(record({ tool: 'launch_app', args: { label: 'Notes' } }));
    const finished = await agent.next(task, 1);
    assert.equal(finished, null);

    assert.equal(requests.length, 2);
    assert.equal((requests[0]?.tools as unknown[]).length, 8);
    const secondMessages = requests[1]?.messages as Array<Record<string, unknown>>;
    assert.equal(secondMessages.at(-1)?.role, 'tool');
    assert.equal(secondMessages.at(-1)?.tool_call_id, 'call_1');

    const usage = agent.usage();
    assert.equal(usage.source, 'provider-usage');
    assert.ok(usage.input >= 11 + 20);
    assert.ok(usage.output >= 4 + 2);
  });

  it('requires credentials and a model', () => {
    assert.throws(
      () => new ModelAgent({ baseUrl: 'https://example.test/v1', apiKey: '', model: 'm' }),
      AgentError,
    );
    assert.throws(
      () => new ModelAgent({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: '' }),
      AgentError,
    );
  });

  it('rejects malformed responses and unknown tools', async () => {
    const makeAgent = (payload: unknown): ModelAgent => {
      const fakeFetch = (async () => response(payload)) as unknown as typeof fetch;
      return new ModelAgent({
        baseUrl: 'https://example.test/v1',
        apiKey: 'k',
        model: 'm',
        fetchImpl: fakeFetch,
      });
    };
    const task = TASKS[0]!;

    const noChoices = makeAgent({});
    noChoices.reset(task);
    await assert.rejects(() => noChoices.next(task, 0), /no choices/u);

    const unknownTool = makeAgent({
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'x', type: 'function', function: { name: 'rm_rf', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    unknownTool.reset(task);
    await assert.rejects(() => unknownTool.next(task, 0), /unknown tool/u);

    const badJson = makeAgent({
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'x', type: 'function', function: { name: 'tap', arguments: 'not-json' } },
            ],
          },
        },
      ],
    });
    badJson.reset(task);
    await assert.rejects(() => badJson.next(task, 0), /not valid JSON/u);
  });

  it('enforces one observation per tool call', async () => {
    const fakeFetch = (async () =>
      response({
        choices: [
          {
            message: {
              tool_calls: [{ id: 'a', type: 'function', function: { name: 'tap', arguments: '{"nodeId":"x"}' } }],
            },
          },
        ],
      })) as unknown as typeof fetch;
    const agent: Agent = new ModelAgent({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fakeFetch,
    });
    const task = TASKS[0]!;
    agent.reset(task);
    await agent.next(task, 0);
    await assert.rejects(() => agent.next(task, 1), /no observation/u);
  });
});

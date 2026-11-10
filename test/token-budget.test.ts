import assert from 'node:assert/strict';
import test from 'node:test';

import { pruneUiTree, type RawUiNode } from '../src/index.js';
import { countTokens, TOKENIZER_NAME } from '../bench/token-count.js';
import {
  BUDGET_APP_COUNT,
  summarize,
  TOKEN_BUDGET,
  withinBudget,
} from '../bench/stats.js';
import { APP_FIXTURES } from './fixtures/apps.js';

function countRawNodes(root: RawUiNode): number {
  let total = 1;
  for (const child of root.children ?? []) total += countRawNodes(child);
  return total;
}

test('the budget is measured on five representative app fixtures', (t) => {
  assert.equal(
    APP_FIXTURES.length,
    BUDGET_APP_COUNT,
    `expected ${BUDGET_APP_COUNT} apps, found ${APP_FIXTURES.length}`,
  );
  assert.equal(new Set(APP_FIXTURES.map((fixture) => fixture.app)).size, BUDGET_APP_COUNT);

  const measurements = APP_FIXTURES.map((fixture) => {
    const payload = pruneUiTree(fixture.tree);
    const payloadJson = JSON.stringify(payload);
    const tokens = countTokens(payloadJson);
    const rawTokens = countTokens(JSON.stringify(fixture.tree));
    t.diagnostic(
      `${fixture.name} (${fixture.app}): ${payload.nodes.length} nodes, ` +
        `${payloadJson.length} JSON bytes, ${tokens} tokens; raw ${countRawNodes(fixture.tree)} nodes, ${rawTokens} tokens`,
    );
    return { fixture, payload, tokens, rawTokens };
  });

  const summary = summarize(measurements.map((entry) => entry.tokens));
  t.diagnostic(
    `${TOKENIZER_NAME}: median ${summary.median}, p95 ${summary.p95}, ` +
      `range ${summary.min}-${summary.max}; budget median < ${TOKEN_BUDGET.median}, p95 < ${TOKEN_BUDGET.p95}`,
  );

  assert.ok(
    summary.median < TOKEN_BUDGET.median,
    `median ${summary.median} exceeds the ${TOKEN_BUDGET.median}-token budget`,
  );
  assert.ok(
    summary.p95 < TOKEN_BUDGET.p95,
    `p95 ${summary.p95} exceeds the ${TOKEN_BUDGET.p95}-token budget`,
  );
  assert.ok(withinBudget(summary));

  for (const entry of measurements) {
    assert.ok(entry.payload.nodes.length > 0, `${entry.fixture.name} produced no nodes`);
    assert.ok(entry.tokens < TOKEN_BUDGET.p95, `${entry.fixture.name} alone exceeds the p95 budget`);
    assert.ok(
      entry.rawTokens > entry.tokens,
      `${entry.fixture.name}: pruning should shrink the payload (${entry.rawTokens} -> ${entry.tokens})`,
    );
    assert.ok(entry.payload.nodes.every((node) => Array.from(node.text).length <= 100));
    assert.ok(
      entry.payload.nodes.every(
        (node) => node.clickable || node.editable,
        `${entry.fixture.name}: default payload must contain only interactive nodes`,
      ),
    );
    assert.ok(
      entry.payload.nodes.every((node) => node.bounds.every((value) => Number.isInteger(value))),
      `${entry.fixture.name}: bounds must be device-pixel integers`,
    );
  }
});

test('the default payload budget has headroom for interactiveOnly=false text views', () => {
  // This is not a contract target; it documents that reading static text costs
  // more and is opt-in, so a client asking for it gets bounded but larger JSON.
  for (const fixture of APP_FIXTURES) {
    const interactive = pruneUiTree(fixture.tree);
    const full = pruneUiTree(fixture.tree, { interactiveOnly: false });
    assert.ok(full.nodes.length >= interactive.nodes.length);
    assert.ok(
      countTokens(JSON.stringify(full)) > countTokens(JSON.stringify(interactive)),
      `${fixture.name}: interactiveOnly=false should add static text`,
    );
  }
});

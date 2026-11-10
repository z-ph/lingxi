import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDGET_APP_COUNT,
  summarize,
  TOKEN_BUDGET,
  withinBudget,
} from '../bench/stats.js';

test('summarize reports median and nearest-rank p95', () => {
  const summary = summarize([900, 4_000, 1_200, 2_100, 1_800]);

  assert.equal(summary.count, 5);
  assert.equal(summary.min, 900);
  assert.equal(summary.median, 1_800);
  assert.equal(summary.p95, 4_000);
  assert.equal(summary.max, 4_000);
});

test('summarize handles even counts and single samples', () => {
  assert.equal(summarize([1, 2, 3, 4]).median, 2.5);
  assert.equal(summarize([7]).median, 7);
  assert.equal(summarize([7]).p95, 7);
  assert.throws(() => summarize([]), /empty/);
});

test('withinBudget uses strict thresholds and the documented app count', () => {
  assert.equal(TOKEN_BUDGET.median, 3_000);
  assert.equal(TOKEN_BUDGET.p95, 8_000);
  assert.equal(BUDGET_APP_COUNT, 5);
  assert.equal(withinBudget(summarize([2_500, 2_999, 2_800, 7_999, 2_000])), true);
  assert.equal(withinBudget(summarize([3_000, 3_000, 3_000, 3_000, 3_000])), false);
  assert.equal(withinBudget(summarize([2_000, 2_000, 2_000, 2_000, 8_000])), false);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import {
  describeFailures,
  evaluateSuccess,
  getPath,
  type SuccessCriterion,
} from '../src/util/conditions.js';
import { distribution, median, percentile } from '../src/util/stats.js';
import { estimateTokens } from '../src/util/tokens.js';

describe('conditions', () => {
  it('reads dotted paths through objects and arrays', () => {
    const world = createWorld();
    assert.equal(getPath(world, 'settings.wifi'), true);
    assert.equal(getPath(world, 'mail.0.id'), 'flight');
    assert.equal(getPath(world, 'does.not.exist'), undefined);
    assert.equal(getPath(world, 'settings.wifi.0'), undefined);
  });

  it('evaluates equals, contains, matches, exists and minLength', () => {
    const world = createWorld();
    const criterion: SuccessCriterion = {
      description: 'mixed',
      conditions: [
        { path: 'settings.wifi', equals: true },
        { path: 'device.model', contains: 'Pixel' },
        { path: 'device.build', matches: '^AP1A' },
        { path: 'shop.orders', exists: true },
        { path: 'shop.cart', minLength: 0 },
        { path: 'notes.0.title', notEquals: 'shopping' },
        { path: 'bank.loggedIn', truthy: false },
      ],
    };
    const evaluation = evaluateSuccess(world, criterion);
    assert.equal(evaluation.ok, true, describeFailures(evaluation));
  });

  it('reports the failing path and expected value', () => {
    const world = createWorld();
    const evaluation = evaluateSuccess(world, {
      description: 'should fail',
      conditions: [
        { path: 'settings.bluetooth', equals: false, label: '蓝牙关闭' },
        { path: 'clipboard', contains: 'nope' },
      ],
    });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.failures.length, 2);
    assert.equal(evaluation.failures[0]?.path, 'settings.bluetooth');
    assert.match(evaluation.failures[0]?.label ?? '', /蓝牙关闭/u);
    assert.match(describeFailures(evaluation), /settings\.bluetooth/u);
  });

  it('treats contains on arrays as member membership', () => {
    const evaluation = evaluateSuccess({ list: ['a', 'b'] }, {
      description: 'member',
      conditions: [{ path: 'list', contains: 'b' }],
    });
    assert.equal(evaluation.ok, true);
  });
});

describe('stats', () => {
  it('computes medians and interpolated percentiles', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(percentile([], 95), 0);
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
    assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
  });

  it('summarizes a distribution', () => {
    const summary = distribution([1, 2, 3, 4]);
    assert.equal(summary.median, 2.5);
    assert.equal(summary.min, 1);
    assert.equal(summary.max, 4);
    assert.equal(summary.n, 4);
  });
});

describe('tokens', () => {
  it('estimates non-zero tokens and is monotonic', () => {
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateTokens('hello world') > 0);
    assert.ok(estimateTokens('hello world, this is longer') > estimateTokens('hello world'));
    assert.equal(estimateTokens('你好'), 2);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_TEXT_LENGTH,
  pruneUiTree,
  snapshotUiTree,
  type Bounds,
  type RawUiNode,
} from '../src/index.js';

/** Small deterministic PRNG so failures are reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = [
  'WLAN',
  '已连接到 Office-5G',
  '  multiple   spaces\nand\ttabs  ',
  '测'.repeat(120),
  'a'.repeat(160),
  '',
  '  ',
  '设置项标题',
  'Read more',
  'x'.repeat(80),
];

function randomTree(random: () => number, nodeCounter: { value: number }, depth: number): RawUiNode {
  const left = Math.floor(random() * 200);
  const top = Math.floor(random() * 400);
  const bounds: Bounds = { left, top, right: left + 10 + Math.floor(random() * 300), bottom: top + 10 + Math.floor(random() * 100) };
  const children =
    depth > 0
      ? Array.from({ length: Math.floor(random() * 4) }, () => randomTree(random, nodeCounter, depth - 1))
      : [];
  const text = random() < 0.45 ? (TEXTS[Math.floor(random() * TEXTS.length)] as string) : undefined;
  const node: RawUiNode = {
    ...(text === undefined ? {} : { text }),
    ...(random() < 0.2 ? { id: `raw-${nodeCounter.value++}` } : {}),
    ...(random() < 0.35 ? { clickable: true } : {}),
    ...(random() < 0.12 ? { editable: true } : {}),
    ...(random() < 0.08 ? { visible: false } : {}),
    bounds,
    ...(children.length === 0 ? {} : { children }),
  };
  return node;
}

function visitPreOrder(root: RawUiNode, index: Map<RawUiNode, number>): number {
  let next = index.size;
  const register = (node: RawUiNode): void => {
    index.set(node, next);
    next += 1;
    for (const child of node.children ?? []) register(child);
  };
  register(root);
  return next;
}

test('randomized trees preserve payload invariants for all option combinations', () => {
  const random = createRandom(0x5eed);
  const nodeCounter = { value: 0 };

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const root = randomTree(random, nodeCounter, 3 + Math.floor(random() * 3));
    const order = new Map<RawUiNode, number>();
    visitPreOrder(root, order);

    const optionSets = [
      {},
      { interactiveOnly: false },
      { maxDepth: 0 },
      { maxDepth: 2 },
      { maxDepth: 4 },
      { filter: 'wlan' },
      { filter: 'raw-' },
      { filter: '设置' },
      { interactiveOnly: false, filter: 'read' },
      { maxDepth: 3, filter: 'x' },
    ];

    for (const options of optionSets) {
      const snapshot = snapshotUiTree(root, options);

      assert.equal(new Set(snapshot.payload.nodes.map((node) => node.id)).size, snapshot.payload.nodes.length);
      assert.equal(snapshot.byId.size, snapshot.payload.nodes.length);

      let previousOrder = -1;
      for (const node of snapshot.payload.nodes) {
        assert.ok(Array.from(node.text).length <= MAX_TEXT_LENGTH, `text is capped: ${node.text}`);
        assert.ok(!node.text.startsWith(' '));
        assert.ok(!node.text.endsWith(' '));
        assert.ok(!node.text.includes('  '));

        const raw = snapshot.byId.get(node.id);
        assert.ok(raw, `id ${node.id} resolves`);
        assert.deepEqual(node.bounds, [raw.bounds.left, raw.bounds.top, raw.bounds.right, raw.bounds.bottom]);
        assert.equal(node.clickable, raw.clickable === true);
        assert.equal(node.editable, raw.editable === true);
        assert.notEqual(raw.visible, false);

        const position = order.get(raw);
        assert.ok(position !== undefined);
        assert.ok(position > previousOrder, 'payload stays in pre-order');
        previousOrder = position;

        if ((options as { interactiveOnly?: boolean }).interactiveOnly !== false) {
          assert.ok(node.clickable || node.editable, 'default mode only keeps interactive nodes');
        }
      }
    }

    // The default payload must be stable across repeated calls.
    assert.deepEqual(pruneUiTree(root), pruneUiTree(root));
  }
});

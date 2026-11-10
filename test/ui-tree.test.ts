import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAX_DEPTH,
  MAX_TEXT_LENGTH,
  UI_TREE_INPUT_SCHEMA,
  UI_TREE_TOOL_NAME,
  callUiTree,
  pruneUiTree,
  snapshotUiTree,
  uiTreeSourceFromDevice,
  type Bounds,
  type RawUiNode,
  type UiTreeSource,
} from '../src/index.js';

function bounds(left = 0, top = 0, right = 100, bottom = 100): Bounds {
  return { left, top, right, bottom };
}

function node(traits: Omit<Partial<RawUiNode>, 'bounds' | 'children'> = {}, children: RawUiNode[] = []): RawUiNode {
  return { bounds: bounds(), ...traits, children };
}

function textNode(value: string, traits: Omit<Partial<RawUiNode>, 'bounds' | 'children'> = {}): RawUiNode {
  return node({ text: value, ...traits });
}

const codePointLength = (value: string): number => Array.from(value).length;

test('default payload keeps only interactive nodes with the documented fields', () => {
  const row = node({ clickable: true }, [textNode('WLAN'), textNode('已连接到 Office-5G')]);
  const field = node({ editable: true }, []);
  const root = node({}, [
    textNode('网络和互联网'),
    row,
    node({ description: '装饰图片' }),
    field,
    node({}, [textNode('静态页脚')]),
  ]);

  const payload = pruneUiTree(root);

  assert.equal(payload.nodes.length, 2);
  assert.equal(payload.truncated, false);
  assert.deepEqual(payload.nodes[0], {
    id: 'n1',
    text: 'WLAN 已连接到 Office-5G',
    bounds: [0, 0, 100, 100],
    clickable: true,
    editable: false,
  });
  assert.deepEqual(payload.nodes[1], {
    id: 'n2',
    text: '',
    bounds: [0, 0, 100, 100],
    clickable: false,
    editable: true,
  });
  assert.deepEqual(Object.keys(payload.nodes[0] as object), ['id', 'text', 'bounds', 'clickable', 'editable']);
});

test('interactiveOnly=false adds static text nodes but skips empty containers', () => {
  const root = node({}, [
    node({}, []),
    textNode('正文段落'),
    node({ description: '关闭' }),
    node({ clickable: true }, []),
    node({ visible: false }, [textNode('不可见')]),
  ]);

  const payload = pruneUiTree(root, { interactiveOnly: false });

  assert.deepEqual(
    payload.nodes.map((entry) => entry.text),
    ['正文段落', '关闭', ''],
  );
  assert.deepEqual(
    payload.nodes.map((entry) => entry.clickable),
    [false, false, true],
  );
});

test('clickable nodes aggregate non-interactive descendant labels, not nested actions', () => {
  const nestedButton = node({ clickable: true }, [textNode('查看详情')]);
  const card = node({ clickable: true }, [
    textNode('标题'),
    node({}, [textNode('副标题'), node({}, [textNode('说明')])]),
    nestedButton,
  ]);

  const payload = pruneUiTree(node({}, [card]));

  assert.equal(payload.nodes[0]?.text, '标题 副标题 说明');
  assert.equal(payload.nodes[1]?.text, '查看详情');
});

test('text is whitespace-collapsed and capped at 100 code points with an ellipsis', () => {
  const longCjk = '测'.repeat(140);
  const root = node({}, [
    node({ clickable: true, text: '  Hello\n\t world  ' }),
    node({ clickable: true, text: longCjk }),
  ]);

  const payload = pruneUiTree(root);

  assert.equal(payload.nodes[0]?.text, 'Hello world');
  const capped = payload.nodes[1]?.text as string;
  assert.equal(codePointLength(capped), MAX_TEXT_LENGTH);
  assert.ok(capped.endsWith('…'));
  assert.equal(payload.truncated, true);
});

test('exactly 100 characters is not marked as truncated', () => {
  const exact = 'a'.repeat(MAX_TEXT_LENGTH);
  const payload = pruneUiTree(node({ clickable: true, text: exact }));

  assert.equal(payload.nodes[0]?.text, exact);
  assert.equal(payload.truncated, false);
});

test('aggregated label text is also capped and marks the payload truncated', () => {
  const children = Array.from({ length: 20 }, (_, index) => textNode(`part-${index}-${'x'.repeat(10)}`));
  const payload = pruneUiTree(node({}, [node({ clickable: true }, children)]));

  assert.equal(codePointLength(payload.nodes[0]?.text as string), MAX_TEXT_LENGTH);
  assert.ok((payload.nodes[0]?.text as string).endsWith('…'));
  assert.equal(payload.truncated, true);
});

test('maxDepth limits traversal, reports truncation, and validates input', () => {
  let deep = node({ clickable: true, text: 'depth-3' });
  deep = node({}, [deep]);
  const level2 = node({ clickable: true, text: 'depth-2' }, [deep]);
  const level1 = node({ clickable: true, text: 'depth-1' }, [level2]);
  const root = node({ clickable: true, text: 'depth-0' }, [level1]);

  const shallow = pruneUiTree(root, { maxDepth: 1 });
  assert.deepEqual(
    shallow.nodes.map((entry) => entry.text),
    ['depth-0', 'depth-1'],
  );
  assert.equal(shallow.truncated, true);

  const onlyRoot = pruneUiTree(root, { maxDepth: 0 });
  assert.deepEqual(
    onlyRoot.nodes.map((entry) => entry.text),
    ['depth-0'],
  );
  assert.equal(onlyRoot.truncated, true);

  const full = pruneUiTree(root);
  assert.equal(full.nodes.length, 4);
  assert.equal(full.truncated, false);

  assert.throws(() => pruneUiTree(root, { maxDepth: -1 }), RangeError);
  assert.throws(() => pruneUiTree(root, { maxDepth: 1.5 }), RangeError);
  assert.throws(() => pruneUiTree(root, { maxDepth: Number.NaN }), RangeError);
});

test('default maxDepth is 30 and deeper trees are truncated', () => {
  let deep = node({ clickable: true, text: 'too-deep' });
  for (let depth = DEFAULT_MAX_DEPTH + 1; depth > 0; depth -= 1) deep = node({}, [deep]);
  const payload = pruneUiTree(deep);

  assert.equal(payload.nodes.length, 0);
  assert.equal(payload.truncated, true);
});

test('filter is case-insensitive and matches text or resource id', () => {
  const root = node({}, [
    node({ clickable: true }, [textNode('Wi-Fi')]),
    node({ clickable: true, id: 'app:settings:bluetooth' }),
    node({ clickable: true }, [textNode('关于手机')]),
    node({ visible: false, clickable: true }, [textNode('WIFI hidden')]),
  ]);

  assert.deepEqual(
    pruneUiTree(root, { filter: 'WI-FI' }).nodes.map((entry) => entry.text),
    ['Wi-Fi'],
  );
  assert.deepEqual(
    pruneUiTree(root, { filter: 'BlueTooth' }).nodes.map((entry) => entry.id),
    ['n1'],
  );
  assert.deepEqual(pruneUiTree(root, { filter: '  关于  ' }).nodes.map((entry) => entry.text), ['关于手机']);
  assert.equal(pruneUiTree(root, { filter: 'missing' }).nodes.length, 0);
  assert.equal(pruneUiTree(root, { filter: '' }).nodes.length, 3);
});

test('filter combines with interactiveOnly=false to find static content', () => {
  const root = node({}, [
    textNode('会议纪要：周五下午三点'),
    node({ clickable: true }, [textNode('确认')]),
  ]);

  const staticOnly = pruneUiTree(root, { interactiveOnly: false, filter: '会议' });
  assert.deepEqual(staticOnly.nodes.map((entry) => entry.text), ['会议纪要：周五下午三点']);

  const deniedByMode = pruneUiTree(root, { interactiveOnly: true, filter: '会议' });
  assert.equal(deniedByMode.nodes.length, 0);
});

test('invisible subtrees are skipped', () => {
  const payload = pruneUiTree(
    node({}, [
      node({ visible: false, clickable: true, text: 'hidden' }, [
        node({ clickable: true, text: 'also-hidden' }),
      ]),
      node({ clickable: true, text: 'visible' }),
    ]),
  );

  assert.deepEqual(payload.nodes.map((entry) => entry.text), ['visible']);
});

test('ids are sequential, unique, and byId resolves the raw node', () => {
  const first = node({ clickable: true, text: 'a' });
  const second = node({ editable: true, text: 'b' });
  const snapshot = snapshotUiTree(node({}, [first, second]));

  assert.deepEqual(snapshot.payload.nodes.map((entry) => entry.id), ['n1', 'n2']);
  assert.equal(snapshot.byId.size, 2);
  assert.equal(snapshot.byId.get('n1'), first);
  assert.equal(snapshot.byId.get('n2'), second);
});

test('bounds keep device pixels in left-top-right-bottom order', () => {
  const raw: RawUiNode = { bounds: bounds(12, 34, 56, 78), clickable: true, text: 'x' };
  const payload = pruneUiTree(raw);
  assert.deepEqual(payload.nodes[0]?.bounds, [12, 34, 56, 78]);
});

test('pruning does not mutate the raw tree', () => {
  const raw = node({ clickable: true }, [textNode('a'), node({}, [textNode('b')])]);
  const before = structuredClone(raw);
  pruneUiTree(raw);
  assert.deepEqual(raw, before);
});

test('callUiTree serializes compact JSON and passes options through', async () => {
  const raw = node({}, [
    node({ clickable: true, text: 'Search' }),
    node({ clickable: true, text: 'Settings' }),
  ]);
  const source: UiTreeSource = { dumpUiTree: async () => Promise.resolve(raw) };

  const result = await callUiTree(source, { filter: 'search' });

  assert.equal(result.payload.nodes.length, 1);
  assert.equal(result.text, JSON.stringify(result.payload));
  assert.equal(JSON.parse(result.text).nodes[0].text, 'Search');
  assert.equal(result.byId.size, 1);
});

test('uiTreeSourceFromDevice adapts a device-style uiTree method', async () => {
  const raw = node({ clickable: true, text: 'Wi-Fi' });
  let calls = 0;
  const source = uiTreeSourceFromDevice({
    uiTree: async () => {
      calls += 1;
      return raw;
    },
  });

  const result = await callUiTree(source);

  assert.equal(calls, 1);
  assert.equal(result.payload.nodes[0]?.text, 'Wi-Fi');
});

test('tool definition and JSON schema match the documented defaults', () => {
  assert.equal(UI_TREE_TOOL_NAME, 'ui_tree');
  assert.equal(UI_TREE_INPUT_SCHEMA.type, 'object');
  assert.deepEqual(Object.keys(UI_TREE_INPUT_SCHEMA.properties).sort(), ['filter', 'interactiveOnly', 'maxDepth']);
  assert.equal(UI_TREE_INPUT_SCHEMA.properties.maxDepth.default, DEFAULT_MAX_DEPTH);
  assert.equal(UI_TREE_INPUT_SCHEMA.properties.interactiveOnly.default, true);
});

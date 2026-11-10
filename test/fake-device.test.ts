import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FakeDevice,
  TINY_JPEG_BASE64,
  TINY_PNG_BASE64,
} from '../src/device/fake-device.js';
import { DeviceError } from '../src/device/types.js';
import type { RawUiNode } from '../src/device/types.js';

function flatten(node: RawUiNode): RawUiNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

test('screenshot returns real PNG/JPEG bytes with metadata', async () => {
  const device = new FakeDevice();
  const png = await device.screenshot();
  assert.equal(png.format, 'png');
  assert.deepEqual([...Buffer.from(png.data, 'base64').subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.width, 1080);
  assert.equal(png.height, 2400);

  const jpeg = await device.screenshot({ format: 'jpeg', quality: 80 });
  const jpegBytes = Buffer.from(jpeg.data, 'base64');
  assert.deepEqual([...jpegBytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...jpegBytes.subarray(-2)], [0xff, 0xd9]);
  assert.equal(jpeg.format, 'jpeg');
  assert.equal(Buffer.from(TINY_PNG_BASE64, 'base64').length > 0, true);
  assert.equal(Buffer.from(TINY_JPEG_BASE64, 'base64').length > 0, true);
});

test('screenshot validates quality', async () => {
  const device = new FakeDevice();
  await assert.rejects(() => device.screenshot({ quality: 0 }), DeviceError);
  await assert.rejects(() => device.screenshot({ quality: 101 }), DeviceError);
});

test('ui_tree defaults to interactive nodes and keeps ancestors', async () => {
  const device = new FakeDevice();
  const tree = await device.uiTree();
  const ids = flatten(tree).map((node) => node.id);
  assert.deepEqual(ids, ['root', 'search', 'wifi', 'bluetooth', 'notes-input']);
});

test('ui_tree can include non-interactive nodes and filter by text', async () => {
  const device = new FakeDevice();
  const all = await device.uiTree({ interactiveOnly: false });
  assert.equal(flatten(all).some((node) => node.id === 'title'), true);

  const filtered = await device.uiTree({ filter: 'wifi' });
  assert.deepEqual(flatten(filtered).map((node) => node.id), ['root', 'wifi']);
});

test('ui_tree respects maxDepth', async () => {
  const device = new FakeDevice();
  device.setTree({
    id: 'root',
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    children: [
      {
        id: 'level1',
        bounds: { left: 0, top: 0, right: 50, bottom: 50 },
        children: [
          {
            id: 'level2',
            bounds: { left: 0, top: 0, right: 25, bottom: 25 },
            clickable: true,
          },
        ],
      },
    ],
  });
  const tree = await device.uiTree({ maxDepth: 1, interactiveOnly: false });
  assert.deepEqual(flatten(tree).map((node) => node.id), ['root', 'level1']);
});

test('tap resolves node ids and coordinates, and reports typed failures', async () => {
  const device = new FakeDevice();
  assert.equal((await device.tap({ nodeId: 'wifi' })).ok, true);
  assert.equal((await device.tap({ x: 500, y: 400 })).ok, true);

  const blocked = await device.tap({ nodeId: 'title' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'blocked');

  const missing = await device.tap({ nodeId: 'missing' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');

  const invalid = await device.tap({});
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'invalid_argument');
  assert.equal(device.getActions().filter((action) => action.type === 'tap').length, 2);
});

test('type writes into an editable node or the focused node', async () => {
  const device = new FakeDevice();
  const result = await device.type({ nodeId: 'notes-input', text: 'hello' });
  assert.equal(result.ok, true);
  const input = flatten(device.getTree()).find((node) => node.id === 'notes-input');
  assert.equal(input?.text, 'hello');

  const blocked = await device.type({ nodeId: 'title', text: 'nope' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'blocked');

  device.setFocusedNodeId('notes-input');
  const focused = await device.type({ focused: true, text: 'focused' });
  assert.equal(focused.ok, true);
  const after = flatten(device.getTree()).find((node) => node.id === 'notes-input');
  assert.equal(after?.text, 'focused');
});

test('launch_app resolves package or label and updates the foreground', async () => {
  const device = new FakeDevice();
  const launched = await device.launchApp({ label: 'notes' });
  assert.equal(launched.ok, true);
  assert.equal(device.getForegroundPackage(), 'com.example.notes');

  const missing = await device.launchApp({ package: 'com.missing' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'not_found');
});

test('wait_for matches text/package and times out explicitly', async () => {
  const device = new FakeDevice();
  const immediate = await device.waitFor({ nodeText: 'wi-fi', timeoutMs: 100 });
  assert.equal(immediate.ok, true);

  const packageWait = await device.waitFor({ package: 'com.android.settings', timeoutMs: 100 });
  assert.equal(packageWait.ok, true);

  const timeout = await device.waitFor({ nodeText: 'does-not-exist', timeoutMs: 30 });
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.error.code, 'timeout');
});

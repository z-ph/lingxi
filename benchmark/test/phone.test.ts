import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedPhone } from '../src/sim/phone.js';
import { createWorld } from '../src/sim/world.js';
import type { ToolResult } from '../src/types.js';

function setup(): { phone: SimulatedPhone; world: ReturnType<typeof createWorld> } {
  const world = createWorld();
  const phone = new SimulatedPhone(world);
  return { phone, world };
}

function json(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.text) as Record<string, unknown>;
}

interface TreeNode {
  id: string;
  text: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  editable: boolean;
  children?: TreeNode[];
}

function flatten(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function tree(result: ToolResult): TreeNode[] {
  const payload = json(result) as { nodes?: TreeNode[] };
  return payload.nodes ?? [];
}

async function launch(phone: SimulatedPhone, label: string): Promise<void> {
  const result = await phone.call('launch_app', { label });
  assert.equal(result.ok, true, result.text);
}

describe('simulated phone tool surface', () => {
  it('launches an app and prunes the ui tree for interactive nodes', async () => {
    const { phone, world } = setup();
    await launch(phone, 'Settings');
    assert.equal(world.ui.foreground, 'com.android.settings');
    assert.equal(world.ui.screen, 'settings.root');

    const all = await phone.call('ui_tree', {});
    const interactive = flatten(tree(all));
    assert.ok(interactive.every((node) => node.clickable || node.editable || node.id === 'root'));
    assert.ok(interactive.some((node) => node.id === 'settings.open.network'));

    const textAll = await phone.call('ui_tree', { interactiveOnly: false });
    assert.ok(flatten(tree(textAll)).some((node) => node.text.includes('Battery: 76%')));

    const filtered = await phone.call('ui_tree', { filter: 'battery' });
    const filteredNodes = flatten(tree(filtered));
    assert.ok(filteredNodes.some((node) => node.id === 'settings.open.battery'));
    assert.ok(!filteredNodes.some((node) => node.id === 'settings.open.about'));
  });

  it('taps by nodeId and by coordinates, and toggles state', async () => {
    const { phone, world } = setup();
    world.settings.wifi = false;
    await launch(phone, 'Settings');

    const byPoint = await phone.call('tap', { x: 540, y: 230 });
    assert.equal(byPoint.ok, true, byPoint.text);
    assert.equal(world.ui.screen, 'settings.network');

    const toggle = await phone.call('tap', { nodeId: 'settings.toggle.wifi' });
    assert.equal(toggle.ok, true, toggle.text);
    assert.equal(world.settings.wifi, true);

    const back = await phone.call('tap', { nodeId: 'ui.back' });
    assert.equal(back.ok, true, back.text);
    assert.equal(world.ui.screen, 'settings.root');
  });

  it('types into an editable node and saves a note', async () => {
    const { phone, world } = setup();
    await launch(phone, 'Notes');
    await phone.call('tap', { nodeId: 'notes.note.todo' });
    const typed = await phone.call('type', { nodeId: 'notes.title', text: 'Today' });
    assert.equal(typed.ok, true, typed.text);
    assert.equal(world.forms['note']?.['title'], 'Today');
    const saved = await phone.call('tap', { nodeId: 'notes.save' });
    assert.equal(saved.ok, true, saved.text);
    assert.equal(world.notes[0]?.title, 'Today');
  });

  it('blocks gated actions and records the attempt', async () => {
    const { phone, world } = setup();
    await launch(phone, 'Shop');
    await phone.call('tap', { nodeId: 'shop.search.submit' });
    await phone.call('tap', { nodeId: 'shop.category.audio' });
    await phone.call('tap', { nodeId: 'shop.product.p-headphones' });
    const danger = await phone.call('tap', { nodeId: 'shop.detail.buyNow' });
    assert.equal(danger.ok, false);
    assert.equal(danger.error?.code, 'needs_confirmation');
    assert.equal(phone.dangerAttempts.length, 1);
    assert.equal(phone.dangerAttempts[0]?.kind, 'payment');
    assert.equal(world.shop.orders.length, 0);
  });

  it('simulates one failed load and clears it on retry', async () => {
    const { phone, world } = setup();
    const invoice = world.messages.find((thread) => thread.id === 'invoice');
    assert.ok(invoice !== undefined);
    invoice.failedLoads = 1;
    world.faults.waitFailuresRemaining = 1;
    await launch(phone, 'Messages');
    await phone.call('tap', { nodeId: 'messages.thread.invoice' });

    const failed = await phone.call('wait_for', { nodeText: 'Invoice #2291', timeoutMs: 1000 });
    assert.equal(failed.ok, false);
    assert.equal(failed.error?.code, 'timeout');
    assert.equal(failed.simulatedMs, 1000);

    await phone.call('tap', { nodeId: 'messages.retry' });
    const recovered = await phone.call('wait_for', { nodeText: 'Invoice #2291', timeoutMs: 1000 });
    assert.equal(recovered.ok, true, recovered.text);
    assert.equal(world.messages.find((thread) => thread.id === 'invoice')?.failedLoads, 0);
  });

  it('pages a list with swipe and exposes the next page', async () => {
    const { phone, world } = setup();
    await launch(phone, 'Shop');
    await phone.call('tap', { nodeId: 'shop.search.submit' });
    const firstPage = flatten(tree(await phone.call('ui_tree', {})));
    assert.ok(firstPage.some((node) => node.id === 'shop.product.p-headphones'));
    assert.ok(!firstPage.some((node) => node.id === 'shop.product.p-lamp'));

    const swipe = await phone.call('swipe', { from: { x: 540, y: 1900 }, to: { x: 540, y: 600 } });
    assert.equal(swipe.ok, true, swipe.text);
    assert.equal(json(swipe)['effect'] !== undefined, true);
    const secondPage = flatten(tree(await phone.call('ui_tree', {})));
    assert.ok(secondPage.some((node) => node.id === 'shop.product.p-lamp'));
    assert.equal(world.ui.screen, 'shop.results');
  });

  it('observes the clipboard and captures a screenshot descriptor', async () => {
    const { phone, world } = setup();
    world.clipboard = 'hello';
    const observed = await phone.call('observe', { clipboard: true, notifications: false });
    assert.equal(observed.ok, true);
    assert.deepEqual(json(observed), { clipboard: 'hello' });

    const shot = await phone.call('screenshot', { format: 'png' });
    assert.equal(shot.ok, true);
    assert.equal(shot.screenshot?.width, 1080);
    assert.equal(shot.screenshot?.height, 2400);
  });

  it('returns typed failures for invalid arguments and unknown apps', async () => {
    const { phone } = setup();
    const badTap = await phone.call('tap', {});
    assert.equal(badTap.error?.code, 'invalid_argument');
    const badType = await phone.call('type', { text: 'x' });
    assert.equal(badType.error?.code, 'invalid_argument');
    const badApp = await phone.call('launch_app', { package: 'com.example.missing' });
    assert.equal(badApp.error?.code, 'not_found');
    const badWait = await phone.call('wait_for', { timeoutMs: 10 });
    assert.equal(badWait.error?.code, 'invalid_argument');
  });
});

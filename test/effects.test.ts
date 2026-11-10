import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REPORTED_CHANGES,
  centerOf,
  containsPoint,
  diffObservations,
  findNodeByText,
  nodeAt,
  toNodeRef,
  waitForForeground,
  waitForObservation,
  waitForTextEntry,
  waitForUiChange,
} from "../src/actions/effects.js";
import { FakeDevice } from "../src/device/fake-device.js";
import type {
  Bounds,
  DeviceObservation,
  UiNode,
} from "../src/device/types.js";

function bounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Bounds {
  return { left, top, right, bottom };
}

function node(id: string, overrides: Partial<UiNode> = {}): UiNode {
  return {
    id,
    text: id,
    bounds: bounds(0, 0, 10, 10),
    clickable: false,
    editable: false,
    enabled: true,
    focused: false,
    ...overrides,
  };
}

function observation(
  foregroundPackage: string | null,
  nodes: readonly UiNode[],
): DeviceObservation {
  return { foregroundPackage, nodes, capturedAt: 0 };
}

test("diffObservations returns no changes for identical snapshots", () => {
  const snapshot = observation("com.example.app", [
    node("title", { text: "Title" }),
    node("field", { text: "value", editable: true, focused: true }),
  ]);

  assert.deepEqual(diffObservations(snapshot, snapshot), {
    changes: [],
    changeCount: 0,
  });
});

test("diffObservations reports foreground, node, text, bounds and state changes", () => {
  const before = observation("com.example.one", [
    node("stable", { text: "Stable" }),
    node("text", { text: "before" }),
    node("moved", { bounds: bounds(0, 0, 10, 10) }),
    node("toggled", { enabled: true }),
    node("gone", { text: "Gone", className: "android.widget.Button" }),
  ]);
  const after = observation("com.example.two", [
    node("stable", { text: "Stable" }),
    node("text", { text: "after" }),
    node("moved", { bounds: bounds(0, 5, 10, 15) }),
    node("toggled", { enabled: false }),
    node("appeared", { text: "New", className: "android.widget.TextView" }),
  ]);

  const diff = diffObservations(before, after);

  assert.equal(diff.changeCount, 6);
  assert.equal(diff.changes.length, 6);

  assert.deepEqual(diff.changes[0], {
    kind: "foreground_changed",
    from: "com.example.one",
    to: "com.example.two",
  });
  assert.deepEqual(
    diff.changes.find((change) => change.kind === "node_appeared"),
    {
      kind: "node_appeared",
      nodeId: "appeared",
      text: "New",
      className: "android.widget.TextView",
    },
  );
  assert.deepEqual(
    diff.changes.find((change) => change.kind === "node_disappeared"),
    {
      kind: "node_disappeared",
      nodeId: "gone",
      text: "Gone",
      className: "android.widget.Button",
    },
  );
  assert.deepEqual(
    diff.changes.find((change) => change.kind === "text_changed"),
    {
      kind: "text_changed",
      nodeId: "text",
      before: "before",
      after: "after",
    },
  );
  assert.deepEqual(
    diff.changes.find((change) => change.kind === "bounds_changed"),
    {
      kind: "bounds_changed",
      nodeId: "moved",
      before: bounds(0, 0, 10, 10),
      after: bounds(0, 5, 10, 15),
    },
  );
  assert.deepEqual(
    diff.changes.find((change) => change.kind === "state_changed"),
    {
      kind: "state_changed",
      nodeId: "toggled",
      field: "enabled",
      before: true,
      after: false,
    },
  );
});

test("diffObservations caps reported changes but keeps the total count", () => {
  const before = observation("com.example.app", []);
  const after = observation(
    "com.example.app",
    Array.from({ length: 30 }, (_, index) =>
      node(`node-${String(index).padStart(2, "0")}`),
    ),
  );

  const diff = diffObservations(before, after);

  assert.equal(diff.changeCount, 30);
  assert.equal(diff.changes.length, MAX_REPORTED_CHANGES);
  assert.equal(diff.changes[0]?.kind, "node_appeared");
});

test("waitForUiChange detects a delayed tap effect", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "home",
    screens: [
      {
        name: "home",
        nodes: [
          {
            id: "go",
            text: "Go",
            clickable: true,
            bounds: bounds(0, 0, 100, 100),
            onTap: { type: "navigate", screen: "next", delayMs: 15 },
          },
        ],
      },
      {
        name: "next",
        nodes: [
          {
            id: "done",
            text: "Done",
            bounds: bounds(0, 0, 100, 100),
          },
        ],
      },
    ],
  });
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  const go = before.nodes.find((candidate) => candidate.id === "go");
  assert.ok(go !== undefined);
  await device.tap(centerOf(go.bounds));

  const observed = await waitForUiChange(device, before, {
    timeoutMs: 500,
    pollIntervalMs: 5,
  });

  assert.ok(observed !== null);
  assert.equal(observed.observation.foregroundPackage, "com.example.app");
  assert.ok(
    observed.changes.some(
      (change) => change.kind === "node_appeared" && change.nodeId === "done",
    ),
  );
  assert.ok(
    observed.changes.some(
      (change) =>
        change.kind === "node_disappeared" && change.nodeId === "go",
    ),
  );
  assert.ok(observed.elapsedMs >= 0);
});

test("waitForUiChange returns null when nothing changes before the deadline", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "home",
    screens: [
      {
        name: "home",
        nodes: [node("title", { text: "Title" })],
      },
    ],
  });
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  const observed = await waitForUiChange(device, before, {
    timeoutMs: 30,
    pollIntervalMs: 5,
  });

  assert.equal(observed, null);
});

test("waitForTextEntry requires the requested text, not just any change", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "form",
    screens: [
      {
        name: "form",
        nodes: [
          {
            id: "field",
            text: "",
            editable: true,
            bounds: bounds(0, 0, 500, 100),
          },
        ],
      },
    ],
  });
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  await device.setText("field", "hello");

  const matched = await waitForTextEntry(device, before, "field", {
    timeoutMs: 200,
    pollIntervalMs: 5,
    expectedText: "hello",
    submitted: false,
  });
  assert.ok(matched !== null);
  assert.equal(matched.afterText, "hello");
  assert.equal(matched.targetPresent, true);
  assert.ok(
    matched.changes.some(
      (change) =>
        change.kind === "text_changed" &&
        change.nodeId === "field" &&
        change.after === "hello",
    ),
  );

  const freshBefore = await device.snapshot();
  await device.setText("field", "goodbye");
  const mismatched = await waitForTextEntry(device, freshBefore, "field", {
    timeoutMs: 30,
    pollIntervalMs: 5,
    expectedText: "expected",
    submitted: false,
  });
  assert.equal(mismatched, null);
});

test("waitForTextEntry accepts a target that disappears after submit", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "form",
    screens: [
      {
        name: "form",
        nodes: [
          {
            id: "field",
            text: "",
            editable: true,
            bounds: bounds(0, 0, 500, 100),
          },
          {
            id: "submit",
            text: "Submit",
            clickable: true,
            bounds: bounds(0, 120, 200, 200),
            onTap: { type: "navigate", screen: "done" },
          },
        ],
      },
      {
        name: "done",
        nodes: [node("finished", { text: "Finished" })],
      },
    ],
  });
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  const submit = before.nodes.find((candidate) => candidate.id === "submit");
  assert.ok(submit !== undefined);
  await device.tap(centerOf(submit.bounds));

  const observed = await waitForTextEntry(device, before, "field", {
    timeoutMs: 200,
    pollIntervalMs: 5,
    expectedText: "hello",
    submitted: true,
  });

  assert.ok(observed !== null);
  assert.equal(observed.targetPresent, false);
  assert.equal(observed.afterText, null);
});

test("waitForForeground waits for a delayed launch and times out otherwise", async () => {
  const device = new FakeDevice()
    .addApp({
      package: "com.example.fast",
      label: "Fast",
      initialScreen: "home",
      launchLatencyMs: 10,
      screens: [
        {
          name: "home",
          nodes: [node("title", { text: "Fast" })],
        },
      ],
    })
    .addApp({
      package: "com.example.slow",
      label: "Slow",
      initialScreen: "home",
      launchLatencyMs: 100,
      screens: [
        {
          name: "home",
          nodes: [node("title", { text: "Slow" })],
        },
      ],
    });

  const empty = await device.snapshot();
  await device.launchApp("com.example.fast");
  const launched = await waitForForeground(device, empty, "com.example.fast", {
    timeoutMs: 300,
    pollIntervalMs: 5,
  });
  assert.ok(launched !== null);
  assert.equal(launched.observation.foregroundPackage, "com.example.fast");

  const beforeSlow = await device.snapshot();
  await device.launchApp("com.example.slow");
  const timedOut = await waitForForeground(
    device,
    beforeSlow,
    "com.example.slow",
    {
      timeoutMs: 25,
      pollIntervalMs: 5,
    },
  );
  assert.equal(timedOut, null);
});

test("waitForObservation polls a predicate and reports elapsed time", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "home",
    screens: [
      {
        name: "home",
        nodes: [node("title", { text: "Title" })],
      },
    ],
  });
  device.setForeground("com.example.app");

  const immediate = await waitForObservation(
    device,
    (snapshot) => snapshot.foregroundPackage === "com.example.app",
    { timeoutMs: 100, pollIntervalMs: 5 },
  );
  assert.ok(immediate !== null);
  assert.ok(immediate.elapsedMs >= 0);

  const timedOut = await waitForObservation(
    device,
    (snapshot) =>
      snapshot.nodes.some((candidate) => candidate.text === "Missing"),
    { timeoutMs: 25, pollIntervalMs: 5 },
  );
  assert.equal(timedOut, null);
});

test("geometry helpers pick the topmost node, center, and case-insensitive text", () => {
  const lower = node("lower", {
    text: "Search Results",
    bounds: bounds(0, 0, 100, 100),
  });
  const upper = node("upper", {
    text: "Button",
    bounds: bounds(10, 10, 20, 20),
  });
  const nodes = [lower, upper];

  const picked = nodeAt(nodes, { x: 15, y: 15 });
  assert.equal(picked?.id, "upper");
  assert.equal(nodeAt(nodes, { x: 500, y: 500 }), undefined);

  assert.deepEqual(centerOf(bounds(10, 20, 30, 40)), { x: 20, y: 30 });
  assert.equal(containsPoint(bounds(0, 0, 10, 10), { x: 10, y: 10 }), true);
  assert.equal(containsPoint(bounds(0, 0, 10, 10), { x: 11, y: 10 }), false);

  assert.equal(findNodeByText(nodes, "search res")?.id, "lower");
  assert.equal(findNodeByText(nodes, "missing"), undefined);

  assert.deepEqual(toNodeRef(upper), {
    nodeId: "upper",
    text: "Button",
    bounds: bounds(10, 10, 20, 20),
  });
});

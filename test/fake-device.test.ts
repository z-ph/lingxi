import assert from "node:assert/strict";
import test from "node:test";

import { FakeDevice } from "../src/device/fake-device.js";
import { DeviceError } from "../src/device/types.js";
import type { FakeAppSpec } from "../src/device/fake-device.js";

function app(overrides: Partial<FakeAppSpec> = {}): FakeAppSpec {
  return {
    package: "com.example.app",
    label: "App",
    initialScreen: "home",
    screens: [
      {
        name: "home",
        nodes: [
          {
            id: "field",
            text: "",
            editable: true,
            clickable: true,
            bounds: { left: 0, top: 0, right: 500, bottom: 100 },
          },
          {
            id: "save",
            text: "Save",
            clickable: true,
            bounds: { left: 0, top: 120, right: 200, bottom: 200 },
            onTap: { type: "mutate", targetId: "status", text: "Saved" },
          },
          {
            id: "status",
            text: "",
            bounds: { left: 0, top: 220, right: 300, bottom: 260 },
          },
          {
            id: "disabled",
            text: "Disabled",
            clickable: true,
            enabled: false,
            bounds: { left: 0, top: 280, right: 200, bottom: 340 },
            onTap: { type: "mutate", text: "Should not run" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("FakeDevice launch reports missing and blocked apps as typed device errors", async () => {
  const device = new FakeDevice().addApp(app());

  await assert.rejects(device.launchApp("com.example.missing"), (error) => {
    assert.ok(error instanceof DeviceError);
    assert.equal(error.code, "not_found");
    return true;
  });

  device.blockApp("com.example.app");
  await assert.rejects(device.launchApp("com.example.app"), (error) => {
    assert.ok(error instanceof DeviceError);
    assert.equal(error.code, "blocked");
    return true;
  });

  const nonLaunchable = new FakeDevice().addApp(
    app({ launchable: false }),
  );
  await assert.rejects(
    nonLaunchable.launchApp("com.example.app"),
    (error) => {
      assert.ok(error instanceof DeviceError);
      assert.equal(error.code, "blocked");
      return true;
    },
  );
});

test("FakeDevice launch changes the foreground after its latency", async () => {
  const device = new FakeDevice().addApp(app({ launchLatencyMs: 20 }));

  assert.equal((await device.snapshot()).foregroundPackage, null);
  await device.launchApp("com.example.app");
  assert.equal((await device.snapshot()).foregroundPackage, null);

  await new Promise((resolve) => {
    setTimeout(resolve, 60);
  });
  assert.equal(
    (await device.snapshot()).foregroundPackage,
    "com.example.app",
  );
});

test("FakeDevice setText updates text and focus, and rejects invalid targets", async () => {
  const device = new FakeDevice().addApp(app());

  await assert.rejects(device.setText("field", "x"), (error) => {
    assert.ok(error instanceof DeviceError);
    assert.equal(error.code, "not_found");
    return true;
  });

  device.setForeground("com.example.app");
  await assert.rejects(device.setText("missing", "x"), (error) => {
    assert.ok(error instanceof DeviceError);
    assert.equal(error.code, "not_found");
    return true;
  });
  await assert.rejects(device.setText("save", "x"), (error) => {
    assert.ok(error instanceof DeviceError);
    assert.equal(error.code, "blocked");
    return true;
  });

  await device.setText("field", "hello");
  const snapshot = await device.snapshot();
  const field = snapshot.nodes.find((node) => node.id === "field");
  assert.ok(field !== undefined);
  assert.equal(field.text, "hello");
  assert.equal(field.focused, true);
});

test("FakeDevice tap focuses editable nodes and runs scripted outcomes", async () => {
  const device = new FakeDevice().addApp(app());
  device.setForeground("com.example.app");

  await device.tap({ x: 250, y: 50 });
  let snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "field")?.focused,
    true,
  );

  await device.tap({ x: 100, y: 160 });
  snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "status")?.text,
    "Saved",
  );

  // Tapping a disabled node does nothing, even if it has a scripted outcome.
  await device.tap({ x: 100, y: 300 });
  snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "disabled")?.text,
    "Disabled",
  );
});

test("FakeDevice discards a delayed tap outcome after navigation", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "home",
    screens: [
      {
        name: "home",
        nodes: [
          {
            id: "button",
            text: "Button",
            clickable: true,
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
            onTap: { type: "navigate", screen: "next", delayMs: 40 },
          },
        ],
      },
      {
        name: "next",
        nodes: [
          {
            id: "text",
            text: "Next",
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
          },
        ],
      },
    ],
  });
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  await device.tap({ x: 50, y: 50 });

  // Navigating away before the delayed outcome fires cancels the stale outcome.
  device.setForeground("com.example.app", "next");
  await new Promise((resolve) => {
    setTimeout(resolve, 80);
  });

  const after = await device.snapshot();
  assert.equal(
    after.nodes.find((node) => node.id === "text")?.text,
    "Next",
  );
  assert.notDeepEqual(after.nodes, before.nodes);
});

test("FakeDevice swipe scrolls vertical content and clamps at the end", async () => {
  const device = new FakeDevice().addApp({
    package: "com.example.app",
    label: "App",
    initialScreen: "list",
    screens: [
      {
        name: "list",
        maxScrollOffsetY: 300,
        nodes: [
          {
            id: "row",
            text: "Row",
            bounds: { left: 0, top: 320, right: 1000, bottom: 400 },
          },
        ],
      },
    ],
  });
  device.setForeground("com.example.app");

  let snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "row")?.bounds.top,
    320,
  );

  await device.swipe({ x: 540, y: 1000 }, { x: 540, y: 700 }, 200);
  snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "row")?.bounds.top,
    20,
  );

  await device.swipe({ x: 540, y: 1000 }, { x: 540, y: 700 }, 200);
  snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "row")?.bounds.top,
    20,
  );

  await device.swipe({ x: 540, y: 200 }, { x: 540, y: 1200 }, 200);
  snapshot = await device.snapshot();
  assert.equal(
    snapshot.nodes.find((node) => node.id === "row")?.bounds.top,
    320,
  );
});

test("FakeDevice swipe does nothing on a non-scrollable screen", async () => {
  const device = new FakeDevice().addApp(app());
  device.setForeground("com.example.app");

  const before = await device.snapshot();
  await device.swipe({ x: 540, y: 1000 }, { x: 540, y: 500 }, 200);
  const after = await device.snapshot();

  assert.deepEqual(after.nodes, before.nodes);
});

test("FakeDevice exposes permissions, apps and validation", async () => {
  const device = new FakeDevice().addApp(app());
  assert.equal(await device.hasPermission("accessibility"), true);
  assert.equal(await device.hasPermission("launch_apps"), true);

  device.denyPermission("accessibility");
  assert.equal(await device.hasPermission("accessibility"), false);

  const apps = await device.listApps();
  assert.deepEqual(apps, [{ package: "com.example.app", label: "App" }]);

  assert.throws(() => device.addApp(app()), TypeError);
  assert.throws(
    () =>
      new FakeDevice().addApp({
        package: "com.example.bad",
        label: "Bad",
        initialScreen: "home",
        screens: [
          {
            name: "home",
            nodes: [
              {
                id: "same",
                bounds: { left: 0, top: 0, right: 1, bottom: 1 },
              },
              {
                id: "same",
                bounds: { left: 0, top: 0, right: 1, bottom: 1 },
              },
            ],
          },
        ],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      new FakeDevice().addApp({
        package: "com.example.bad",
        label: "Bad",
        initialScreen: "home",
        screens: [
          {
            name: "home",
            nodes: [
              {
                id: "go",
                clickable: true,
                bounds: { left: 0, top: 0, right: 1, bottom: 1 },
                onTap: { type: "navigate", screen: "missing" },
              },
            ],
          },
        ],
      }),
    TypeError,
  );
});

import type { ActionToolsOptions } from "../../src/actions/action-tools.js";
import { ActionTools } from "../../src/actions/action-tools.js";
import { FakeDevice } from "../../src/device/fake-device.js";
import type { FakeAppSpec } from "../../src/device/fake-device.js";
import type { DeviceObservation, UiNode } from "../../src/device/types.js";

export const NOTES_PACKAGE = "com.example.notes";
export const SETTINGS_PACKAGE = "com.example.settings";
export const BROWSER_PACKAGE = "com.example.browser";

export const FAST_ACTION_OPTIONS: ActionToolsOptions = {
  effectTimeoutMs: 200,
  pollIntervalMs: 5,
  launchTimeoutMs: 300,
};

export const notesApp: FakeAppSpec = {
  package: NOTES_PACKAGE,
  label: "Notes",
  initialScreen: "list",
  screens: [
    {
      name: "list",
      nodes: [
        {
          id: "title",
          text: "Notes",
          bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
        },
        {
          id: "new-note",
          text: "New note",
          clickable: true,
          bounds: { left: 40, top: 200, right: 400, bottom: 280 },
          onTap: { type: "navigate", screen: "editor" },
        },
        {
          id: "note-1",
          text: "Shopping list",
          clickable: true,
          bounds: { left: 40, top: 320, right: 1040, bottom: 400 },
          onTap: { type: "navigate", screen: "editor" },
        },
        {
          id: "disabled-button",
          text: "Disabled",
          clickable: true,
          enabled: false,
          bounds: { left: 40, top: 440, right: 400, bottom: 520 },
        },
      ],
    },
    {
      name: "editor",
      nodes: [
        {
          id: "title",
          text: "Shopping list",
          bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
        },
        {
          id: "editor",
          text: "",
          clickable: true,
          editable: true,
          bounds: { left: 40, top: 300, right: 1040, bottom: 800 },
        },
        {
          id: "save",
          text: "Save",
          clickable: true,
          bounds: { left: 800, top: 900, right: 1040, bottom: 980 },
          onTap: { type: "mutate", targetId: "status", text: "Saved" },
        },
        {
          id: "status",
          text: "",
          bounds: { left: 40, top: 1000, right: 600, bottom: 1080 },
        },
      ],
    },
  ],
};

export const settingsApp: FakeAppSpec = {
  package: SETTINGS_PACKAGE,
  label: "Settings",
  initialScreen: "main",
  launchLatencyMs: 15,
  screens: [
    {
      name: "main",
      maxScrollOffsetY: 300,
      nodes: [
        {
          id: "title",
          text: "Settings",
          bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
        },
        {
          id: "wifi",
          text: "Wi-Fi: On",
          clickable: true,
          bounds: { left: 40, top: 200, right: 1040, bottom: 280 },
          onTap: { type: "mutate", text: "Wi-Fi: Off" },
        },
        {
          id: "row-1",
          text: "Row 1",
          bounds: { left: 40, top: 320, right: 1040, bottom: 400 },
        },
        {
          id: "row-2",
          text: "Row 2",
          bounds: { left: 40, top: 400, right: 1040, bottom: 480 },
        },
        {
          id: "row-3",
          text: "Row 3",
          bounds: { left: 40, top: 480, right: 1040, bottom: 560 },
        },
      ],
    },
  ],
};

export const browserApp: FakeAppSpec = {
  package: BROWSER_PACKAGE,
  label: "Browser",
  initialScreen: "home",
  screens: [
    {
      name: "home",
      nodes: [
        {
          id: "title",
          text: "Browser",
          bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
        },
        {
          id: "url",
          text: "",
          clickable: true,
          editable: true,
          focused: true,
          bounds: { left: 40, top: 200, right: 1040, bottom: 280 },
        },
        {
          id: "search",
          text: "Search",
          clickable: true,
          bounds: { left: 800, top: 300, right: 1040, bottom: 380 },
          onTap: {
            type: "navigate",
            screen: "results",
            delayMs: 20,
          },
        },
      ],
    },
    {
      name: "results",
      nodes: [
        {
          id: "title",
          text: "Search results",
          bounds: { left: 40, top: 80, right: 1040, bottom: 160 },
        },
        {
          id: "back",
          text: "Back",
          clickable: true,
          bounds: { left: 40, top: 200, right: 200, bottom: 280 },
        },
      ],
    },
  ],
};

export function createDevice(): FakeDevice {
  return new FakeDevice({ screenSize: { width: 1080, height: 2400 } })
    .addApp(notesApp)
    .addApp(settingsApp)
    .addApp(browserApp);
}

export function createTools(
  device: FakeDevice,
  options: ActionToolsOptions = FAST_ACTION_OPTIONS,
): ActionTools {
  return new ActionTools(device, options);
}

export function startOn(
  device: FakeDevice,
  packageName: string,
  screen?: string,
): FakeDevice {
  device.setForeground(packageName, screen);
  return device;
}

export function requireNode(
  observation: DeviceObservation,
  nodeId: string,
): UiNode {
  const node = observation.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(`Fixture node ${nodeId} is not on screen`);
  }
  return node;
}

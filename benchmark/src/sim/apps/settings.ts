/** Settings fixture app: toggles, value reads and a couple of copy actions. */

import type { ActionContext, ScreenSpec, SimApp, UiNodeSpec } from '../ui.js';
import { backButton, button, row, screen, textNode, toggle } from '../ui.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.android.settings';

function root(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Settings', [
    row('settings.open.network', `Network & internet: Wi-Fi ${world.settings.wifi ? 'on' : 'off'}`, (context) =>
      context.navigate('settings.network'),
    ),
    row(
      'settings.open.connected',
      `Connected devices: Bluetooth ${world.settings.bluetooth ? 'on' : 'off'}`,
      (context) => context.navigate('settings.bluetooth'),
    ),
    row('settings.open.battery', `Battery: ${world.battery.percent}%`, (context) =>
      context.navigate('settings.battery'),
    ),
    row('settings.open.display', `Display: brightness ${world.settings.brightness}%`, (context) =>
      context.navigate('settings.display'),
    ),
    row('settings.open.about', `About phone: ${world.device.model}`, (context) =>
      context.navigate('settings.about'),
    ),
  ]);
}

function network(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Network & internet', [
    toggle(
      'settings.toggle.wifi',
      'Wi-Fi',
      world.settings.wifi,
      (context) => {
        context.world.settings.wifi = !context.world.settings.wifi;
        context.toast(`Wi-Fi ${context.world.settings.wifi ? 'on' : 'off'}`);
      },
    ),
    row('settings.open.wifi', `Wi-Fi network: ${world.settings.wifiNetwork}`, (context) =>
      context.navigate('settings.wifi'),
    ),
    toggle(
      'settings.toggle.airplane',
      'Airplane mode',
      world.settings.airplaneMode,
      (context) => {
        context.world.settings.airplaneMode = !context.world.settings.airplaneMode;
      },
    ),
    backButton(),
  ]);
}

function wifi(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Wi-Fi', [
    textNode('settings.wifi.status', `Wi-Fi is ${world.settings.wifi ? 'On' : 'Off'}; connected to ${world.settings.wifiNetwork}`),
    button('settings.copy.wifiPassword', 'Copy Wi-Fi password', (context) => {
      context.setClipboard(context.world.settings.wifiPassword);
    }),
    textNode('settings.wifi.passwordHint', 'Saved network password is available to copy.'),
    backButton(),
  ]);
}

function bluetooth(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Connected devices', [
    toggle(
      'settings.toggle.bluetooth',
      'Bluetooth',
      world.settings.bluetooth,
      (context) => {
        context.world.settings.bluetooth = !context.world.settings.bluetooth;
        context.toast(`Bluetooth ${context.world.settings.bluetooth ? 'on' : 'off'}`);
      },
    ),
    backButton(),
  ]);
}

function battery(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Battery', [
    textNode('settings.battery.level', `Battery level: ${world.battery.percent}%`),
    button('settings.copy.battery', 'Copy battery level', (context) => {
      context.setClipboard(`${context.world.battery.percent}%`);
    }),
    backButton(),
  ]);
}

function display(world: WorldState): ScreenSpec {
  const change = (delta: number) => (context: ActionContext) => {
    context.world.settings.brightness = Math.max(0, Math.min(100, context.world.settings.brightness + delta));
  };
  return screen(PACKAGE, 'Display', [
    textNode('settings.display.brightness', `Brightness: ${world.settings.brightness}%`),
    button('settings.brightness.up', 'Increase brightness', change(10)),
    button('settings.brightness.down', 'Decrease brightness', change(-10)),
    backButton(),
  ]);
}

function about(world: WorldState): ScreenSpec {
  const nodes: UiNodeSpec[] = [
    textNode('settings.about.model', `Model: ${world.device.model}`),
    textNode('settings.about.android', `Android version: ${world.device.androidVersion}`),
    textNode('settings.about.build', `Build number: ${world.device.build}`),
    button('settings.copy.model', 'Copy model name', (context) => {
      context.setClipboard(context.world.device.model);
    }),
    backButton(),
  ];
  return screen(PACKAGE, 'About phone', nodes);
}

export const settingsApp: SimApp = {
  package: PACKAGE,
  label: 'Settings',
  entry: 'settings.root',
  screens: {
    'settings.root': root,
    'settings.network': network,
    'settings.wifi': wifi,
    'settings.bluetooth': bluetooth,
    'settings.battery': battery,
    'settings.display': display,
    'settings.about': about,
  },
};

export const settingsScreens = (): Record<string, (world: WorldState) => ScreenSpec> => settingsApp.screens;

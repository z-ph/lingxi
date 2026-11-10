/** Authenticator fixture app: one-time codes and a copy action. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { button, screen, textNode } from '../ui.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.authenticator';

function list(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Authenticator', [
    ...world.authenticator.flatMap((entry) => [
      textNode(`auth.entry.${entry.id}`, `${entry.account}: ${entry.code}`),
      button(`auth.copy.${entry.id}`, `Copy code for ${entry.account}`, (context) => {
        context.setClipboard(entry.code);
      }),
    ]),
  ]);
}

export const authenticatorApp: SimApp = {
  package: PACKAGE,
  label: 'Authenticator',
  entry: 'auth.list',
  screens: {
    'auth.list': list,
  },
};

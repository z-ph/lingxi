/** Delivery fixture app: tracking lookup. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.delivery';

function home(world: WorldState): ScreenSpec {
  const status = world.delivery.tracked
    ? `Tracking ${world.delivery.query}: ${world.delivery.lastStatus}`
    : 'Enter a tracking number to see its status.';
  return screen(PACKAGE, 'Delivery', [
    inputNode('delivery.tracking', 'Tracking number', field(world, 'delivery', 'tracking'), (context, text) => {
      setField(context.world, 'delivery', 'tracking', text);
    }),
    button('delivery.track', 'Track', (context) => {
      const query = field(context.world, 'delivery', 'tracking').trim();
      if (query.length === 0) {
        context.toast('Tracking number is required.');
        return;
      }
      const shipment = context.world.delivery.shipments.find((candidate) => candidate.tracking === query);
      context.world.delivery.query = query;
      context.world.delivery.tracked = true;
      context.world.delivery.lastStatus = shipment?.status ?? 'Not found';
      context.toast(`Status: ${context.world.delivery.lastStatus}`);
    }),
    textNode('delivery.status', status),
    backButton(),
  ]);
}

export const deliveryApp: SimApp = {
  package: PACKAGE,
  label: 'Delivery',
  entry: 'delivery.home',
  screens: {
    'delivery.home': home,
  },
};

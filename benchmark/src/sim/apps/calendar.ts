/** Calendar fixture app: list events, open detail, copy time. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, row, screen, textNode } from '../ui.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.calendar';

function list(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Calendar', [
    ...world.calendar.map((event) =>
      row(`calendar.row.${event.id}`, `${event.title} — ${event.date} ${event.time}`, (context) => {
        context.world.selection.eventId = event.id;
        context.navigate('calendar.detail');
      }),
    ),
  ]);
}

function detail(world: WorldState): ScreenSpec {
  const event = world.calendar.find((candidate) => candidate.id === world.selection.eventId);
  if (event === undefined) {
    return screen(PACKAGE, 'Event', [textNode('calendar.none', 'No event selected.'), backButton()]);
  }
  return screen(PACKAGE, event.title, [
    textNode('calendar.detail.title', `Title: ${event.title}`),
    textNode('calendar.detail.date', `Date: ${event.date}`),
    textNode('calendar.detail.time', `Time: ${event.time}`),
    textNode('calendar.detail.location', `Location: ${event.location}`),
    button('calendar.copy.time', 'Copy time', (context) => {
      context.setClipboard(event.time);
    }),
    backButton(),
  ]);
}

export const calendarApp: SimApp = {
  package: PACKAGE,
  label: 'Calendar',
  entry: 'calendar.list',
  screens: {
    'calendar.list': list,
    'calendar.detail': detail,
  },
};

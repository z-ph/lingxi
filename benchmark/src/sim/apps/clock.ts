/** Clock fixture app: reminders list and a create-reminder form. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.clock';

function list(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Clock', [
    button('clock.add', 'Add reminder', (context) => {
      beginForm(context.world, 'clockReminder', { title: '', time: '' });
      context.navigate('clock.edit');
    }),
    ...world.clock.reminders.map((reminder) =>
      textNode(`clock.row.${reminder.id}`, `${reminder.title} — ${reminder.time}`),
    ),
    ...(world.clock.reminders.length === 0 ? [textNode('clock.empty', 'No reminders.')] : []),
  ]);
}

function edit(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'New reminder', [
    inputNode('clock.edit.title', 'Title', field(world, 'clockReminder', 'title'), (context, text) => {
      setField(context.world, 'clockReminder', 'title', text);
    }),
    inputNode('clock.edit.time', 'Time', field(world, 'clockReminder', 'time'), (context, text) => {
      setField(context.world, 'clockReminder', 'time', text);
    }),
    button('clock.save', 'Save', (context) => {
      const title = field(context.world, 'clockReminder', 'title').trim();
      const time = field(context.world, 'clockReminder', 'time').trim();
      if (title.length === 0 || time.length === 0) {
        context.toast('Title and time are required.');
        return;
      }
      context.world.clock.reminders.push({ id: `reminder-${context.world.clock.reminders.length + 1}`, title, time });
      context.navigate('clock.list');
    }),
    backButton('Cancel'),
  ]);
}

export const clockApp: SimApp = {
  package: PACKAGE,
  label: 'Clock',
  entry: 'clock.list',
  screens: {
    'clock.list': list,
    'clock.edit': edit,
  },
};

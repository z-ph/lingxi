/** Notes fixture app: create, edit, rename, copy all. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, row, screen } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'net.gsantner.markor';

function list(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Notes', [
    button('notes.new', 'New note', (context) => {
      context.world.selection.noteId = null;
      beginForm(context.world, 'note', { title: '', body: '' });
      context.navigate('notes.editor');
    }),
    ...world.notes.map((note) =>
      row(`notes.note.${note.id}`, `${note.title}: ${note.body}`, (context) => {
        context.world.selection.noteId = note.id;
        beginForm(context.world, 'note', { title: note.title, body: note.body });
        context.navigate('notes.editor');
      }),
    ),
  ]);
}

function editor(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Edit note', [
    inputNode('notes.title', 'Title', field(world, 'note', 'title'), (context, text) => {
      setField(context.world, 'note', 'title', text);
    }),
    inputNode('notes.body', 'Body', field(world, 'note', 'body'), (context, text) => {
      setField(context.world, 'note', 'body', text);
    }),
    button('notes.save', 'Save', (context) => {
      const title = field(context.world, 'note', 'title').trim();
      const body = field(context.world, 'note', 'body');
      if (title.length === 0) {
        context.toast('Title is required.');
        return;
      }
      const selected = context.world.selection.noteId;
      const existing = context.world.notes.find((note) => note.id === selected);
      if (existing === undefined) {
        context.world.notes.push({ id: `note-${context.world.notes.length + 1}`, title, body });
        context.world.selection.noteId = null;
      } else {
        existing.title = title;
        existing.body = body;
      }
      context.navigate('notes.list');
    }),
    button('notes.copyAll', 'Copy all', (context) => {
      context.setClipboard(field(context.world, 'note', 'body'));
    }),
    backButton('Discard'),
  ]);
}

export const notesApp: SimApp = {
  package: PACKAGE,
  label: 'Notes',
  entry: 'notes.list',
  screens: {
    'notes.list': list,
    'notes.editor': editor,
  },
};

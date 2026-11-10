/** Contacts fixture app: list, detail, copy fields, create contact. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, row, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.contacts';

function list(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Contacts', [
    button('contacts.new', 'Add contact', (context) => {
      context.world.selection.contactId = null;
      beginForm(context.world, 'contact', { name: '', phone: '', address: '' });
      context.navigate('contacts.edit');
    }),
    ...world.contacts.map((contact) =>
      row(`contacts.row.${contact.id}`, `${contact.name} — ${contact.phone}`, (context) => {
        context.world.selection.contactId = contact.id;
        context.navigate('contacts.detail');
      }),
    ),
  ]);
}

function detail(world: WorldState): ScreenSpec {
  const contact = world.contacts.find((candidate) => candidate.id === world.selection.contactId);
  if (contact === undefined) {
    return screen(PACKAGE, 'Contact', [textNode('contacts.none', 'No contact selected.'), backButton()]);
  }
  return screen(PACKAGE, contact.name, [
    textNode('contacts.detail.name', `Name: ${contact.name}`),
    textNode('contacts.detail.phone', `Phone: ${contact.phone}`),
    textNode('contacts.detail.address', `Address: ${contact.address}`),
    button('contacts.copy.phone', 'Copy phone', (context) => {
      context.setClipboard(contact.phone);
    }),
    button('contacts.copy.address', 'Copy address', (context) => {
      context.setClipboard(contact.address);
    }),
    button('contacts.edit', 'Edit contact', (context) => {
      beginForm(context.world, 'contact', {
        name: contact.name,
        phone: contact.phone,
        address: contact.address,
      });
      context.navigate('contacts.edit');
    }),
    backButton(),
  ]);
}

function edit(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Edit contact', [
    inputNode('contacts.edit.name', 'Name', field(world, 'contact', 'name'), (context, text) => {
      setField(context.world, 'contact', 'name', text);
    }),
    inputNode('contacts.edit.phone', 'Phone', field(world, 'contact', 'phone'), (context, text) => {
      setField(context.world, 'contact', 'phone', text);
    }),
    inputNode('contacts.edit.address', 'Address', field(world, 'contact', 'address'), (context, text) => {
      setField(context.world, 'contact', 'address', text);
    }),
    button('contacts.save', 'Save', (context) => {
      const name = field(context.world, 'contact', 'name').trim();
      const phone = field(context.world, 'contact', 'phone').trim();
      const address = field(context.world, 'contact', 'address').trim();
      if (name.length === 0 || phone.length === 0) {
        context.toast('Name and phone are required.');
        return;
      }
      const selected = context.world.selection.contactId;
      const existing = context.world.contacts.find((contact) => contact.id === selected);
      if (existing === undefined) {
        context.world.contacts.push({ id: `contact-${context.world.contacts.length + 1}`, name, phone, address });
        context.world.selection.contactId = null;
      } else {
        existing.name = name;
        existing.phone = phone;
        existing.address = address;
      }
      context.navigate('contacts.list');
    }),
    backButton('Cancel'),
  ]);
}

export const contactsApp: SimApp = {
  package: PACKAGE,
  label: 'Contacts',
  entry: 'contacts.list',
  screens: {
    'contacts.list': list,
    'contacts.detail': detail,
    'contacts.edit': edit,
  },
};

/** Mail fixture app: inbox/search, read, copy tokens, archive, delete, drafts. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, row, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { MailMessage, WorldState } from '../world.js';

const PACKAGE = 'com.example.mail';

function visibleMessages(world: WorldState): MailMessage[] {
  const query = field(world, 'mailSearch', 'query').trim().toLowerCase();
  return world.mail.filter((message) => {
    if (message.folder !== 'inbox') return false;
    if (query.length === 0) return true;
    return (
      message.from.toLowerCase().includes(query) ||
      message.subject.toLowerCase().includes(query) ||
      message.body.toLowerCase().includes(query)
    );
  });
}

function extractToken(text: string): string | null {
  const code = /\b(\d{6})\b/u.exec(text);
  if (code?.[1] !== undefined) return code[1];
  const reference = /\b([A-Z]{2}-\d{4})\b/u.exec(text);
  if (reference?.[1] !== undefined) return reference[1];
  const tracking = /\b(1Z[A-Z0-9]{16})\b/u.exec(text);
  return tracking?.[1] ?? null;
}

function extractAmount(text: string): string | null {
  const match = /\$(\d+(?:\.\d{2})?)/u.exec(text);
  return match?.[1] ?? null;
}

function inbox(world: WorldState): ScreenSpec {
  const messages = visibleMessages(world);
  return screen(PACKAGE, 'Inbox', [
    inputNode('mail.search', 'Search mail', field(world, 'mailSearch', 'query'), (context, text) => {
      setField(context.world, 'mailSearch', 'query', text);
    }),
    button('mail.compose', 'Compose', (context) => {
      beginForm(context.world, 'mailCompose', { to: '', subject: '', body: '' });
      context.navigate('mail.compose');
    }),
    ...messages.map((message) =>
      row(
        `mail.row.${message.id}`,
        `${message.read ? '' : '[unread] '}${message.from}: ${message.subject}`,
        (context) => {
          context.world.selection.mailId = message.id;
          message.read = true;
          context.navigate('mail.message');
        },
      ),
    ),
    ...(messages.length === 0 ? [textNode('mail.empty', 'No messages match.')] : []),
  ]);
}

function message(world: WorldState): ScreenSpec {
  const selected = world.mail.find((candidate) => candidate.id === world.selection.mailId);
  if (selected === undefined) {
    return screen(PACKAGE, 'Mail', [textNode('mail.none', 'No message selected.'), backButton()]);
  }
  const amount = extractAmount(selected.body);
  return screen(PACKAGE, selected.subject, [
    textNode('mail.message.from', `From: ${selected.from}`),
    textNode('mail.message.subject', `Subject: ${selected.subject}`),
    textNode('mail.message.body', selected.body),
    button('mail.copy.code', 'Copy code or reference', (context) => {
      const token = extractToken(selected.body);
      if (token === null) {
        context.toast('No code or reference in this message.');
        return;
      }
      context.setClipboard(token);
    }),
    ...(amount === null
      ? []
      : [
          button('mail.copy.amount', 'Copy amount', (context) => {
            context.setClipboard(`$${amount}`);
          }),
        ]),
    button('mail.archive', 'Archive', (context) => {
      selected.folder = 'archive';
      context.navigate('mail.inbox');
    }),
    button(
      'mail.delete',
      'Delete',
      (context) => {
        context.toast('Delete requires device confirmation.');
      },
      { danger: 'delete' },
    ),
    backButton(),
  ]);
}

function compose(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Compose', [
    inputNode('mail.compose.to', 'To', field(world, 'mailCompose', 'to'), (context, text) => {
      setField(context.world, 'mailCompose', 'to', text);
    }),
    inputNode('mail.compose.subject', 'Subject', field(world, 'mailCompose', 'subject'), (context, text) => {
      setField(context.world, 'mailCompose', 'subject', text);
    }),
    inputNode('mail.compose.body', 'Body', field(world, 'mailCompose', 'body'), (context, text) => {
      setField(context.world, 'mailCompose', 'body', text);
    }),
    button('mail.compose.save', 'Save draft', (context) => {
      const to = field(context.world, 'mailCompose', 'to').trim();
      const subject = field(context.world, 'mailCompose', 'subject').trim();
      const body = field(context.world, 'mailCompose', 'body');
      if (to.length === 0 || body.length === 0) {
        context.toast('To and body are required.');
        return;
      }
      context.world.mailDrafts.push({ to, subject, body });
      context.toast('Draft saved.');
      context.navigate('mail.inbox');
    }),
    button(
      'mail.compose.send',
      'Send',
      (context) => {
        context.toast('Sending requires device confirmation.');
      },
      { danger: 'send' },
    ),
    backButton(),
  ]);
}

export const mailApp: SimApp = {
  package: PACKAGE,
  label: 'Mail',
  entry: 'mail.inbox',
  screens: {
    'mail.inbox': inbox,
    'mail.message': message,
    'mail.compose': compose,
  },
};

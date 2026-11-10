/** Messages fixture app: list/search, failed-load retry, copy code, archive. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, row, screen, textNode } from '../ui.js';
import { field, setField } from '../world.js';
import type { Thread, WorldState } from '../world.js';

const PACKAGE = 'com.android.messages';

export function unreadCount(world: WorldState): number {
  return world.messages.filter((thread) => thread.unread && !thread.archived).length;
}

function visibleThreads(world: WorldState): Thread[] {
  const query = field(world, 'threadSearch', 'query').trim().toLowerCase();
  return world.messages.filter((thread) => {
    if (thread.archived) return false;
    if (query.length === 0) return true;
    return (
      thread.from.toLowerCase().includes(query) ||
      thread.preview.toLowerCase().includes(query) ||
      thread.messages.some((message) => message.text.toLowerCase().includes(query))
    );
  });
}

function threadText(thread: Thread): string {
  return thread.messages.map((message) => message.text).join(' ');
}

function firstCode(thread: Thread): string | null {
  const match = /\b(\d{6})\b/u.exec(threadText(thread));
  return match?.[1] ?? null;
}

function firstPhone(thread: Thread): string | null {
  const match = /\b(\d{3}-\d{4})\b/u.exec(threadText(thread));
  return match?.[1] ?? null;
}

function list(world: WorldState): ScreenSpec {
  const threads = visibleThreads(world);
  return screen(PACKAGE, 'Messages', [
    textNode('messages.unread', `${unreadCount(world)} unread`),
    button('messages.copy.unread', 'Copy unread count', (context) => {
      context.setClipboard(String(unreadCount(context.world)));
    }),
    inputNode('messages.search', 'Search messages', field(world, 'threadSearch', 'query'), (context, text) => {
      setField(context.world, 'threadSearch', 'query', text);
    }),
    ...threads.map((thread) =>
      row(
        `messages.thread.${thread.id}`,
        `${thread.from}: ${thread.preview}${thread.unread ? ' (unread)' : ''}`,
        (context) => {
          thread.unread = false;
          context.world.selection.threadId = thread.id;
          context.navigate('messages.thread');
        },
      ),
    ),
    ...(threads.length === 0 ? [textNode('messages.empty', 'No conversations match.')] : []),
  ]);
}

function threadScreen(world: WorldState): ScreenSpec {
  const thread = world.messages.find((candidate) => candidate.id === world.selection.threadId);
  if (thread === undefined) {
    return screen(PACKAGE, 'Messages', [textNode('messages.none', 'No conversation selected.'), backButton()]);
  }
  if (thread.failedLoads > 0) {
    return screen(PACKAGE, thread.from, [
      textNode('messages.failed', 'Messages could not be loaded.'),
      button('messages.retry', 'Tap to retry', (context) => {
        const current = context.world.messages.find((candidate) => candidate.id === thread.id);
        if (current !== undefined) current.failedLoads = 0;
        context.toast('Loading messages…');
      }),
      button(
        'messages.archive',
        'Archive conversation',
        (context) => {
          thread.archived = true;
          context.back();
        },
      ),
      backButton(),
    ]);
  }
  return screen(PACKAGE, thread.from, [
    ...thread.messages.map((message) => textNode(`messages.item.${message.id}`, `${message.from}: ${message.text}`)),
    button('messages.copy.code', 'Copy code', (context) => {
      const code = firstCode(thread);
      if (code === null) {
        context.toast('No code in this conversation.');
        return;
      }
      context.setClipboard(code);
    }),
    ...(firstPhone(thread) === null
      ? []
      : [
          button('messages.copy.phone', 'Copy phone number', (context) => {
            const phone = firstPhone(thread);
            if (phone !== null) context.setClipboard(phone);
          }),
        ]),
    button(
      'messages.archive',
      'Archive conversation',
      (context) => {
        thread.archived = true;
        context.back();
      },
    ),
    backButton(),
  ]);
}

export const messagesApp: SimApp = {
  package: PACKAGE,
  label: 'Messages',
  entry: 'messages.list',
  screens: {
    'messages.list': list,
    'messages.thread': threadScreen,
  },
};

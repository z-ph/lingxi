/** Registry of fixture apps installed on the simulated phone. */

import { authenticatorApp } from './authenticator.js';
import { bankApp } from './bank.js';
import { calculatorApp } from './calculator.js';
import { calendarApp } from './calendar.js';
import { clockApp } from './clock.js';
import { contactsApp } from './contacts.js';
import { deliveryApp } from './delivery.js';
import { mailApp } from './mail.js';
import { messagesApp } from './messages.js';
import { notesApp } from './notes.js';
import { settingsApp } from './settings.js';
import { shopApp } from './shop.js';
import type { SimApp } from '../ui.js';

/** Fixed app set: every task in the suite runs against this same install. */
export const APPS: readonly SimApp[] = [
  settingsApp,
  messagesApp,
  notesApp,
  shopApp,
  contactsApp,
  mailApp,
  bankApp,
  calculatorApp,
  calendarApp,
  clockApp,
  authenticatorApp,
  deliveryApp,
];

export const APP_PACKAGES: readonly string[] = APPS.map((app) => app.package);

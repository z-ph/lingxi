/** Bank fixture app: OTP login, balance read, gated transfer. */

import type { ScreenSpec, SimApp } from '../ui.js';
import { backButton, button, inputNode, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.bank';

function login(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Bank', [
    textNode('bank.login.hint', 'Enter the verification code from your messages or authenticator.'),
    inputNode('bank.otp', 'Verification code', field(world, 'bankLogin', 'code'), (context, text) => {
      setField(context.world, 'bankLogin', 'code', text);
    }),
    button('bank.login.submit', 'Verify', (context) => {
      const code = field(context.world, 'bankLogin', 'code').trim();
      if (!context.world.bank.validCodes.includes(code)) {
        context.toast('Invalid verification code.');
        return;
      }
      context.world.bank.loggedIn = true;
      context.navigate('bank.summary');
    }),
  ]);
}

function summary(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Account summary', [
    textNode('bank.summary.balance', `Balance: ${world.bank.balance}`),
    button('bank.copy.balance', 'Copy balance', (context) => {
      context.setClipboard(context.world.bank.balance);
    }),
    button('bank.transfer.open', 'Transfer money', (context) => {
      beginForm(context.world, 'bankTransfer', { to: '', amount: '' });
      context.navigate('bank.transfer');
    }),
    backButton('Log out'),
  ]);
}

function transfer(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Transfer', [
    inputNode('bank.transfer.to', 'Recipient', field(world, 'bankTransfer', 'to'), (context, text) => {
      setField(context.world, 'bankTransfer', 'to', text);
    }),
    inputNode('bank.transfer.amount', 'Amount', field(world, 'bankTransfer', 'amount'), (context, text) => {
      setField(context.world, 'bankTransfer', 'amount', text);
    }),
    button(
      'bank.transfer.send',
      'Send money',
      (context) => {
        context.toast('Sending money requires device confirmation.');
      },
      { danger: 'payment' },
    ),
    backButton(),
  ]);
}

export const bankApp: SimApp = {
  package: PACKAGE,
  label: 'Bank',
  entry: 'bank.login',
  screens: {
    'bank.login': login,
    'bank.summary': summary,
    'bank.transfer': transfer,
  },
};

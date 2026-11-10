/** Calculator fixture app: tap digits/operators, read or copy the result. */

import type { ActionContext, ScreenSpec, SimApp } from '../ui.js';
import { button, screen, textNode } from '../ui.js';
import type { WorldState } from '../world.js';

const PACKAGE = 'com.example.calculator';

function calculate(left: number, op: string, right: number): number {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? NaN : left / right;
    default:
      return right;
  }
}

function digitAction(value: string): (context: ActionContext) => void {
  return (context) => {
    const calculator = context.world.calculator;
    calculator.display = calculator.fresh || calculator.display === '0' ? value : `${calculator.display}${value}`;
    calculator.fresh = false;
  };
}

function operatorAction(op: '+' | '-' | '*' | '/'): (context: ActionContext) => void {
  return (context) => {
    const calculator = context.world.calculator;
    calculator.left = Number.parseFloat(calculator.display);
    calculator.op = op;
    calculator.fresh = true;
  };
}

function display(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Calculator', [
    textNode('calc.display', world.calculator.display),
    ...['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((value) =>
      button(`calc.digit.${value}`, value, digitAction(value)),
    ),
    button('calc.op.add', '+', operatorAction('+')),
    button('calc.op.sub', '-', operatorAction('-')),
    button('calc.op.mul', '×', operatorAction('*')),
    button('calc.op.div', '÷', operatorAction('/')),
    button('calc.equals', '=', (context) => {
      const calculator = context.world.calculator;
      if (calculator.left === null || calculator.op === null) return;
      const result = calculate(calculator.left, calculator.op, Number.parseFloat(calculator.display));
      calculator.display = Number.isFinite(result) ? String(result) : 'Error';
      calculator.left = null;
      calculator.op = null;
      calculator.fresh = true;
    }),
    button('calc.clear', 'Clear', (context) => {
      context.world.calculator = { display: '0', left: null, op: null, fresh: true };
    }),
    button('calc.copy', 'Copy result', (context) => {
      context.setClipboard(context.world.calculator.display);
    }),
  ]);
}

export const calculatorApp: SimApp = {
  package: PACKAGE,
  label: 'Calculator',
  entry: 'calc.display',
  screens: {
    'calc.display': display,
  },
};

/** Small screen-builder helpers shared by the fixture apps. */

import type { DangerKind } from '../types.js';
import type { WorldState } from './world.js';

export interface ActionContext {
  world: WorldState;
  navigate: (screenId: string) => void;
  back: () => void;
  launch: (packageName: string) => void;
  setClipboard: (text: string) => void;
  toast: (message: string) => void;
}

export interface UiNodeSpec {
  id: string;
  text: string;
  description?: string;
  clickable?: boolean;
  editable?: boolean;
  danger?: DangerKind;
  onTap?: (context: ActionContext) => void;
  onType?: (context: ActionContext, text: string) => void;
  onSubmit?: (context: ActionContext) => void;
}

export interface ScreenSpec {
  package: string;
  title: string;
  /** One or more pages; tapping and ui_tree only see the current page. */
  pages: UiNodeSpec[][];
}

export type ScreenBuilder = (world: WorldState) => ScreenSpec;

export interface SimApp {
  package: string;
  label: string;
  entry: string;
  screens: Record<string, ScreenBuilder>;
}

export interface NodeOptions {
  description?: string;
  danger?: DangerKind;
}

export function screen(packageName: string, title: string, nodes: UiNodeSpec[]): ScreenSpec {
  return { package: packageName, title, pages: [nodes] };
}

export function pagedScreen(packageName: string, title: string, pages: UiNodeSpec[][]): ScreenSpec {
  return { package: packageName, title, pages: pages.length === 0 ? [[]] : pages };
}

export function textNode(id: string, text: string): UiNodeSpec {
  return { id, text, clickable: false };
}

export function button(
  id: string,
  text: string,
  onTap: (context: ActionContext) => void,
  options: NodeOptions = {},
): UiNodeSpec {
  return {
    id,
    text,
    clickable: true,
    onTap,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.danger === undefined ? {} : { danger: options.danger }),
  };
}

export function row(
  id: string,
  text: string,
  onTap: (context: ActionContext) => void,
  options: NodeOptions = {},
): UiNodeSpec {
  return button(id, text, onTap, options);
}

export function toggle(
  id: string,
  label: string,
  active: boolean,
  onToggle: (context: ActionContext) => void,
  options: NodeOptions = {},
): UiNodeSpec {
  return button(id, `${label}: ${active ? 'On' : 'Off'}`, onToggle, {
    description: `${label} switch`,
    ...options,
  });
}

export function inputNode(
  id: string,
  label: string,
  value: string,
  onType: (context: ActionContext, text: string) => void,
): UiNodeSpec {
  return {
    id,
    text: `${label}: ${value.length === 0 ? '(empty)' : value}`,
    description: `${label} input`,
    clickable: true,
    editable: true,
    onType,
  };
}

export function backButton(label = 'Back'): UiNodeSpec {
  return button('ui.back', label, (context) => context.back());
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages.length === 0 ? [[]] : pages;
}

export function formatMoney(value: number): string {
  return value.toFixed(2);
}

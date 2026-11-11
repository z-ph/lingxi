export interface ToolContract {
  name: string;
  description: string;
}

export const TOOL_NAMES = [
  'screenshot',
  'ui_tree',
  'tap',
  'swipe',
  'type',
  'launch_app',
  'wait_for',
  'observe',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const ERROR_CODES = [
  'not_found',
  'blocked',
  'needs_confirmation',
  'timeout',
  'permission_denied',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

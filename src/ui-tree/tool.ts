import {
  DEFAULT_MAX_DEPTH,
  MAX_TEXT_LENGTH,
  snapshotUiTree,
  type UiTreeSnapshot,
} from './prune.js';
import type { RawUiNode, UiTreeOptions } from './types.js';

/**
 * The narrow slice of the device adapter that ui_tree needs.
 *
 * The M1 `Device` exposes `uiTree(options)`; {@link uiTreeSourceFromDevice}
 * adapts it without making this module depend on the rest of the daemon.
 */
export interface UiTreeSource {
  /** Dump the current accessibility hierarchy from the device. */
  dumpUiTree(): Promise<RawUiNode>;
}

/**
 * Ask the device layer for the widest tree it supports; pruning belongs here,
 * not in the adapter. M1's `Device.uiTree()` already accepts these options and
 * returns the hierarchy without dropping non-interactive labels.
 */
const FULL_TREE_OPTIONS: UiTreeOptions = { interactiveOnly: false, maxDepth: 100 };

/** Adapt a device adapter that exposes `uiTree()` to a {@link UiTreeSource}. */
export function uiTreeSourceFromDevice(device: {
  uiTree(options?: UiTreeOptions): Promise<RawUiNode>;
}): UiTreeSource {
  return { dumpUiTree: () => device.uiTree(FULL_TREE_OPTIONS) };
}

export interface UiTreeToolResult extends UiTreeSnapshot {
  /** The exact text an MCP text-content result should carry (compact JSON). */
  readonly text: string;
}

/**
 * Execute the ui_tree tool against a device.
 *
 * This is transport-independent on purpose: the MCP server (issue #2) only
 * has to wrap `text` in a text content block and keep `byId` for nodeId-based
 * actions such as tap and type.
 */
export async function callUiTree(
  source: UiTreeSource,
  args: UiTreeOptions = {},
): Promise<UiTreeToolResult> {
  const root = await source.dumpUiTree();
  const snapshot = snapshotUiTree(root, args);
  return {
    ...snapshot,
    text: JSON.stringify(snapshot.payload),
  };
}

/** Stable tool name used by the MCP server. */
export const UI_TREE_TOOL_NAME = 'ui_tree';

/** MCP tool description: short, user-visible, and honest about the bounds. */
export const UI_TREE_TOOL_DESCRIPTION =
  `Read the current screen's pruned accessibility tree. Returns interactive nodes ` +
  `(clickable or editable) with snapshot-local id, text (<=${MAX_TEXT_LENGTH} chars), ` +
  `device-pixel bounds [left, top, right, bottom], clickable and editable. ` +
  `Set interactiveOnly=false to also read static text; use filter to find text or resource ids.`;

/** JSON Schema for the MCP tool registration. */
export const UI_TREE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    maxDepth: {
      type: 'integer',
      minimum: 0,
      default: DEFAULT_MAX_DEPTH,
      description: 'Maximum traversal depth; root is 0. Defaults to 30.',
    },
    interactiveOnly: {
      type: 'boolean',
      default: true,
      description:
        'Keep only clickable/editable nodes. Set false to include static text nodes for reading.',
    },
    filter: {
      type: 'string',
      description:
        'Case-insensitive substring matched against visible text and resource id.',
    },
  },
  additionalProperties: false,
} as const;

/**
 * The tool definition an MCP server registers. Kept as plain data so the
 * server can adapt it to the MCP SDK version it uses.
 */
export const UI_TREE_TOOL = {
  name: UI_TREE_TOOL_NAME,
  description: UI_TREE_TOOL_DESCRIPTION,
  inputSchema: UI_TREE_INPUT_SCHEMA,
} as const;

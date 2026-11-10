/**
 * The M1 tool surface.
 *
 * Six tools are advertised to MCP clients (docs/roadmap.md, M1):
 * screenshot, ui_tree, tap, type, launch_app, wait_for.
 *
 * This module is deliberately thin: it validates arguments, calls the Device
 * adapter and returns JSON plus image content. ui_tree pruning/token budgets
 * are issue #3 and observed-effect typing for write actions is issue #4; both
 * refine this layer without changing the pairing/auth boundary.
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DeviceError } from '../device/types.js';
import type { ActionResult, Device, RawUiNode } from '../device/types.js';
import { MCP_SERVER_NAME, VERSION } from '../version.js';

export const M1_TOOL_NAMES = [
  'screenshot',
  'ui_tree',
  'tap',
  'type',
  'launch_app',
  'wait_for',
] as const;

const screenshotInput = z.object({
  format: z.enum(['png', 'jpeg']).optional().describe('Image format; defaults to png.'),
  quality: z.number().int().min(1).max(100).optional().describe('JPEG quality 1-100.'),
});

const uiTreeInput = z.object({
  maxDepth: z.number().int().min(0).max(100).optional().describe('Maximum traversal depth; root is depth 0.'),
  interactiveOnly: z
    .boolean()
    .optional()
    .describe('Only return clickable/editable nodes and their ancestors; defaults to true.'),
  filter: z.string().max(200).optional().describe('Case-insensitive substring matched against text, id and description.'),
});

const tapInput = z.object({
  nodeId: z.string().min(1).optional().describe('Node handle from ui_tree.'),
  x: z.number().int().optional().describe('Screen x coordinate; use together with y.'),
  y: z.number().int().optional().describe('Screen y coordinate; use together with x.'),
});

const typeInput = z.object({
  nodeId: z.string().min(1).optional().describe('Editable node handle from ui_tree.'),
  focused: z.boolean().optional().describe('Type into the currently focused editable node.'),
  text: z.string().min(1).max(10_000).describe('Text to type.'),
  submit: z.boolean().optional().describe('Submit after typing.'),
});

const launchAppInput = z.object({
  package: z.string().min(1).optional().describe('Android package name.'),
  label: z.string().min(1).optional().describe('App label as shown on the launcher.'),
});

const waitForInput = z.object({
  nodeText: z.string().min(1).optional().describe('Wait until a visible node contains this text.'),
  package: z.string().min(1).optional().describe('Wait until this package is in the foreground.'),
  timeoutMs: z.number().int().min(1).max(120_000).describe('Timeout in milliseconds.'),
});

function jsonResult(value: unknown, isError = false): CallToolResult {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = JSON.stringify({ ok: false, error: { code: 'internal', message: 'result was not serializable' } });
  }
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

function failure(error: unknown): CallToolResult {
  const code = error instanceof DeviceError ? error.code : 'internal';
  const message = error instanceof Error ? error.message : String(error);
  return jsonResult({ ok: false, error: { code, message } }, true);
}

function actionResult(result: ActionResult): CallToolResult {
  return jsonResult(result, !result.ok);
}

function invalid(message: string): CallToolResult {
  return jsonResult({ ok: false, error: { code: 'invalid_argument', message } }, true);
}

function flattenNodes(node: RawUiNode): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const walk = (current: RawUiNode): void => {
    output.push({
      id: current.id ?? '',
      text: current.text ?? current.description ?? '',
      bounds: [current.bounds.left, current.bounds.top, current.bounds.right, current.bounds.bottom],
      clickable: current.clickable === true,
      editable: current.editable === true,
    });
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return output;
}

export function createDeviceServer(device: Device): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: VERSION });

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot',
      description: 'Capture the current phone screen. Returns an image plus width, height and timestamp.',
      inputSchema: screenshotInput,
      annotations: { readOnlyHint: true },
    },
    async ({ format, quality }) => {
      try {
        const shot = await device.screenshot({
          ...(format === undefined ? {} : { format }),
          ...(quality === undefined ? {} : { quality }),
        });
        return {
          content: [
            {
              type: 'image',
              data: shot.data,
              mimeType: shot.format === 'jpeg' ? 'image/jpeg' : 'image/png',
            },
            {
              type: 'text',
              text: JSON.stringify({
                format: shot.format,
                width: shot.width,
                height: shot.height,
                timestamp: shot.timestamp,
              }),
            },
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'ui_tree',
    {
      title: 'UI tree',
      description: 'Read the current accessibility tree. Defaults to interactive nodes; text and depth can be bounded.',
      inputSchema: uiTreeInput,
      annotations: { readOnlyHint: true },
    },
    async ({ maxDepth, interactiveOnly, filter }) => {
      try {
        const tree = await device.uiTree({
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(interactiveOnly === undefined ? {} : { interactiveOnly }),
          ...(filter === undefined ? {} : { filter }),
        });
        return jsonResult({ nodes: flattenNodes(tree), truncated: false });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'tap',
    {
      title: 'Tap',
      description: 'Tap a ui_tree node (nodeId) or screen coordinates (x, y).',
      inputSchema: tapInput,
      annotations: { readOnlyHint: false },
    },
    async ({ nodeId, x, y }) => {
      const hasNode = nodeId !== undefined;
      const hasPoint = x !== undefined && y !== undefined;
      if (hasNode === hasPoint) {
        return invalid('tap needs either nodeId or both x and y');
      }
      if (!hasNode && (x === undefined || y === undefined)) {
        return invalid('tap needs both x and y');
      }
      try {
        return actionResult(
          await device.tap({
            ...(nodeId === undefined ? {} : { nodeId }),
            ...(x === undefined ? {} : { x }),
            ...(y === undefined ? {} : { y }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'type',
    {
      title: 'Type',
      description: 'Type text into an editable node, or into the currently focused editable node.',
      inputSchema: typeInput,
      annotations: { readOnlyHint: false },
    },
    async ({ nodeId, focused, text, submit }) => {
      const hasNode = nodeId !== undefined;
      if (hasNode === (focused === true)) {
        return invalid('type needs either nodeId or focused: true');
      }
      try {
        return actionResult(
          await device.type({
            ...(nodeId === undefined ? {} : { nodeId }),
            ...(focused === undefined ? {} : { focused }),
            text,
            ...(submit === undefined ? {} : { submit }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'launch_app',
    {
      title: 'Launch app',
      description: 'Launch an installed app by package name or label and report the foreground package.',
      inputSchema: launchAppInput,
      annotations: { readOnlyHint: false },
    },
    async ({ package: packageName, label }) => {
      if ((packageName === undefined) === (label === undefined)) {
        return invalid('launch_app needs either package or label');
      }
      try {
        return actionResult(
          await device.launchApp({
            ...(packageName === undefined ? {} : { package: packageName }),
            ...(label === undefined ? {} : { label }),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'wait_for',
    {
      title: 'Wait for',
      description: 'Wait until a visible node contains text or a package is in the foreground.',
      inputSchema: waitForInput,
      annotations: { readOnlyHint: true },
    },
    async ({ nodeText, package: packageName, timeoutMs }) => {
      if (nodeText === undefined && packageName === undefined) {
        return invalid('wait_for needs nodeText or package');
      }
      try {
        return actionResult(
          await device.waitFor({
            ...(nodeText === undefined ? {} : { nodeText }),
            ...(packageName === undefined ? {} : { package: packageName }),
            timeoutMs,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

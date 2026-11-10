import type {
  RawUiNode,
  UiTreeBounds,
  UiTreeNode,
  UiTreeOptions,
  UiTreePayload,
} from './types.js';

/** The daemon, not the client, owns this bound. See docs/mcp-tools.md. */
export const MAX_TEXT_LENGTH = 100;

/** Default traversal depth. Root is depth 0. */
export const DEFAULT_MAX_DEPTH = 30;

/**
 * Result of a pruning pass.
 *
 * `byId` maps payload handles back to raw device nodes so tap/type can resolve
 * a `nodeId` without another device dump. Handles are snapshot-local.
 */
export interface UiTreeSnapshot {
  readonly payload: UiTreePayload;
  readonly byId: ReadonlyMap<string, RawUiNode>;
}

interface PruneSettings {
  readonly maxDepth: number;
  readonly interactiveOnly: boolean;
  /** Lower-cased, trimmed; empty means "no filter". */
  readonly filter: string;
}

interface PruneState {
  readonly settings: PruneSettings;
  readonly nodes: UiTreeNode[];
  readonly byId: Map<string, RawUiNode>;
  nextOrdinal: number;
  truncated: boolean;
}

interface SelectedText {
  /** Full text before the 100-char display cap (used for filtering too). */
  readonly full: string;
  readonly display: string;
  readonly clipped: boolean;
}

/**
 * Prune a raw accessibility tree into the bounded `ui_tree` payload.
 *
 * Defaults: interactive nodes only, maxDepth 30, text capped at 100 Unicode
 * code points. See docs/mcp-tools.md for the payload contract.
 */
export function snapshotUiTree(
  root: RawUiNode,
  options: UiTreeOptions = {},
): UiTreeSnapshot {
  const state: PruneState = {
    settings: normalizeOptions(options),
    nodes: [],
    byId: new Map<string, RawUiNode>(),
    nextOrdinal: 1,
    truncated: false,
  };

  walk(root, 0, state);

  const payload: UiTreePayload = {
    nodes: state.nodes,
    truncated: state.truncated,
  };
  return { payload, byId: state.byId };
}

/** Convenience wrapper when the caller only needs the payload. */
export function pruneUiTree(root: RawUiNode, options: UiTreeOptions = {}): UiTreePayload {
  return snapshotUiTree(root, options).payload;
}

function walk(node: RawUiNode, depth: number, state: PruneState): void {
  if (node.visible === false) return;

  const interactive = node.clickable === true || node.editable === true;
  const text = selectText(node, interactive);
  const included =
    (state.settings.interactiveOnly ? interactive : interactive || text.full.length > 0) &&
    matchesFilter(node, text, state.settings.filter);

  if (included) {
    const id = `n${state.nextOrdinal}`;
    state.nextOrdinal += 1;
    const record: UiTreeNode = {
      id,
      text: text.display,
      bounds: boundsOf(node),
      clickable: node.clickable === true,
      editable: node.editable === true,
    };
    state.nodes.push(record);
    state.byId.set(id, node);
    if (text.clipped) state.truncated = true;
  }

  const children = node.children ?? [];
  if (children.length === 0) return;
  if (depth >= state.settings.maxDepth) {
    if (children.some((child) => child.visible !== false)) state.truncated = true;
    return;
  }
  for (const child of children) walk(child, depth + 1, state);
}

function normalizeOptions(options: UiTreeOptions): PruneSettings {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError(`ui_tree maxDepth must be an integer >= 0, got ${String(maxDepth)}`);
  }

  const interactiveOnly = options.interactiveOnly ?? true;
  if (typeof interactiveOnly !== 'boolean') {
    throw new TypeError('ui_tree interactiveOnly must be a boolean');
  }

  const rawFilter = options.filter ?? '';
  if (typeof rawFilter !== 'string') {
    throw new TypeError('ui_tree filter must be a string');
  }

  return { maxDepth, interactiveOnly, filter: rawFilter.trim().toLowerCase() };
}

/**
 * Text shown for a node.
 *
 * Interactive nodes often carry no text themselves: Android puts the label on
 * a non-interactive child TextView. For those nodes we bubble up the labels of
 * non-interactive descendants so the clickable row is still identifiable. When
 * `interactiveOnly` is false, static nodes keep their own label and their
 * labels remain separate entries.
 */
function selectText(node: RawUiNode, interactive: boolean): SelectedText {
  const own = ownLabel(node);
  if (own) return cap(own);

  if (!interactive) return { full: '', display: '', clipped: false };

  const parts: string[] = [];
  collectDescendantLabels(node, parts);
  if (parts.length === 0) return { full: '', display: '', clipped: false };
  return cap(parts.join(' '));
}

function ownLabel(node: RawUiNode): string {
  const text = collapseWhitespace(node.text);
  if (text) return text;
  return collapseWhitespace(node.description);
}

function collectDescendantLabels(node: RawUiNode, parts: string[]): void {
  for (const child of node.children ?? []) {
    if (child.visible === false) continue;
    if (child.clickable === true || child.editable === true) continue;
    const label = ownLabel(child);
    if (label) parts.push(label);
    collectDescendantLabels(child, parts);
  }
}

function cap(value: string): SelectedText {
  const chars = Array.from(value);
  if (chars.length <= MAX_TEXT_LENGTH) {
    return { full: value, display: value, clipped: false };
  }
  return {
    full: value,
    display: `${chars.slice(0, MAX_TEXT_LENGTH - 1).join('')}…`,
    clipped: true,
  };
}

function collapseWhitespace(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function matchesFilter(node: RawUiNode, text: SelectedText, filter: string): boolean {
  if (!filter) return true;
  const description = collapseWhitespace(node.description);
  const haystack = `${text.full} ${description} ${node.id ?? ''}`.toLowerCase();
  return haystack.includes(filter);
}

function boundsOf(node: RawUiNode): UiTreeBounds {
  return [node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom];
}

/**
 * Types shared by the device adapter layer and the `ui_tree` tool.
 *
 * The raw types mirror what an Android accessibility dump (or the M1 fake
 * device) can provide. The payload types are the pruned, token-bounded shape
 * that is sent to the MCP client; see docs/mcp-tools.md for the contract.
 */

/** Device-pixel rectangle, in the same form as Android accessibility bounds. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * One node of the unpruned accessibility hierarchy.
 *
 * Device adapters may set extra fields; the pruner only reads the ones
 * declared here. `visible: false` nodes are ignored, as are their subtrees.
 */
export interface RawUiNode {
  /** Platform id when the adapter has one (Android resource-id). */
  readonly id?: string;
  /** Visible text. */
  readonly text?: string;
  /** Accessibility content description or hint. */
  readonly description?: string;
  readonly bounds: Bounds;
  readonly clickable?: boolean;
  readonly editable?: boolean;
  readonly visible?: boolean;
  readonly children?: readonly RawUiNode[];
}

/** Device-pixel [left, top, right, bottom], kept compact to save tokens. */
export type UiTreeBounds = readonly [number, number, number, number];

/** One node of the pruned payload. Field order is fixed for stable output. */
export interface UiTreeNode {
  /** Snapshot-local handle; pass it back to tap/type from the same snapshot. */
  readonly id: string;
  /** Visible text or content description, whitespace-collapsed, <= 100 chars. */
  readonly text: string;
  /** Device pixels: [left, top, right, bottom]. */
  readonly bounds: UiTreeBounds;
  readonly clickable: boolean;
  readonly editable: boolean;
}

/** The `ui_tree` result body. */
export interface UiTreePayload {
  /** Pre-order list of kept nodes (the pruned tree, flattened). */
  readonly nodes: readonly UiTreeNode[];
  /** True when maxDepth or the text cap dropped/shortened something. */
  readonly truncated: boolean;
}

/** Parameters accepted by the `ui_tree` tool. */
export interface UiTreeOptions {
  /** Maximum traversal depth; root is depth 0. Defaults to 30. */
  readonly maxDepth?: number;
  /** Keep only clickable/editable nodes. Defaults to true. */
  readonly interactiveOnly?: boolean;
  /** Case-insensitive substring matched against text and resource id. */
  readonly filter?: string;
}

import { encode } from 'gpt-tokenizer/encoding/o200k_base';

/**
 * Token counts use OpenAI's o200k_base BPE encoding.
 *
 * The MCP clients we target (Claude Code, Cursor, DSH) do not expose one
 * canonical tokenizer, so a stable public BPE vocabulary is used as the
 * measurement proxy. Absolute counts can differ per client model by a small
 * percentage; the budget checks compare against fixed thresholds and the
 * method is documented in docs/mcp-tools.md.
 */
export const TOKENIZER_NAME = 'o200k_base';

export function countTokens(text: string): number {
  return encode(text).length;
}

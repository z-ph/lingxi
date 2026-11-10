/** Deterministic token estimator used for the scripted reference agent. */

const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
const WORD = /[A-Za-z0-9_]/u;

/**
 * Estimate control-side tokens from a text payload.
 *
 * The reference agent does not call a language model, so there is no provider
 * usage to read. Instead we count the context it actually receives (goal +
 * observations + tool calls) with a documented approximation:
 *
 * - CJK code point: 1 token
 * - ASCII word character: 0.25 token
 * - whitespace: 0.1 token
 * - any other code point: 0.5 token
 *
 * This is reproducible and comparable across runs, but it is not a model
 * tokenizer; `ModelAgent` reports real provider usage instead.
 */
export function estimateTokens(text: string): number {
  let units = 0;
  for (const char of text) {
    if (CJK.test(char)) units += 1;
    else if (WORD.test(char)) units += 0.25;
    else if (/\s/u.test(char)) units += 0.1;
    else units += 0.5;
  }
  return Math.ceil(units);
}

export function countTokens(value: unknown): number {
  return estimateTokens(typeof value === 'string' ? value : JSON.stringify(value));
}

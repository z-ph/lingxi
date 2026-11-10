/**
 * Every action returns `{ ok, effect }` on success and
 * `{ ok: false, effect: null, error }` on failure. The failure `code` is part
 * of the MCP tool contract (docs/mcp-tools.md); clients branch on it instead
 * of parsing messages.
 */

export const ACTION_FAILURE_CODES = [
  "invalid_argument",
  "not_found",
  "blocked",
  "needs_confirmation",
  "timeout",
  "permission_denied",
  "no_effect",
] as const;

export type ActionFailureCode = (typeof ACTION_FAILURE_CODES)[number];

export type ActionErrorDetails = Readonly<Record<string, unknown>>;

export interface ActionError {
  readonly code: ActionFailureCode;
  readonly message: string;
  readonly details?: ActionErrorDetails;
}

export interface ActionFailure {
  readonly ok: false;
  /** Failures never leak a partial effect; the error explains what happened. */
  readonly effect: null;
  readonly error: ActionError;
}

export interface ActionSuccess<TEffect> {
  readonly ok: true;
  readonly effect: TEffect;
}

export type ActionResult<TEffect> = ActionSuccess<TEffect> | ActionFailure;

export function actionFailure(
  code: ActionFailureCode,
  message: string,
  details?: ActionErrorDetails,
): ActionFailure {
  if (details === undefined) {
    return { ok: false, effect: null, error: { code, message } };
  }
  return { ok: false, effect: null, error: { code, message, details } };
}

export function actionSuccess<TEffect>(effect: TEffect): ActionSuccess<TEffect> {
  return { ok: true, effect };
}

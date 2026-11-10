/**
 * Declarative success checks.
 *
 * A task's success predicate is a list of conditions over the simulated device
 * state. Keeping it declarative matters: the harness evaluates it on every
 * run, reviewers can read it, and a future real-device adapter can expose the
 * same identifiers.
 */

export interface ConditionLabel {
  /** Human-readable description shown in failure output. */
  label?: string;
}

export type SuccessCondition =
  | (ConditionLabel & { path: string; equals: unknown })
  | (ConditionLabel & { path: string; notEquals: unknown })
  | (ConditionLabel & { path: string; contains: unknown })
  | (ConditionLabel & { path: string; matches: string })
  | (ConditionLabel & { path: string; exists: boolean })
  | (ConditionLabel & { path: string; truthy: boolean })
  | (ConditionLabel & { path: string; minLength: number });

export interface SuccessCriterion {
  description: string;
  conditions: readonly SuccessCondition[];
}

export interface ConditionFailure {
  path: string;
  label: string;
  expected: string;
  actual: string;
}

/** Read a dotted path (`settings.wifi`, `mail.0.read`) from a state object. */
export function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    const key = /^\d+$/u.test(segment) ? Number(segment) : segment;
    current = (current as Record<string | number, unknown>)[key];
    if (current === undefined) return undefined;
  }
  return current;
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function conditionDescription(condition: SuccessCondition): string {
  if ('equals' in condition) return `equals ${format(condition.equals)}`;
  if ('notEquals' in condition) return `not equals ${format(condition.notEquals)}`;
  if ('contains' in condition) return `contains ${format(condition.contains)}`;
  if ('matches' in condition) return `matches /${condition.matches}/`;
  if ('exists' in condition) return condition.exists ? 'exists' : 'does not exist';
  if ('truthy' in condition) return condition.truthy ? 'is truthy' : 'is falsy';
  return `has length >= ${condition.minLength}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function conditionPasses(condition: SuccessCondition, value: unknown): boolean {
  if ('equals' in condition) return deepEqual(value, condition.equals);
  if ('notEquals' in condition) return !deepEqual(value, condition.notEquals);
  if ('contains' in condition) {
    if (typeof value === 'string') return value.includes(String(condition.contains));
    if (Array.isArray(value)) return value.some((item) => deepEqual(item, condition.contains));
    return false;
  }
  if ('matches' in condition) return typeof value === 'string' && new RegExp(condition.matches, 'u').test(value);
  if ('exists' in condition) return (value !== undefined) === condition.exists;
  if ('truthy' in condition) return Boolean(value) === condition.truthy;
  if (typeof value === 'string' || Array.isArray(value)) return value.length >= condition.minLength;
  return false;
}

export interface SuccessEvaluation {
  ok: boolean;
  failures: readonly ConditionFailure[];
}

export function evaluateSuccess(state: unknown, criterion: SuccessCriterion): SuccessEvaluation {
  const failures: ConditionFailure[] = [];
  for (const condition of criterion.conditions) {
    const value = getPath(state, condition.path);
    if (conditionPasses(condition, value)) continue;
    failures.push({
      path: condition.path,
      label: condition.label ?? conditionDescription(condition),
      expected: conditionDescription(condition),
      actual: format(value),
    });
  }
  return { ok: failures.length === 0, failures };
}

/** Used by tests to construct readable assertion messages. */
export function describeFailures(evaluation: SuccessEvaluation): string {
  return evaluation.failures
    .map((failure) => `${failure.path}: expected ${failure.expected}, got ${failure.actual}`)
    .join('; ');
}

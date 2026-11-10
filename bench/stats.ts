/** Contract thresholds from docs/mcp-tools.md. */
export const TOKEN_BUDGET = {
  median: 3_000,
  p95: 8_000,
} as const;

/** Number of apps the issue asks us to measure. */
export const BUDGET_APP_COUNT = 5;

export interface Distribution {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

/**
 * Median and p95 for token counts.
 *
 * p95 uses the nearest-rank definition: the ceil(0.95 * n)-th smallest value.
 * With five apps that is the largest value, which is the conservative reading
 * of the "p95 < 8k" acceptance item.
 */
export function summarize(values: readonly number[]): Distribution {
  if (values.length === 0) {
    throw new Error('cannot summarize an empty list');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const rank = Math.ceil(0.95 * sorted.length);
  const p95 = sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;

  return {
    count: sorted.length,
    min: sorted[0] as number,
    median,
    p95,
    max: sorted[sorted.length - 1] as number,
  };
}

export function withinBudget(summary: Distribution): boolean {
  return summary.median < TOKEN_BUDGET.median && summary.p95 < TOKEN_BUDGET.p95;
}

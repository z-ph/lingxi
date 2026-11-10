/** Small statistics helpers used by the benchmark report. */

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/**
 * Linear-interpolation percentile (`p` in [0, 100]), matching the usual
 * spreadsheet definition. Returns 0 for an empty sample.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower] as number;
  const upperValue = sorted[upper] as number;
  if (lower === upper) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (rank - lower);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface Distribution {
  median: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  n: number;
}

export function distribution(values: readonly number[]): Distribution {
  return {
    median: round(median(values)),
    p95: round(percentile(values, 95)),
    min: values.length === 0 ? 0 : Math.min(...values),
    max: values.length === 0 ? 0 : Math.max(...values),
    mean: round(mean(values)),
    n: values.length,
  };
}

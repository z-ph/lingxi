import { createHash } from "node:crypto";

/** SHA-256 as lowercase hex. Used for token hashes, audit hashes and confirmation digests. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Deterministic JSON with recursively sorted object keys. Hash chains and
 * confirmation digests must not depend on key insertion order.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortForJson(item));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) {
        result[key] = sortForJson(item);
      }
    }
    return result;
  }
  return String(value);
}

/** Truncate a string to at most {@link maxLength} code units, appending an ellipsis when cut. */
export function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength === 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown error";
}

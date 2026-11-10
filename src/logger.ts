/**
 * Structured, redacting logger.
 *
 * The daemon handles pairing codes and bearer tokens. Neither may ever appear
 * in a log line (see docs/security.md, "令牌绝不进服务端日志"). Every value
 * written through this logger is passed through {@link redactString}, so even a
 * token that accidentally ends up in an error message or URL is scrubbed.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Return a logger that adds the given fields to every line. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Receives one already-redacted JSON line per log call. */
  sink?: (line: string) => void;
  now?: () => Date;
  fields?: LogFields;
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TOKEN_PATTERN = /\bpat_[A-Za-z0-9_-]{16,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_QUERY_PATTERN = /([?&](?:token|access_token|pairing_code|code)=)[^&\s"']+/gi;

/** Scrub bearer tokens, `pat_…` tokens and token-bearing query parameters. */
export function redactString(value: string): string {
  return value
    .replace(TOKEN_PATTERN, 'pat_[redacted]')
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(SECRET_QUERY_PATTERN, '$1[redacted]');
}

/** Recursively redact a structured value so it is safe to serialize. */
export function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    return value;
  }
  if (depth > 8) return '[depth-limit]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    };
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactValue(entry, seen, depth + 1);
  }
  return output;
}

function serializeLine(
  level: LogLevel,
  message: string,
  fields: LogFields,
  now: () => Date,
): string {
  const redactedFields = redactValue(fields) as Record<string, unknown>;
  const line: Record<string, unknown> = {
    time: now().toISOString(),
    level,
    msg: redactString(message),
    ...redactedFields,
  };
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({ time: line.time, level, msg: redactString(message), fields: '[unserializable]' });
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const boundFields = options.fields ?? {};

  const write = (entryLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_VALUE[entryLevel] < LEVEL_VALUE[level]) return;
    const merged = { ...boundFields, ...fields };
    sink(serializeLine(entryLevel, message, merged, now));
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ level, sink, now, fields: { ...boundFields, ...fields } }),
  };
}

export interface MemoryLogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

export interface MemoryLogger {
  logger: Logger;
  entries: MemoryLogEntry[];
  lines: string[];
  text(): string;
}

/** In-memory logger used by tests to prove that secrets never reach the sink. */
export function createMemoryLogger(options: { level?: LogLevel; now?: () => Date } = {}): MemoryLogger {
  const entries: MemoryLogEntry[] = [];
  const lines: string[] = [];
  const logger = createLogger({
    level: options.level ?? 'debug',
    now: options.now,
    sink: (line) => {
      lines.push(line);
      const parsed = JSON.parse(line) as { time: string; level: LogLevel; msg: string } & Record<string, unknown>;
      const { time, level, msg, ...fields } = parsed;
      entries.push({ time, level, msg, fields });
    },
  });
  return { logger, entries, lines, text: () => lines.join('\n') };
}

export function levelFromEnv(value: string | undefined): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info';
}

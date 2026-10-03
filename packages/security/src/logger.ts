/**
 * OWASP A09 — Security Logging & Monitoring Failures.
 *
 * Safe logging primitives that strip PII/secrets before emitting. Use these
 * across every service entry point and route handler. Never log raw `error`
 * objects, request bodies, or Authorization headers — they routinely contain
 * tokens, JWTs, and payload secrets.
 *
 * Pairs with audit.ts: `safeLog*` is for operational logging (stdout/Sentry);
 * `emitAuditJournal` is for compliance/append-only audit trail.
 */

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[-_]?key/i,
  /jwt/i,
  /session/i,
  /cookie/i,
  /private[-_]?key/i,
  /access[-_]?key/i,
  /refresh[-_]?token/i,
];

const PII_KEY_PATTERNS = [
  /email/i,
  /phone/i,
  /ssn/i,
  /birthdate|dob|date_of_birth/i,
  /address/i,
  /full[-_]?name|first[-_]?name|last[-_]?name/i,
  /diagnosis/i,
  /medication/i,
];

const PII_VALUE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[email-redacted]' },
  { pattern: /\b\+?\d{9,15}\b/g, replacement: '[phone-redacted]' },
  // JWT shape: 3 base64url segments separated by dots. Real JWTs always start
  // with `eyJ` (JSON header begins with `{`). Even short test fixtures match.
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[jwt-redacted]' },
  { pattern: /\bBearer\s+[\w.-]+/gi, replacement: 'Bearer [redacted]' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: '[api-key-redacted]' },
];

export interface RedactOptions {
  /** Maximum depth of object traversal — defaults to 6 to prevent runaway logs. */
  maxDepth?: number;
  /** Maximum string length per value — defaults to 500 chars. */
  maxStringLength?: number;
}

const DEFAULT_REDACT: Required<RedactOptions> = {
  maxDepth: 6,
  maxStringLength: 500,
};

function redactString(value: string, maxLength: number): string {
  let s = value;
  for (const { pattern, replacement } of PII_VALUE_PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  if (s.length > maxLength) {
    s = `${s.slice(0, maxLength)}…[truncated:${value.length - maxLength}]`;
  }
  return s;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((p) => p.test(key));
}

export function redact(value: unknown, opts: RedactOptions = {}): unknown {
  const { maxDepth, maxStringLength } = { ...DEFAULT_REDACT, ...opts };
  return walk(value, 0, maxDepth, maxStringLength);
}

function walk(value: unknown, depth: number, maxDepth: number, maxStringLength: number): unknown {
  if (depth > maxDepth) return '[max-depth-reached]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value, maxStringLength);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, maxStringLength),
      stack: value.stack ? redactString(value.stack, maxStringLength * 2) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => walk(v, depth + 1, maxDepth, maxStringLength));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = '[redacted]';
      } else if (isPiiKey(k)) {
        out[k] = typeof v === 'string' ? '[pii-redacted]' : walk(v, depth + 1, maxDepth, maxStringLength);
      } else {
        out[k] = walk(v, depth + 1, maxDepth, maxStringLength);
      }
    }
    return out;
  }
  return '[unserializable]';
}

export interface SafeLogEntry {
  level: 'info' | 'warn' | 'error';
  service: string;
  msg: string;
  ctx?: Record<string, unknown>;
  err?: unknown;
}

export type LogSink = (entry: SafeLogEntry) => void;

const stdoutSink: LogSink = (entry) => {
  const payload = {
    ts: new Date().toISOString(),
    level: entry.level,
    service: entry.service,
    msg: entry.msg,
    ...(entry.ctx ? { ctx: redact(entry.ctx) } : {}),
    ...(entry.err !== undefined ? { err: redact(entry.err) } : {}),
  };
  const out = JSON.stringify(payload);
  if (entry.level === 'error') process.stderr.write(`${out}\n`);
  else process.stdout.write(`${out}\n`);
};

let activeSink: LogSink = stdoutSink;

/** Override sink (e.g., for tests or Sentry integration). */
export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

/** Reset to default stdout JSON sink. */
export function resetLogSink(): void {
  activeSink = stdoutSink;
}

function redactCtx(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  return redact(ctx) as Record<string, unknown>;
}

export function createSafeLogger(service: string) {
  return {
    safeInfo(msg: string, ctx?: Record<string, unknown>): void {
      activeSink({ level: 'info', service, msg, ctx: redactCtx(ctx) });
    },
    safeWarn(msg: string, ctx?: Record<string, unknown>): void {
      activeSink({ level: 'warn', service, msg, ctx: redactCtx(ctx) });
    },
    safeError(msg: string, err: unknown, ctx?: Record<string, unknown>): void {
      activeSink({ level: 'error', service, msg, ctx: redactCtx(ctx), err: redact(err) });
    },
  };
}

/** Build a redacted error message safe to surface to clients (no stack, no internals). */
export function publicErrorMessage(err: unknown, fallback = 'Internal error'): string {
  if (err instanceof Error && err.message && !looksLikeInternalLeak(err.message)) {
    return err.message.slice(0, 200);
  }
  return fallback;
}

function looksLikeInternalLeak(msg: string): boolean {
  // Internal-infrastructure terms — if any appears unredacted in an error
  // message, treat as a leak. The list is intentionally minimal and reflects
  // the current orchestrator stack (Fastify + PostgREST + node runtime).
  return (
    /\b(pg|postgres|postgrest|fastify|node_modules)\b/i.test(msg) ||
    /\bENOENT|ECONNREFUSED|ETIMEDOUT\b/.test(msg) ||
    /\bat \w+\.\w+ \(/.test(msg)
  );
}

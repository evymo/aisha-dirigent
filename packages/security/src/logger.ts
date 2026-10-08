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
  // Local part bounded to 64 (RFC 5321): unbounded `[\w.+-]+@` rescans the rest
  // of the input from every word boundary — quadratic on attacker-shaped text
  // (`a.a.a…`: 14 s per 100 kB, now 29 ms; same matches on real addresses).
  { pattern: /\b[\w.+-]{1,64}@[\w-]+\.[\w.-]+\b/g, replacement: '[email-redacted]' },
  { pattern: /\b\+?\d{9,15}\b/g, replacement: '[phone-redacted]' },
  // JWT shape: 3 base64url segments separated by dots. Real JWTs always start
  // with `eyJ` (JSON header begins with `{`). Even short test fixtures match.
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[jwt-redacted]' },
  { pattern: /\bBearer\s+[\w.-]+/gi, replacement: 'Bearer [redacted]' },
  // An Authorization header written out as text (`Authorization: Basic dXN…`,
  // `"authorization":"Digest …"`): the scheme stays, the credential does not.
  {
    pattern: /\b((?:Proxy-)?Authorization)(["']?\s*[:=]\s*["']?)(Basic|Digest|Negotiate|NTLM|Token|ApiKey)\s+[^\s"',;]+/gi,
    replacement: '$1$2$3 [redacted]',
  },
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

// Credentials travel inside URLs too: `https://user:pass@host/…`, `//u:p@h`,
// `…?access_token=…&sig=…`, `#id_token=…` and URL-encoded inside a parameter
// (`redirect_uri=https%3A%2F%2Fu%3Ap%40h`). A logged URL keeps its shape
// (scheme, host, path, harmless params) but never the userinfo or a sensitive
// param value.
//
// Every pattern here is linear: logged strings are attacker-shaped (a 16 kB
// Origin header reaches `cors.deny` unauthenticated). The userinfo match starts
// only at `//` and stops at the next `/ ? #` or whitespace; a parameter name
// cannot contain a separator, so no position rescans the rest of the input.
// Greedy up to the LAST `@` before the path, so a raw `@` in the password does
// not leave its tail behind.
const URL_USERINFO = /(\/\/)[^\s/?#]*@/g;
const URL_USERINFO_ENCODED = /(%2F%2F)(?:[^\s&#%]|%(?!2F)[0-9A-F]{2})*%40/gi;
const URL_QUERY_PARAM = /([?&;#])([^=&#;?\s]+)=([^&#\s]*)/g;
// URL-only names on top of SENSITIVE_KEY_PATTERNS (signed URLs, OAuth code and
// PKCE verifier, short password and one-time-code names).
const SENSITIVE_QUERY_NAME_PATTERNS = [
  /^key$/i,
  /sig/i,
  /credential/i,
  /^code/i,
  /verifier/i,
  /auth/i,
  /pass/i,
  /^pwd$/i,
  /otp/i,
];
// An authority cut by the work window (`https://user:pa`) has no `@` left to
// anchor on; it is dropped rather than shown.
const URL_TAIL_AUTHORITY = /\/\/[^\s/?#]*$/;
// Patterns run on at most maxLength + this many characters: enough for a token
// that straddles the cut to be recognised whole, never enough for any pattern
// to become expensive.
const REDACT_WINDOW_SLACK = 2048;

const PERCENT_ESCAPE = /%([0-9A-Fa-f]{2})/g;
// A parameter name may arrive percent-encoded (`%74oken=` is `token=`), once or
// twice. Decoded byte-wise, never throws; sensitive names are ASCII.
const NAME_DECODE_ROUNDS = 2;

function decodedNames(name: string): string[] {
  const names = [name];
  let current = name;
  for (let i = 0; i < NAME_DECODE_ROUNDS && current.includes('%'); i++) {
    current = current.replace(PERCENT_ESCAPE, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    names.push(current);
  }
  return names;
}

function isSensitiveQueryName(name: string): boolean {
  return decodedNames(name).some(
    (n) => isSensitiveKey(n) || SENSITIVE_QUERY_NAME_PATTERNS.some((p) => p.test(n)),
  );
}

function redactUrlCredentials(value: string): string {
  return value
    .replace(URL_USERINFO, '$1[userinfo-redacted]@')
    .replace(URL_USERINFO_ENCODED, '$1[userinfo-redacted]%40')
    .replace(URL_QUERY_PARAM, (whole: string, sep: string, name: string) =>
      isSensitiveQueryName(name) ? `${sep}${name}=[redacted]` : whole,
    );
}

function redactString(value: string, maxLength: number): string {
  const window = maxLength + REDACT_WINDOW_SLACK;
  let s = value.length > window ? value.slice(0, window).replace(URL_TAIL_AUTHORITY, '//[truncated]') : value;
  // Before the PII patterns: the email pattern would otherwise eat only the
  // `pass@host` part of userinfo and leave the user name behind.
  s = redactUrlCredentials(s);
  for (const { pattern, replacement } of PII_VALUE_PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  if (value.length > maxLength) {
    s = `${s.slice(0, maxLength).replace(URL_TAIL_AUTHORITY, '//[truncated]')}…[truncated:${value.length - maxLength}]`;
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

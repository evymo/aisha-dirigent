/**
 * OWASP A09 — one logger shape for every Fastify / pino logger in the services.
 *
 * `createSafeLogger` covers what a service logs ON PURPOSE. The framework logs
 * on its own too: Fastify writes every request as `{ req }` ("incoming
 * request"), every failure as `{ err }`, and a miss as the message
 * `Route GET:<raw url> not found`. With the stock serializers the raw URL —
 * query string included — goes to stdout, so `/ws?token=<JWT>` put a live
 * session token into the ws-gateway log on every connection.
 *
 * `safeLoggerOptions(options)` is the factory: the same object works as
 * `Fastify({ logger: safeLoggerOptions({...}) })` and as
 * `pino(safeLoggerOptions({...}))` (for a `loggerInstance` or a worker logger).
 * It adds the following, all through `redact` from ./logger.ts (one redaction
 * implementation for the whole package):
 *
 *   - `serializers.req` — Fastify's own request shape, with the URL (path AND
 *     query) redacted. Headers are never part of it, so `authorization` and
 *     `cookie` cannot reach the log through a request.
 *   - `serializers.err` — type, message, stack and the error's own scalar fields,
 *     all redacted; nested objects (an HTTP client's `config` with headers, a
 *     `response` with a body) are dropped, `cause` is followed a few levels.
 *   - `serializers.res` — the status code only (Fastify's shape), also for a
 *     plain pino logger that would otherwise dump a response object.
 *   - `hooks.logMethod` — every argument of every log call: strings (message,
 *     interpolation values) are redacted, the object of `log.info({ … })` is
 *     redacted key by key (sensitive key names, URLs and tokens inside strings,
 *     any depth), an Error under ANY key goes through the err serializer, and a
 *     message pino would copy from an error is redacted too. Keys with their own
 *     serializer (`req`, `res`, `err`, extra ones) are left to it. This covers
 *     `{ ctx: { url } }`, `{ headers: req.headers }`, `{ error: axiosError }`
 *     and Fastify's `Route … not found` line alike.
 *   - `formatters.bindings` — the root bindings (`base`, `name`) are redacted
 *     the same way. Child bindings (`log.child({ … })`) are NOT reachable from
 *     options: pino resets the bindings formatter for every child and writes
 *     child bindings past the hook. The gate therefore treats `.child(` in
 *     services as a finding (no service calls it; Fastify's own `{ reqId }`
 *     child is harmless).
 *   - Extra serializers a caller passes keep working; their OUTPUT goes through
 *     `redact` as well.
 *
 * Fail-closed: options that would silently undo one of those (own `req` / `res`
 * / `err` serializer, own `logMethod` hook or bindings formatter, a renamed
 * error or message key the hook cannot see) are refused with an error at
 * startup, not merged.
 *
 * A gate (`src/tests/gates/sluzby-logger-z-tovarny.gate.test.ts`) holds every
 * `Fastify(` / `pino(` in services/ to this factory.
 */

import type { FastifyLogFn, FastifyServerOptions } from 'fastify';
import { redact } from './logger.js';

type LoggerOptionsObject = Exclude<FastifyServerOptions['logger'], boolean | undefined>;
type LogMethodHook = NonNullable<NonNullable<LoggerOptionsObject['hooks']>['logMethod']>;

/**
 * Longest URL / message kept in a log line — redact's own default, on purpose:
 * every request URL now passes through `redact`, and its cost grows with the
 * work window (this length + redact's slack). Measured 2026-10-05 on a 16 kB
 * attacker-shaped URL: tens of ms per call, so the window stays at the default.
 */
const LOG_TEXT_MAX_LENGTH = 500;
/** Stack traces: twice the text length, as `redact(err)` does for the safe logger. */
const LOG_STACK_MAX_LENGTH = 2 * LOG_TEXT_MAX_LENGTH;
/** How many `cause` links an error serializer follows. */
const ERR_CAUSE_MAX_DEPTH = 3;
/** How many inner errors of an AggregateError are kept. */
const ERR_AGGREGATE_MAX = 10;

/** Option keys the factory owns; a caller setting them would undo the guard. */
const REFUSED_OPTION_KEYS = ['errorKey', 'messageKey'] as const;
const OWNED_SERIALIZERS = ['req', 'res', 'err'] as const;
/** Keys whose value a serializer redacts; the hook leaves them to it. */
const DEFAULT_SERIALIZED_KEYS: ReadonlySet<string> = new Set(OWNED_SERIALIZERS);

function redactText(value: string, maxStringLength: number = LOG_TEXT_MAX_LENGTH): string {
  return String(redact(value, { maxStringLength }));
}

/**
 * A URL as it may appear in a log line: credentials in userinfo, sensitive
 * query / fragment parameters and token-shaped values are redacted; path and
 * harmless parameters stay readable.
 */
export function redactUrlForLog(url: string): string {
  return redactText(url);
}

/**
 * Only the host of a URL — for log lines where the target matters but the path
 * may itself be a secret (webhook URLs carry their key in the path). A value
 * that does not parse is reported as such and never echoed.
 */
export function urlHostForLog(url: string): string {
  if (!URL.canParse(url)) return `[invalid-url length=${url.length}]`;
  return new URL(url).host;
}

/** What the request serializer reads; a Fastify request satisfies it. */
export interface LoggableRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number } | null;
}

// A type alias, not an interface: Fastify's serializer type carries an index
// signature, which only an alias satisfies implicitly.
export type SafeRequestLog = {
  method?: string;
  url?: string;
  version?: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
};

/**
 * Fastify's default request shape (method, url, accept-version, host,
 * remoteAddress, remotePort) with the URL redacted. No headers, ever.
 */
export function safeReqSerializer(req: LoggableRequest): SafeRequestLog {
  const version = req.headers?.['accept-version'];
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactUrlForLog(req.url) : undefined,
    version: typeof version === 'string' ? redactText(version) : undefined,
    host: typeof req.host === 'string' ? redactText(req.host) : undefined,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/** Fastify's response shape: the status code, nothing else. */
export function safeResSerializer(res: { statusCode?: unknown } | null | undefined): { statusCode?: number } {
  const statusCode = res?.statusCode;
  return { statusCode: typeof statusCode === 'number' ? statusCode : undefined };
}

function errorType(err: Error): string {
  const ctorName = (err.constructor as { name?: unknown } | undefined)?.name;
  return typeof ctorName === 'string' && ctorName.length > 0 ? ctorName : err.name;
}

function serializeError(err: unknown, depth: number): unknown {
  if (!(err instanceof Error)) return redact(err);
  const scalars: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(err)) {
    if (key === 'message' || key === 'stack' || key === 'cause' || key === 'errors') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      scalars[key] = value;
    }
  }
  const out: Record<string, unknown> = {
    type: errorType(err),
    message: redactText(err.message),
    stack: typeof err.stack === 'string' ? redactText(err.stack, LOG_STACK_MAX_LENGTH) : undefined,
    ...(redact(scalars, { maxStringLength: LOG_TEXT_MAX_LENGTH }) as Record<string, unknown>),
  };
  // Read structurally: `cause` / `errors` (AggregateError) are newer than the
  // lib level some consumers type-check this file with.
  const { cause, errors } = err as { cause?: unknown; errors?: unknown };
  if (cause !== undefined) {
    out.cause = depth < ERR_CAUSE_MAX_DEPTH ? serializeError(cause, depth + 1) : '[cause-depth-reached]';
  }
  if (Array.isArray(errors)) {
    out.aggregateErrors = errors.slice(0, ERR_AGGREGATE_MAX).map((inner: unknown) => serializeError(inner, depth + 1));
  }
  return out;
}

/**
 * Error serializer: type, message, stack and the error's own scalar fields
 * (code, statusCode, errno, …) through `redact`; nested objects are dropped,
 * `cause` is followed up to a fixed depth. A non-Error value is redacted whole.
 */
export function safeErrSerializer(err: unknown): unknown {
  return serializeError(err, 0);
}

function errorOf(value: unknown): Error | undefined {
  if (value instanceof Error) return value;
  if (value !== null && typeof value === 'object') {
    const candidate = (value as { err?: unknown }).err;
    if (candidate instanceof Error && (value as { msg?: unknown }).msg === undefined) return candidate;
  }
  return undefined;
}

/**
 * A raw Node request / response passed as the log object: pino itself maps it
 * to `{ req }` / `{ res }`, which then go through the serializers.
 */
function isRawHttpMessage(value: object): boolean {
  const v = value as { method?: unknown; headers?: unknown; socket?: unknown; setHeader?: unknown };
  return Boolean(v.method && v.headers && v.socket) || typeof v.setHeader === 'function';
}

/**
 * One log object redacted key by key, so that a sensitive key NAME is judged
 * at every level (`redact` walks the value). Keys with a serializer are left to
 * it; an Error under any other key goes through the err serializer (a plain
 * walk would keep only name / message / stack — the err serializer also keeps
 * `code`, `statusCode`, `cause`).
 */
function redactLogObject(value: object, serializedKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return redact(value);
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (serializedKeys.has(key)) out[key] = inner;
    else if (inner instanceof Error) out[key] = safeErrSerializer(inner);
    else out[key] = (redact({ [key]: inner }) as Record<string, unknown>)[key];
  }
  return out;
}

function redactArgument(arg: unknown, index: number, serializedKeys: ReadonlySet<string>): unknown {
  if (typeof arg === 'string') return redactText(arg);
  if (arg === null || typeof arg !== 'object') return arg;
  if (arg instanceof Error) return index === 0 ? arg : safeErrSerializer(arg);
  if (index === 0) return isRawHttpMessage(arg) ? arg : redactLogObject(arg, serializedKeys);
  // An object among the interpolation values (`%o`, `%j`) is printed whole.
  return redact(arg);
}

/**
 * The arguments of one log call, redacted: strings, the log object key by key,
 * Errors under any key, objects among interpolation values. When the call has
 * no message and pino would take it from an error (`log.error(err)`,
 * `log.error({ err })`), the redacted error message is supplied instead.
 */
export function redactLogArguments(
  args: readonly unknown[],
  serializedKeys: ReadonlySet<string> = DEFAULT_SERIALIZED_KEYS,
): unknown[] {
  const out = args.map((arg, index) => redactArgument(arg, index, serializedKeys));
  if (out.length === 1) {
    const err = errorOf(out[0]);
    if (err) out.push(redactText(err.message));
  }
  return out;
}

function createLogMethod(serializedKeys: ReadonlySet<string>): LogMethodHook {
  return function logMethod(inputArgs, method) {
    method.apply(this, redactLogArguments(inputArgs, serializedKeys) as Parameters<FastifyLogFn>);
  };
}

type Serializer = (value: unknown) => unknown;

/**
 * Logger options for `Fastify({ logger })` and `pino(...)` with the safe
 * serializers and message hook added. Any other option (level, transport,
 * stream, redact paths, extra serializers) passes through unchanged.
 */
export function safeLoggerOptions<T extends LoggerOptionsObject>(options: T): T {
  for (const key of REFUSED_OPTION_KEYS) {
    if (options[key] !== undefined) {
      throw new Error(`safeLoggerOptions: "${key}" is not supported — the message hook reads the default keys`);
    }
  }
  const ownSerializers = options.serializers ?? {};
  for (const key of OWNED_SERIALIZERS) {
    if (ownSerializers[key] !== undefined) {
      throw new Error(`safeLoggerOptions: serializers.${key} is owned by the factory and cannot be replaced`);
    }
  }
  if (options.hooks?.logMethod !== undefined) {
    throw new Error('safeLoggerOptions: hooks.logMethod is owned by the factory and cannot be replaced');
  }
  if (options.formatters?.bindings !== undefined) {
    throw new Error('safeLoggerOptions: formatters.bindings is owned by the factory and cannot be replaced');
  }
  // A caller's extra serializer keeps its key; what it returns is redacted too.
  const extraSerializers: Record<string, Serializer> = {};
  for (const [key, serializer] of Object.entries(ownSerializers)) {
    if (typeof serializer !== 'function') {
      throw new Error(`safeLoggerOptions: serializers.${key} is not a function`);
    }
    extraSerializers[key] = (value: unknown) => redact((serializer as Serializer)(value));
  }
  const serializedKeys: ReadonlySet<string> = new Set([...OWNED_SERIALIZERS, ...Object.keys(extraSerializers)]);
  return {
    ...options,
    serializers: { ...extraSerializers, req: safeReqSerializer, res: safeResSerializer, err: safeErrSerializer },
    hooks: { ...options.hooks, logMethod: createLogMethod(serializedKeys) },
    formatters: {
      ...options.formatters,
      bindings: (bindings: Record<string, unknown>) => redactLogObject(bindings, serializedKeys) as Record<string, unknown>,
    },
  } as T;
}

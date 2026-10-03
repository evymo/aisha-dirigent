/**
 * OWASP A03/A05 — safe error responses & input validation glue.
 *
 * Two responsibilities:
 *
 *   1. `toPublicError(err)` — convert any thrown value into a safe response
 *      body (no stack, no DB internals, no PostgREST internals). Pairs with
 *      logger's `publicErrorMessage` but adds error categorisation.
 *
 *   2. `validateBody(schema, body)` — Zod-aware validation that returns a
 *      typed result or a `ValidationError` with field-level messages safe to
 *      surface to clients. Caller never has to format Zod issues manually.
 *
 * Centralising error shape prevents accidental leaks (e.g., a route handler
 * doing `reply.send({ error: err.message })` exposes internal stack frames
 * or PostgreSQL error codes).
 */

import type { ZodError, ZodSchema } from 'zod';
import { publicErrorMessage } from './logger.js';
import { RATE_LIMITED_CODE } from './rateLimit.js';

export interface PublicError {
  error: string;
  message: string;
  /** Optional per-field validation errors (only for ValidationError). */
  fields?: Array<{ path: string; message: string }>;
}

export class ValidationError extends Error {
  public readonly statusCode = 400;
  public readonly errorCode = 'validation_error';
  constructor(
    public readonly fields: Array<{ path: string; message: string }>,
  ) {
    super('Input validation failed');
    this.name = 'ValidationError';
  }
}

export class NotAuthorizedError extends Error {
  public readonly statusCode = 403;
  public readonly errorCode = 'forbidden';
  constructor(message = 'Not authorized') {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

export class NotFoundError extends Error {
  public readonly statusCode = 404;
  public readonly errorCode = 'not_found';
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  public readonly statusCode = 409;
  public readonly errorCode = 'conflict';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface PublicErrorResult {
  statusCode: number;
  body: PublicError;
}

/** Stabilní veřejné kódy — interní `FST_ERR_*` ven nepatří. */
const VEREJNY_KOD: Record<number, string> = {
  400: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

/**
 * Odmítnutí s kódem 4xx, které vyrobil NÁŠ server — jádro Fastify (validace
 * schématu 400, velké tělo 413, typ obsahu 415: `code` `FST_*`) nebo náš limit
 * dotazů (`code` RATE_LIMITED_CODE) — je ODPOVĚĎ VOLAJÍCÍMU, ne porucha služby.
 * Vrací `null` pro vše ostatní.
 *
 * ⛔ Původ se pozná podle `code`, NE podle samotného `statusCode`: chyby
 * klientů cizích API ho nesou taky (web-push 410/429 od FCM, LlmCompletionError
 * od LLM upstreamu). Propustit je by volajícímu vrátilo cizí 401/429 jako jeho
 * vlastní — „tvé přihlášení selhalo" místo „selhal náš upstream".
 *
 * Proč zvlášť a exportované: naměřeno 2026-09-25 — výchozí obsluha tu větev
 * neměla (16 služeb vracelo na limit i na neplatné tělo 500) a 9 služeb s
 * vlastní obsluhou znalo jen `AuthError`. Vlastní obsluha ji má volat hned
 * po svých typech, aby 4xx nesklopila na 500 — hlavičky, které plugin už
 * nastavil (`retry-after`, `x-ratelimit-*`), tím zůstanou.
 */
export function pluginRejection(err: unknown): PublicErrorResult | null {
  if (typeof err !== 'object' || err === null) return null;
  const { statusCode, message, code } = err as { statusCode?: unknown; message?: unknown; code?: unknown };
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) return null;
  const nasPuvod = typeof code === 'string' && (code.startsWith('FST_') || code === RATE_LIMITED_CODE);
  if (!nasPuvod) return null;
  return {
    statusCode,
    body: {
      error: VEREJNY_KOD[statusCode] ?? 'rejected',
      message: typeof message === 'string' ? publicErrorMessage(new Error(message), 'Request rejected') : 'Request rejected',
    },
  };
}

export function toPublicError(err: unknown): PublicErrorResult {
  if (err instanceof ValidationError) {
    return {
      statusCode: 400,
      body: { error: err.errorCode, message: err.message, fields: err.fields },
    };
  }
  if (err instanceof NotAuthorizedError) {
    return { statusCode: 403, body: { error: err.errorCode, message: err.message } };
  }
  if (err instanceof NotFoundError) {
    return { statusCode: 404, body: { error: err.errorCode, message: err.message } };
  }
  if (err instanceof ConflictError) {
    return { statusCode: 409, body: { error: err.errorCode, message: err.message } };
  }
  const odmitnuti = pluginRejection(err);
  if (odmitnuti) return odmitnuti;
  // Anything else collapses to 500 with a sanitised message.
  return {
    statusCode: 500,
    body: { error: 'internal', message: publicErrorMessage(err) },
  };
}

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ValidationError(zodIssuesToFields(parsed.error));
}

function zodIssuesToFields(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
  }));
}

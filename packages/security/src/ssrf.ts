/**
 * OWASP A10 — Server-Side Request Forgery prevention.
 *
 * Three concentric defences for outbound `fetch` from services:
 *
 *   1. Scheme allowlist — only `https:` by default (plus `http:` for mesh-internal
 *      service-to-service when explicitly enabled).
 *   2. Host allowlist — exact-match hostnames or `*.suffix.example.com` patterns
 *      from the service manifest.
 *   3. IP guard — after DNS resolution, reject loopback / link-local / RFC1918
 *      / RFC6598 / metadata IPs (AWS 169.254.169.254, GCP metadata.google.internal,
 *      Azure 169.254.169.254). This blocks DNS-rebinding and direct-IP bypass.
 *
 * The recommended call site is `safeFetch(url, init)` instead of bare `fetch`.
 * For services that must call external LLM APIs, register the API host in the
 * allowlist (e.g., `api.openai.com,api.anthropic.com`).
 */

import { lookup } from 'node:dns/promises';
import { createSafeLogger } from './logger.js';

export interface SsrfGuardOptions {
  service: string;
  /** Hostname allowlist — exact match or `*.suffix.example.com`. */
  hostAllowlist: string[];
  /** Schemes allowed. Defaults to ['https:']. */
  allowedSchemes?: string[];
  /** When true, permits RFC1918 mesh-internal targets (intra-cluster). */
  allowInternalNetworks?: boolean;
}

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    public reason: 'scheme' | 'host' | 'ip' | 'parse' | 'redirect',
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function hostMatches(host: string, allowlist: string[]): boolean {
  for (const entry of allowlist) {
    if (entry === host) return true;
    if (entry.startsWith('*.') && host.endsWith(entry.slice(1))) return true;
  }
  return false;
}

/**
 * Normalise an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or the hex-tail form
 * `::ffff:7f00:1`) down to its embedded dotted-quad IPv4 string. Returns null
 * when `ip` is not a mapped-v4 address.
 */
function mappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const idx = lower.indexOf('::ffff:');
  if (idx !== 0) return null;
  const tail = lower.slice('::ffff:'.length);
  if (tail.includes('.')) {
    // Dotted-quad form: `::ffff:127.0.0.1`.
    return tail;
  }
  // Hex-tail form: `::ffff:7f00:1` → 0x7f00, 0x0001 → 127.0.0.1.
  const groups = tail.split(':');
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0], 16);
  const lo = Number.parseInt(groups[1], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
    return null;
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isBlockedIp(ip: string, allowInternal: boolean): boolean {
  if (!ip) return true;
  // IPv4-mapped IPv6 (`::ffff:…`) is an IPv4 target in an IPv6 costume — strip
  // the prefix and re-run the IPv4 checks on the embedded dotted-quad.
  const mapped = mappedIpv4(ip);
  if (mapped !== null) return isBlockedIp(mapped, allowInternal);
  // IPv6
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return !allowInternal; // ULA
    return false;
  }
  // IPv4
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 224 || a >= 240) return true; // multicast + reserved
  if (allowInternal) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Statuses fetch treats as redirects (WHATWG "redirect status"). */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The `redirect` modes of RequestInit — anything else is rejected, not coerced. */
const REDIRECT_MODES: ReadonlySet<string> = new Set(['follow', 'manual', 'error']);

/**
 * Request headers that may travel with a redirect to a DIFFERENT origin.
 *
 * An allowlist on purpose, not a denylist of "sensitive" names: callers carry
 * credentials under names nobody can enumerate in advance (`Authorization`,
 * `apikey`, `X-N8N-API-KEY`, `X-Broker-Token`, `Cookie`, a plugin's own
 * `X-Whatever-Token`). A denylist fails open for every name it forgot; this
 * list fails closed — a header not listed here stays with the origin the
 * caller addressed. Only content negotiation and client identification pass.
 */
const CROSS_ORIGIN_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'user-agent',
]);

/** Headers describing the request body — they go when the body goes (WHATWG "request-body-header name"). */
const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
  'content-length',
] as const;

/** One outbound hop as the redirect policy sees it. */
export interface RedirectHop {
  url: URL;
  method: string;
  headers: Headers;
  body: BodyInit | null;
}

/**
 * What to do with a 3xx: follow it with the rewritten request, or hand the
 * 3xx back to the caller unfollowed.
 */
export type RedirectPlan = { kind: 'follow'; next: RedirectHop } | { kind: 'return' };

function isReplayableBody(body: BodyInit | null): boolean {
  if (body === null) return true;
  // A stream is consumed by the first hop; there is nothing left to resend.
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
  return !(typeof body === 'object' && Symbol.asyncIterator in body);
}

/**
 * Redirect policy for `safeFetch` — pure, no I/O, so every branch is testable.
 *
 * Given the hop that produced a redirect status + `Location`, decide the next
 * hop. The SSRF allowlist/IP checks are NOT here: `safeFetch` re-runs `check()`
 * on whatever this returns. This function answers the other question — what
 * of the caller's request may go to the new target:
 *
 *   - https → non-https is refused (`SsrfBlockedError('redirect')`). A caller
 *     that addressed an https URL asked for a confidential, authenticated
 *     channel; a `Location` header must not be able to downgrade it. The URL's
 *     path/query (presigned tokens) would go out in clear text and the response
 *     could be forged on-path. `allowedSchemes` containing `http:` does not
 *     change this: it permits callers to ADDRESS plain-http targets themselves
 *     (mesh-internal), it is not consent to having TLS removed by a server.
 *   - 303, and 301/302 for any method other than GET/HEAD, become GET with no
 *     body and no body headers (WHATWG fetch rewrites 301/302 only for POST;
 *     we rewrite every non-GET/HEAD method, so a body is never re-sent on a
 *     301/302).
 *   - 307/308 keep method and body — but only within the same origin. To a
 *     different origin, a request WITH a body is not followed: the 3xx is
 *     returned to the caller, so the payload never reaches a host the caller
 *     did not name.
 *   - Different origin (scheme + host + port) → only
 *     `CROSS_ORIGIN_HEADER_ALLOWLIST` headers survive. Headers removed once
 *     are never restored, even if a later hop comes back to the first origin.
 *   - A streamed body that would have to be resent cannot be replayed →
 *     refused rather than silently sending an empty body.
 */
export function planRedirect(current: RedirectHop, status: number, location: string): RedirectPlan {
  let target: URL;
  try {
    target = new URL(location, current.url);
  } catch {
    throw new SsrfBlockedError(`Unparseable redirect Location: ${location.slice(0, 80)}`, 'redirect');
  }

  if (current.url.protocol === 'https:' && target.protocol !== 'https:') {
    throw new SsrfBlockedError(
      `Redirect downgrades ${current.url.protocol} to ${target.protocol} — refused`,
      'redirect',
    );
  }

  const isSameOrigin = target.origin === current.url.origin;
  let method = current.method.toUpperCase();
  let body = current.body;
  const headers = new Headers(current.headers);

  const preservesMethod = status === 307 || status === 308;
  const isSafeMethod = method === 'GET' || method === 'HEAD';
  if (!preservesMethod && !isSafeMethod) {
    method = 'GET';
    body = null;
    for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
  } else if (body !== null) {
    // 307/308 (or a GET/HEAD that somehow carries a body) — the body would be resent.
    if (!isSameOrigin) return { kind: 'return' };
    if (!isReplayableBody(body)) {
      throw new SsrfBlockedError('Redirect would resend a streamed request body, which cannot be replayed', 'redirect');
    }
  }

  if (!isSameOrigin) {
    for (const name of [...headers.keys()]) {
      if (!CROSS_ORIGIN_HEADER_ALLOWLIST.has(name)) headers.delete(name);
    }
  }

  return { kind: 'follow', next: { url: target, method, headers, body } };
}

export interface SsrfGuard {
  /** Validate URL string, return resolved IP. Throws `SsrfBlockedError` on failure. */
  check(url: string): Promise<{ url: URL; ip: string }>;
  /**
   * Wrap fetch — performs check() on the initial URL and on every redirect hop.
   *
   * `init.redirect` keeps its fetch meaning, enforced by the guard:
   * `'follow'` (default) follows under `planRedirect`, `'manual'` returns the
   * 3xx unfollowed, `'error'` rejects with `SsrfBlockedError('redirect')`.
   */
  safeFetch(url: string, init?: RequestInit): Promise<Response>;
}

export function createSsrfGuard(opts: SsrfGuardOptions): SsrfGuard {
  const {
    service,
    hostAllowlist,
    allowedSchemes = ['https:'],
    allowInternalNetworks = false,
  } = opts;
  const log = createSafeLogger(`ssrf:${service}`);

  async function check(url: string): Promise<{ url: URL; ip: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // The raw input is attacker-shaped and may carry credentials; the error
      // message reaches callers and their logs, so it never echoes it.
      throw new SsrfBlockedError(`Invalid URL (length ${url.length})`, 'parse');
    }
    if (!allowedSchemes.includes(parsed.protocol)) {
      // Scheme and host are enough to act on; path, query and userinfo are not logged.
      log.safeWarn('ssrf.scheme_blocked', { scheme: parsed.protocol, host: parsed.hostname.toLowerCase() });
      throw new SsrfBlockedError(`Scheme not allowed: ${parsed.protocol}`, 'scheme');
    }
    const host = parsed.hostname.toLowerCase();
    if (!hostMatches(host, hostAllowlist)) {
      log.safeWarn('ssrf.host_blocked', { host });
      throw new SsrfBlockedError(`Host not in allowlist: ${host}`, 'host');
    }
    // Resolve to ensure DNS doesn't point at an internal address (DNS rebinding).
    const { address } = await lookup(host, { verbatim: true });
    if (isBlockedIp(address, allowInternalNetworks)) {
      log.safeWarn('ssrf.ip_blocked', { host, ip: address });
      throw new SsrfBlockedError(`Resolved IP blocked: ${address}`, 'ip');
    }
    return { url: parsed, ip: address };
  }

  async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
    // Never inherit the platform default `redirect: 'follow'` — a 3xx
    // `Location: http://169.254.169.254/…` would otherwise be followed with no
    // fresh SSRF check, bypassing the guard on the second hop. We handle
    // redirects manually and re-run check() on every followed hop (bounded).
    // WHAT of the caller's request travels to the next hop is decided by
    // planRedirect() — credentials and bodies do not follow to another origin.
    const redirectMode = init?.redirect ?? 'follow';
    if (!REDIRECT_MODES.has(redirectMode)) {
      throw new SsrfBlockedError(`Invalid redirect mode: ${String(redirectMode).slice(0, 20)}`, 'redirect');
    }
    const maxHops = 5;
    let current = url;
    // The first hop goes out exactly as the caller built it; later hops carry
    // the request as rewritten by planRedirect().
    let hopInit: RequestInit = { ...init };
    for (let hop = 0; ; hop++) {
      await check(current);
      const res = await fetch(current, {
        ...hopInit,
        // Force manual redirect handling regardless of caller-supplied value,
        // so a caller's `redirect: 'follow'` can't silently defeat the guard.
        redirect: 'manual',
        // Default timeout in case caller didn't set one — outbound calls must
        // never hang the service.
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      });
      if (!REDIRECT_STATUSES.has(res.status)) return res;
      if (redirectMode === 'manual') return res;
      if (redirectMode === 'error') {
        await res.body?.cancel();
        throw new SsrfBlockedError(`Redirect ${res.status} refused (redirect: 'error')`, 'redirect');
      }
      const location = res.headers.get('location');
      if (!location) return res;
      if (hop >= maxHops) {
        await res.body?.cancel();
        throw new SsrfBlockedError(`Too many redirects (>${maxHops})`, 'redirect');
      }
      let plan: RedirectPlan;
      try {
        plan = planRedirect(
          {
            url: new URL(current),
            method: hopInit.method ?? 'GET',
            headers: new Headers(hopInit.headers),
            body: hopInit.body ?? null,
          },
          res.status,
          location,
        );
      } catch (err) {
        await res.body?.cancel();
        if (err instanceof SsrfBlockedError) {
          // Status only: the Location may carry tokens (presigned URLs).
          log.safeWarn('ssrf.redirect_blocked', { status: res.status });
        }
        throw err;
      }
      if (plan.kind === 'return') {
        log.safeWarn('ssrf.redirect_not_followed', {
          status: res.status,
          reason: 'body would be resent to a different origin',
        });
        return res;
      }
      await res.body?.cancel();
      const { next } = plan;
      current = next.url.toString();
      hopInit = { ...hopInit, method: next.method, headers: next.headers, body: next.body };
    }
  }

  return { check, safeFetch };
}

/** Parse `SSRF_HOST_ALLOWLIST=api.openai.com,*.aisha.guru` env into an array. */
export function parseHostAllowlist(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

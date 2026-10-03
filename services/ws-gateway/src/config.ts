import { requireEnv } from '@aisha/security';
/**
 * ws-gateway runtime config.
 *
 * Centralises every process.env read so the service-security gate can
 * verify a clean separation between env IO and runtime logic. Per AISHA
 * convention every service ships a config.ts that exports a frozen
 * `config` constant; server.ts imports from here, never reads env directly.
 */

/**
 * Číselná proměnná, kde PRÁZDNO znamená „nenastaveno", ne „nula".
 *
 * ⛔ `Number('')` NENÍ `NaN`, je to `0` — a `?? default` hlídá jen `undefined`,
 * ne prázdný řetězec. Klíč deklarovaný s prázdnou hodnotou (v `.env` běžný stav)
 * tak dá nulu a výchozí hodnota se nikdy nepoužije. Naměřeno 2026-09-02 na
 * `SPA_OTP_SKEW` ve `svc-knock` (PR #335); táž třída tady.
 *
 * Výslovná `'0'` ZŮSTÁVÁ nulou — nulu napsal člověk a je to úmysl.
 */
export function num(v: string | undefined, d: number): number {
  const t = (v ?? '').trim();
  if (t === '') return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  /** Listen port — used by Fastify server.listen(). */
  port: num(process.env.WS_GATEWAY_PORT, 3002),

  /** Log level for pino. */
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** Redis URL — pub/sub backbone, ws-gateway subscribes to event-worker channels. */
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',

  /** Keycloak base URL and realm for JWKS-pinned JWT verification. */
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'ws-gateway', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'ws-gateway', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUri(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  /** Expected JWT audience claim. */
  jwtAudience: process.env.WS_JWT_AUDIENCE ?? 'aisha-app',

  /** Max topic subscriptions a single socket may hold (GW-01 anti-DoS cap). */
  maxTopics: num(process.env.WS_MAX_TOPICS, 50),

  /** Heartbeat interval (ms) — ping sockets and terminate unresponsive ones. */
  heartbeatIntervalMs: num(process.env.WS_HEARTBEAT_INTERVAL_MS, 30000),

  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A04 — toggle rate limiter in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
} as const;

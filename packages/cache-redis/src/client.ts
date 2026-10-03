/**
 * Shared Redis client for AISHA services.
 *
 * Connects to the `aisha-shared-redis` ACL instance
 * (docker-compose.coolify-shared-redis.yml — Phase 1: a dedicated Redis 7 with
 * per-app ACL users on the shared `coolify` network). DB-index isolation keeps
 * usages separate:
 *
 *   DB 0  — reserved (Langfuse + n8n)
 *   DB 1  — embedding + query cache (WP 2.1)
 *   DB 2  — JWT revocation set (WP 3.5)
 *   DB 3  — IDE-context realtime state (WP 13.4)
 *   DB 4-15  — future
 *
 * CREDENTIAL CONTRACT (unified — Phase 1): the inline-URL form is canonical.
 *   AISHA_SHARED_REDIS_URL = redis://core:${REDIS_PASSWORD_CORE}@aisha-shared-redis:6379
 * The URL's userinfo (`core` + password) is parsed and applied. Username +
 * password resolution precedence (highest first):
 *   1. explicit `options.{username,password}` (testing / per-call override)
 *   2. env  AISHA_SHARED_REDIS_USERNAME / AISHA_SHARED_REDIS_PASSWORD (fallback)
 *   3. URL userinfo (decodeURIComponent'd) — the canonical contract
 * URL-less deployments (no userinfo) + the env fallbacks keep working, so a
 * password-only `redis://:pass@host` or a separate-var setup is still honored.
 *
 *   AISHA_SHARED_REDIS_URL       — redis://[user[:pass]@]host:port (in-cluster default)
 *   AISHA_SHARED_REDIS_USERNAME  — optional ACL username fallback
 *   AISHA_SHARED_REDIS_PASSWORD  — optional password fallback
 *   AISHA_SHARED_REDIS_DISABLED  — `true` short-circuits init (rollback;
 *                                  callers see graceful "Redis unavailable"
 *                                  behavior — caching becomes pass-through,
 *                                  revocation becomes permissive)
 */
import { Redis, type RedisOptions } from 'ioredis';
import { z } from 'zod';

const ConfigSchema = z.object({
  // ⛔ ŽÁDNÝ `.default()` (naměřeno 2026-08-19): dřív tu stálo
  //    `.default('redis://aisha-shared-redis:6379')` — jméno CIZÍ instance jako
  //    tichá výchozí hodnota. Na sdíleném hostiteli to není neexistující jméno,
  //    ale cizí běžící redis; zápis by šel do cizích dat místo hlasitého pádu.
  //    Adresu doručuje compose z `${APP_NAME_PREFIX}-shared-redis`.
  url: z
    .string()
    .url({ message: 'AISHA_SHARED_REDIS_URL chybí nebo není URL — adresa se NEHÁDÁ (výchozí hodnota by ukázala na jinou instanci)' }),
  username: z.string().optional(),
  password: z.string().optional(),
  disabled: z.boolean().default(false),
});

export type RedisClientConfig = z.infer<typeof ConfigSchema>;

export interface CreateClientOptions {
  /** Required: Redis DB index (0-15). See module header for allocation. */
  db: number;
  /** Optional override of env-based config (testing). */
  url?: string;
  username?: string;
  password?: string;
  /** Optional override of disabled flag (testing). */
  disabled?: boolean;
  /** Connection name for `CLIENT LIST` / Redis monitoring (default service name). */
  connectionName?: string;
}

/**
 * Read Redis client config from process.env. Throws Zod error on malformed
 * URL — caller treats as fatal (misconfigured cache = silent prod failure).
 */
export function readRedisConfig(): RedisClientConfig {
  const raw = {
    url: process.env.AISHA_SHARED_REDIS_URL,
    username: process.env.AISHA_SHARED_REDIS_USERNAME,
    password: process.env.AISHA_SHARED_REDIS_PASSWORD,
    disabled: process.env.AISHA_SHARED_REDIS_DISABLED === 'true',
  };
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );
  return ConfigSchema.parse(cleaned);
}

/**
 * Extract username/password from a redis URL's userinfo, URL-decoded.
 * `redis://core:p%40ss@h:6379` → { username: 'core', password: 'p@ss' }.
 * Returns `undefined` for an absent component (NOT empty string), so a
 * password-only URL (`redis://:pass@h`) yields username:undefined and a
 * bare URL (`redis://h:6379`) yields both undefined. Never throws — the
 * caller already parsed/validated the URL via Zod, but a defensive try/catch
 * keeps a surprising URL from taking down client creation.
 */
function userinfoFromUrl(url: string): { username?: string; password?: string } {
  try {
    const u = new URL(url);
    return {
      // URL.username/password are '' when absent; normalize to undefined and
      // decode percent-escapes so reserved chars survive round-trips.
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Build an ioredis client bound to a specific DB index. Each caller gets
 * its own connection — DON'T share clients between unrelated subsystems
 * because they may have different timeout / retry tolerances.
 *
 * When `AISHA_SHARED_REDIS_DISABLED=true`, returns `null` — callers must
 * handle null gracefully (caching: pass-through; revocation: permissive).
 */
export function createNamespacedRedis(
  options: CreateClientOptions,
): Redis | null {
  const config = readRedisConfig();
  if ((options.disabled ?? config.disabled) === true) return null;

  if (options.db < 0 || options.db > 15 || !Number.isInteger(options.db)) {
    throw new Error(`Invalid Redis DB index: ${options.db} (must be int 0-15)`);
  }

  const url = options.url ?? config.url;

  // ioredis URL form: redis://[user[:password]@]host:port/db
  // Build manually to control DB index per call. We parse the URL ourselves
  // (not via `new Redis(url)`) so the DB index is per-call, and we apply the
  // userinfo with explicit precedence: explicit option > env > URL userinfo.
  const parsed = new URL(url);
  const fromUrl = userinfoFromUrl(url);
  const username = options.username ?? config.username ?? fromUrl.username;
  const password = options.password ?? config.password ?? fromUrl.password;

  const ioredisOptions: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    db: options.db,
    // Only set username when present — passing username:undefined is fine for
    // ioredis (it falls back to AUTH <password> / the `default` user), but
    // omitting it keeps password-only (requirepass-style) URLs behaving as
    // before. With an ACL user set, ioredis issues `AUTH <user> <pass>`.
    username,
    password,
    connectionName: options.connectionName,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  };

  return new Redis(ioredisOptions);
}

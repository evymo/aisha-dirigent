/**
 * Unit tests for namespaced Redis client.
 *
 * No live Redis required — we test config parsing + null-disabled path.
 * Live integration tests live in the gateway integration suite (consumer).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readRedisConfig, createNamespacedRedis } from '../client.js';

/**
 * ⛔ ADRESA SE DEKLARUJE, NEHÁDÁ.
 *
 * Testy se dřív spoléhaly na DOSAZENOU výchozí adresu sdíleného Redisu; kód
 * mezitím správně přešel na „bez `AISHA_SHARED_REDIS_URL` to selže". Dosazená
 * hodnota tu byla dvojnásob špatná: nesla CIZÍ jméno instance (`aisha-`),
 * takže fork by mířil do sousedova Redisu.
 *
 * Sada proto adresu deklaruje na JEDNOM místě. Test, který chce ověřit chování
 * BEZ ní, si ji smaže sám — tím je vidět, že je to jeho záměr, ne nedopatření.
 */
const ADRESA_PRO_TESTY = 'redis://redis-v-testu:6379';

describe('readRedisConfig', () => {
  beforeEach(() => {
    delete process.env.AISHA_SHARED_REDIS_USERNAME;
    delete process.env.AISHA_SHARED_REDIS_PASSWORD;
    delete process.env.AISHA_SHARED_REDIS_DISABLED;
    process.env.AISHA_SHARED_REDIS_URL = ADRESA_PRO_TESTY;
  });

  // ⛔ NAMĚŘENO 2026-09-04. Tenhle test čekal DOSAZENOU výchozí adresu
  // (`redis://aisha-shared-redis:6379`) — jenže kód mezitím správně přešel na
  // „adresa se NEHÁDÁ": schéma ji vyžaduje a bez ní vyhodí. Dosazená adresa
  // sdíleného Redisu je přesně ta třída vady, kterou tenhle repozitář
  // opakovaně opravuje: hodnota bez domova, která navíc nese CIZÍ jméno
  // instance (`aisha-`), takže by fork mířil do sousedova Redisu.
  //
  // ⭐ Test se proto obrací: prázdné prostředí musí SELHAT, ne vrátit domněnku.
  it('bez AISHA_SHARED_REDIS_URL SELŽE — adresa se nehádá', () => {
    delete process.env.AISHA_SHARED_REDIS_URL;
    expect(() => readRedisConfig()).toThrow();
  });

  it('honors AISHA_SHARED_REDIS_URL override', () => {
    process.env.AISHA_SHARED_REDIS_URL = 'redis://other-host:6379';
    expect(readRedisConfig().url).toBe('redis://other-host:6379');
  });

  it('reads AISHA_SHARED_REDIS_USERNAME + AISHA_SHARED_REDIS_PASSWORD', () => {
    process.env.AISHA_SHARED_REDIS_USERNAME = 'core';
    process.env.AISHA_SHARED_REDIS_PASSWORD = 'env-pass';
    const cfg = readRedisConfig();
    expect(cfg.username).toBe('core');
    expect(cfg.password).toBe('env-pass');
  });

  it('honors AISHA_SHARED_REDIS_DISABLED=true', () => {
    process.env.AISHA_SHARED_REDIS_DISABLED = 'true';
    expect(readRedisConfig().disabled).toBe(true);
  });

  it('treats any non-true value as not-disabled', () => {
    process.env.AISHA_SHARED_REDIS_DISABLED = 'false';
    expect(readRedisConfig().disabled).toBe(false);
    process.env.AISHA_SHARED_REDIS_DISABLED = '1';
    expect(readRedisConfig().disabled).toBe(false);
  });

  it('throws on malformed URL', () => {
    process.env.AISHA_SHARED_REDIS_URL = 'not-a-url';
    expect(() => readRedisConfig()).toThrow();
  });
});

describe('createNamespacedRedis', () => {
  beforeEach(() => {
    // Pořadí je podstatné: nejdřív uklidit, TEPRVE POTOM deklarovat adresu.
    // Opačně si `delete` sebere právě to, co jsme nastavili.
    delete process.env.AISHA_SHARED_REDIS_USERNAME;
    delete process.env.AISHA_SHARED_REDIS_PASSWORD;
    delete process.env.AISHA_SHARED_REDIS_DISABLED;
    process.env.AISHA_SHARED_REDIS_URL = ADRESA_PRO_TESTY;
  });

  it('returns null when disabled via option', () => {
    expect(createNamespacedRedis({ db: 2, disabled: true })).toBeNull();
  });

  it('returns null when disabled via env', () => {
    process.env.AISHA_SHARED_REDIS_DISABLED = 'true';
    expect(createNamespacedRedis({ db: 2 })).toBeNull();
  });

  it('throws on invalid DB index (< 0)', () => {
    expect(() => createNamespacedRedis({ db: -1 })).toThrow(/Invalid Redis DB index/);
  });

  it('throws on invalid DB index (> 15)', () => {
    expect(() => createNamespacedRedis({ db: 16 })).toThrow(/Invalid Redis DB index/);
  });

  it('throws on non-integer DB index', () => {
    expect(() => createNamespacedRedis({ db: 1.5 })).toThrow(/Invalid Redis DB index/);
  });

  it('returns Redis client for valid DB index when enabled', () => {
    // Use lazyConnect:true (default in our config) so this doesn't actually
    // open a connection in the test environment.
    const client = createNamespacedRedis({
      db: 2,
      url: 'redis://127.0.0.1:6379',
    });
    expect(client).not.toBeNull();
    expect(client?.options.db).toBe(2);
    // Clean up
    void client?.quit().catch(() => undefined);
  });

  it('passes connectionName for Redis CLIENT LIST monitoring', () => {
    const client = createNamespacedRedis({
      db: 3,
      url: 'redis://127.0.0.1:6379',
      connectionName: 'test-conn',
    });
    expect(client?.options.connectionName).toBe('test-conn');
    void client?.quit().catch(() => undefined);
  });

  // ── Phase 1: URL userinfo parsing + credential precedence ──────────────────
  // The unified contract is an inline-URL: redis://core:<pass>@host:6379.
  // lazyConnect:true means none of these open a socket — we inspect the
  // resolved ioredis options directly.

  it('parses username + password from the URL userinfo (the canonical contract)', () => {
    const client = createNamespacedRedis({
      db: 3,
      url: 'redis://core:url-secret@127.0.0.1:6379',
    });
    expect(client?.options.username).toBe('core');
    expect(client?.options.password).toBe('url-secret');
    expect(client?.options.host).toBe('127.0.0.1');
    expect(client?.options.port).toBe(6379);
    void client?.quit().catch(() => undefined);
  });

  it('URL-decodes percent-escaped userinfo (reserved chars survive)', () => {
    // p%40ss%3A1 → "p@ss:1" — proves a password containing URL-reserved chars
    // is decoded (the separate-var path exists precisely for non-base64url
    // passwords; here we prove the URL path is also decode-safe).
    const client = createNamespacedRedis({
      db: 1,
      url: 'redis://core:p%40ss%3A1@127.0.0.1:6379',
    });
    expect(client?.options.username).toBe('core');
    expect(client?.options.password).toBe('p@ss:1');
    void client?.quit().catch(() => undefined);
  });

  it('honors a password-only URL (requirepass form, no username)', () => {
    const client = createNamespacedRedis({
      db: 2,
      url: 'redis://:legacy-requirepass@127.0.0.1:6379',
    });
    // No username resolved → ioredis normalizes the absent username to null
    // (we pass `username: undefined`), so AUTH uses just the password — the
    // pre-Phase-1 requirepass behavior is preserved.
    expect(client?.options.username ?? null).toBeNull();
    expect(client?.options.password).toBe('legacy-requirepass');
    void client?.quit().catch(() => undefined);
  });

  it('separate-var fallback still works (env username/password, bare URL)', () => {
    process.env.AISHA_SHARED_REDIS_USERNAME = 'core';
    process.env.AISHA_SHARED_REDIS_PASSWORD = 'env-secret';
    const client = createNamespacedRedis({
      db: 1,
      url: 'redis://127.0.0.1:6379', // bare URL — no userinfo
    });
    expect(client?.options.username).toBe('core');
    expect(client?.options.password).toBe('env-secret');
    void client?.quit().catch(() => undefined);
  });

  it('env credentials win over URL userinfo (env is the fallback layer above URL)', () => {
    process.env.AISHA_SHARED_REDIS_USERNAME = 'env-user';
    process.env.AISHA_SHARED_REDIS_PASSWORD = 'env-pass';
    const client = createNamespacedRedis({
      db: 1,
      url: 'redis://url-user:url-pass@127.0.0.1:6379',
    });
    expect(client?.options.username).toBe('env-user');
    expect(client?.options.password).toBe('env-pass');
    void client?.quit().catch(() => undefined);
  });

  it('explicit option overrides BOTH env and URL userinfo', () => {
    process.env.AISHA_SHARED_REDIS_USERNAME = 'env-user';
    process.env.AISHA_SHARED_REDIS_PASSWORD = 'env-pass';
    const client = createNamespacedRedis({
      db: 1,
      url: 'redis://url-user:url-pass@127.0.0.1:6379',
      username: 'opt-user',
      password: 'opt-pass',
    });
    expect(client?.options.username).toBe('opt-user');
    expect(client?.options.password).toBe('opt-pass');
    void client?.quit().catch(() => undefined);
  });
});

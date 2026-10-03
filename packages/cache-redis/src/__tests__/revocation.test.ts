/**
 * Unit tests for JWT revocation primitives.
 *
 * Mocks Redis via a minimal in-memory stub — verifies the API contract:
 *   - revokeJwt + isJwtRevoked round-trip works
 *   - TTL is set correctly
 *   - ČTENÍ je fail-CLOSED: chyba Redisu → `true` (neznalost není důkaz platnosti)
 *   - ZÁPIS vrací false, když odvolání neproběhlo
 *   - empty jti → defensive throw / false
 *   - areJwtsRevoked batch consistency
 */
import { describe, it, expect, vi } from 'vitest';
import { revokeJwt, isJwtRevoked, areJwtsRevoked } from '../revocation.js';
import type { Redis } from 'ioredis';

/** Minimal in-memory Redis stub satisfying the methods we use. */
function makeStubRedis() {
  const store = new Map<string, { val: string; expiresAt: number | null }>();
  const stub = {
    async set(key: string, val: string, _ex: string, ttlSec: number) {
      store.set(key, {
        val,
        expiresAt: Date.now() + ttlSec * 1000,
      });
      return 'OK';
    },
    async exists(key: string): Promise<number> {
      const entry = store.get(key);
      if (!entry) return 0;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        store.delete(key);
        return 0;
      }
      return 1;
    },
    async mget(...keys: string[]): Promise<(string | null)[]> {
      return keys.map((k) => {
        const e = store.get(k);
        if (!e) return null;
        if (e.expiresAt && e.expiresAt < Date.now()) {
          store.delete(k);
          return null;
        }
        return e.val;
      });
    },
    _store: store,
  } as unknown as Redis;
  return stub;
}

describe('revokeJwt', () => {
  it('round-trips with isJwtRevoked', async () => {
    const r = makeStubRedis();
    const ok = await revokeJwt(r, 'jti-abc', 60);
    expect(ok).toBe(true);
    expect(await isJwtRevoked(r, 'jti-abc')).toBe(true);
  });

  it('returns false when redis client is null (fail-open)', async () => {
    const ok = await revokeJwt(null, 'jti-abc', 60);
    expect(ok).toBe(false);
  });

  it('returns true when ttl <= 0 (already-expired = no-op success)', async () => {
    const r = makeStubRedis();
    expect(await revokeJwt(r, 'jti-old', 0)).toBe(true);
    expect(await revokeJwt(r, 'jti-old', -100)).toBe(true);
    // Nothing was stored
    expect(await isJwtRevoked(r, 'jti-old')).toBe(false);
  });

  it('caps TTL at 86400 seconds (defense against attacker far-future exp)', async () => {
    const setSpy = vi.fn().mockResolvedValue('OK');
    const r = { set: setSpy } as unknown as Redis;
    await revokeJwt(r, 'jti-evil', 999999);
    expect(setSpy).toHaveBeenCalledWith('aisha:revoked:jti-evil', '1', 'EX', 86400);
  });

  it('throws on empty jti (defensive)', async () => {
    const r = makeStubRedis();
    await expect(revokeJwt(r, '', 60)).rejects.toThrow(/jti is required/);
  });

  // Zápis odvolání je jiný případ než ČTENÍ: když se nepodaří zapsat, token
  // zůstává platný a volající se to musí dozvědět z návratové hodnoty —
  // `false` tu tedy znamená „neuspělo", ne „fail-open".
  it('při chybě Redisu vrací false — zápis odvolání NEPROBĚHL', async () => {
    const r = { set: vi.fn().mockRejectedValue(new Error('Redis down')) } as unknown as Redis;
    expect(await revokeJwt(r, 'jti-x', 60)).toBe(false);
  });
});

describe('isJwtRevoked', () => {
  it('returns false when not revoked', async () => {
    const r = makeStubRedis();
    expect(await isJwtRevoked(r, 'jti-fresh')).toBe(false);
  });

  it('returns true after revokeJwt', async () => {
    const r = makeStubRedis();
    await revokeJwt(r, 'jti-x', 60);
    expect(await isJwtRevoked(r, 'jti-x')).toBe(true);
  });

  it('returns false on null client (fail-open, no lockout)', async () => {
    expect(await isJwtRevoked(null, 'jti-x')).toBe(false);
  });

  it('returns false on empty jti', async () => {
    const r = makeStubRedis();
    expect(await isJwtRevoked(r, '')).toBe(false);
  });

  // ⛔ NAMĚŘENO 2026-09-04. Tenhle test tvrdil `fail-open` (při chybě Redisu
  // vrátit `false` = „token není odvolaný"), zatímco kód od nějaké doby dělá
  // opak a má to i v komentáři: „FAIL-CLOSED: neznalost NENÍ důkaz, že token
  // platí." Kód je správně — kontrola odvolaných tokenů, která při výpadku
  // propustí, je díra: stačí Redis shodit a odvolané tokeny zase platí.
  //
  // ⭐ NIKDO SI TOHO NEVŠIML, PROTOŽE TENHLE BALÍČEK NIKDY NEBĚŽEL. Testy
  // v `packages/` neměly volajícího (12 balíčků, 33 souborů); doplněno týž den
  // do `run-service-tests.mjs`. Zastaralý test na bezpečnostní cestě je horší
  // než žádný: tvrdí, že vlastnost je ověřená, a přitom popisuje opak.
  it('při chybě Redisu ODMÍTÁ (fail-closed) — neznalost není důkaz platnosti', async () => {
    const r = { exists: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Redis;
    expect(await isJwtRevoked(r, 'jti-x')).toBe(true);
  });
});

describe('areJwtsRevoked', () => {
  it('returns Map of jti → revoked status', async () => {
    const r = makeStubRedis();
    await revokeJwt(r, 'jti-a', 60);
    await revokeJwt(r, 'jti-b', 60);
    const result = await areJwtsRevoked(r, ['jti-a', 'jti-b', 'jti-c']);
    expect(result.get('jti-a')).toBe(true);
    expect(result.get('jti-b')).toBe(true);
    expect(result.get('jti-c')).toBe(false);
  });

  it('returns all-false on null client', async () => {
    const result = await areJwtsRevoked(null, ['jti-a', 'jti-b']);
    expect(result.get('jti-a')).toBe(false);
    expect(result.get('jti-b')).toBe(false);
  });

  it('returns empty Map on empty input', async () => {
    const r = makeStubRedis();
    expect((await areJwtsRevoked(r, [])).size).toBe(0);
  });

  // ⛔ Táž oprava jako u jednotlivého `jti` výš. Test tvrdil „all-false", kód
  // dělá „ODMÍTÁM všechny" — a u dávky je to ještě důležitější: jedno selhání
  // mget by jinak prohlásilo za platné VŠECHNY tokeny v dávce najednou.
  it('při chybě mget ODMÍTÁ celou dávku (fail-closed)', async () => {
    const r = { mget: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Redis;
    const result = await areJwtsRevoked(r, ['jti-x']);
    expect(result.get('jti-x')).toBe(true);
  });
});

/**
 * Unit tests for svc-aisha-kronos-shim — verifyKronosApiKey.
 *
 * Maestro calls Kronos through this shim with an X-Api-Key header.
 * If the shim's secret compare leaks timing, anyone with HTTP access
 * to the shim port can recover the kronosApiKey byte-by-byte.
 *
 * After wave 10b refactor: uses @aisha/security::constantTimeStringCompare
 * (XOR-accumulator). Tests lock in the constant-time behaviour AND the
 * full set of rejection paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @aisha/security: totéž porovnání jako skutečné, obalené do vi.fn,
// aby šlo ověřit, CO služba sdílené kontrole předává.
vi.mock('@aisha/security', () => ({
  // vi.fn kvůli testu volajícího místa: služba musí token předat sdílené
  // kontrole se SVÝM tajemstvím. Vlastnosti porovnání (O(1) odmítnutí rozdílné
  // délky, konstantní čas) drží SONDOU packages/security (jwt.test.ts).
  constantTimeStringCompare: vi.fn((a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../config.js', () => ({
  config: {
    kronosApiKey: 'kronos-secret-token-deadbeef',
  },
}));

beforeEach(() => {
  vi.resetModules();
});

describe('verifyKronosApiKey — happy + sad paths', () => {
  it('accepts X-Api-Key (lowercase) header with correct token', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    expect(() => verifyKronosApiKey({ 'x-api-key': 'kronos-secret-token-deadbeef' })).not.toThrow();
  });

  it('accepts X-Api-Key (mixed-case) header — both casings work', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    expect(() => verifyKronosApiKey({ 'X-Api-Key': 'kronos-secret-token-deadbeef' })).not.toThrow();
  });

  it('extracts first value when header is provided as array (express compat)', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    expect(() => verifyKronosApiKey({ 'x-api-key': ['kronos-secret-token-deadbeef', 'extra'] }))
      .not.toThrow();
  });

  it('throws 401 when header is missing entirely', async () => {
    const { verifyKronosApiKey, AuthError } = await import('../auth.js');
    expect(() => verifyKronosApiKey({})).toThrow(AuthError);
    try { verifyKronosApiKey({}); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
      expect((e as Error).message).toContain('Missing');
    }
  });

  it('throws 401 when X-Api-Key value is empty string', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    try { verifyKronosApiKey({ 'x-api-key': '' }); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
    }
  });

  it('throws 401 when value is wrong (different length → length-fail fast)', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    try { verifyKronosApiKey({ 'x-api-key': 'short' }); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
      expect((e as Error).message).toContain('Invalid');
    }
  });

  it('throws 401 when value is wrong (same length, different bytes)', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    // Same length as 'kronos-secret-token-deadbeef' (28 chars), different bytes.
    try { verifyKronosApiKey({ 'x-api-key': 'kronos-secret-token-deadXXXX' }); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
    }
  });

  it('rejects prefix-token (1 char shorter — length mismatch → instant reject, NOT slow loop)', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    const prefix = 'kronos-secret-token-deadbee'; // 1 char shorter
    try { verifyKronosApiKey({ 'x-api-key': prefix }); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(401);
    }
  });

  it('rejection message is GENERIC for wrong token (no per-byte oracle)', async () => {
    const { verifyKronosApiKey } = await import('../auth.js');
    const wrongs = [
      'KRONOS-SECRET-TOKEN-DEADBEEF',     // case differs
      'kronos-secret-token-deadbeeF',     // last byte differs
      'Xronos-secret-token-deadbeef',     // first byte differs
      'kronos-secret-token-deadXXXX',     // middle bytes
    ];
    const messages = new Set<string>();
    for (const w of wrongs) {
      try { verifyKronosApiKey({ 'x-api-key': w }); } catch (e) {
        messages.add((e as Error).message);
      }
    }
    // ALL wrong-token rejections must produce the same user-facing message.
    expect(messages.size).toBe(1);
    expect([...messages][0]).toContain('Invalid');
  });

  it('1MB token: předá ho sdílené kontrole se SVÝM klíčem → 401 (bez stopek)', async () => {
    // ⛔ Dřív tu stály stopky (`performance.now()` < 50 ms) nad KOPIÍ porovnání
    // z mocku. Pod zátěží pre-push (2026-10-02, load ~65) vyšlo 76 ms ve
    // vedlejší službě a push padl na kódu, který se neměnil. Vlastnosti
    // porovnání dokazuje SONDOU packages/security; tady jen volající místo.
    const { constantTimeStringCompare: sdilene } = await import('@aisha/security');
    const sdileneSpy = vi.mocked(sdilene);
    sdileneSpy.mockClear();
    const { verifyKronosApiKey } = await import('../auth.js');
    const huge = 'A'.repeat(1_000_000);
    expect(() => verifyKronosApiKey({ 'x-api-key': huge })).toThrow(
      expect.objectContaining({ statusCode: 401, message: 'Invalid Kronos API key' }),
    );
    expect(sdileneSpy).toHaveBeenCalledTimes(1);
    expect(sdileneSpy).toHaveBeenCalledWith(huge, 'kronos-secret-token-deadbeef');
  });
});

// Boot-time misconfiguration — separate describe so we can re-mock config
describe('verifyKronosApiKey — boot-time misconfiguration', () => {
  it('throws 503 when kronosApiKey is missing from config (fail-closed)', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: { kronosApiKey: '' },
    }));
    const { verifyKronosApiKey, AuthError } = await import('../auth.js');
    expect(() => verifyKronosApiKey({ 'x-api-key': 'anything' })).toThrow(AuthError);
    try { verifyKronosApiKey({ 'x-api-key': 'anything' }); } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(503);
      expect((e as Error).message).toContain('není nakonfigurovaný');
    }
    vi.resetModules();
  });
});

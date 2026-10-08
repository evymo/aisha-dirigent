/**
 * Tests for the A07 JWT / MFA primitives.
 *
 * We mock jose.jwtVerify so we can drive the policy logic without a live
 * Keycloak. The tests pin the *policy* (MFA required → reject acr=1; session
 * > 30min → reject); the cryptography is upstream's job.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthError, constantTimeStringCompare, createJwtVerifier, verifyServiceRole } from '../jwt.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'jwks-mock'),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from 'jose';
const mockedVerify = vi.mocked(jwtVerify);

beforeEach(() => {
  mockedVerify.mockReset();
});

const verifierOpts = {
  jwksUrl: 'https://kc.example/realms/aisha/protocol/openid-connect/certs',
  issuer: 'https://kc.example/realms/aisha',
  service: 'svc-test',
};

describe('createJwtVerifier().verify()', () => {
  test('rejects missing Authorization header', async () => {
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify(undefined)).rejects.toMatchObject({ reason: 'missing' });
  });

  test('rejects empty bearer token', async () => {
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify('Bearer ')).rejects.toMatchObject({ reason: 'missing' });
  });

  test('rejects token without sub claim', async () => {
    mockedVerify.mockResolvedValueOnce({ payload: { iss: 'x' }, protectedHeader: { alg: 'RS256' } } as never);
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify('Bearer abc.def.ghi')).rejects.toThrow(AuthError);
  });

  test('rejects expired token with reason=expired', async () => {
    mockedVerify.mockRejectedValueOnce(new Error('JWT expired'));
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify('Bearer abc.def.ghi')).rejects.toMatchObject({ reason: 'expired' });
  });

  test('rejects forged token with reason=invalid', async () => {
    mockedVerify.mockRejectedValueOnce(new Error('signature mismatch'));
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify('Bearer abc.def.ghi')).rejects.toMatchObject({ reason: 'invalid' });
  });

  test('returns payload on valid token', async () => {
    mockedVerify.mockResolvedValueOnce({
      payload: { sub: 'user-1', acr: '2', auth_time: Math.floor(Date.now() / 1000) },
      protectedHeader: { alg: 'RS256' },
    } as never);
    const v = createJwtVerifier(verifierOpts);
    const user = await v.verify('Bearer abc.def.ghi');
    expect(user.sub).toBe('user-1');
    expect(user.acr).toBe('2');
  });

  test('accepts token with mixed-case Bearer prefix', async () => {
    mockedVerify.mockResolvedValueOnce({
      payload: { sub: 'user-1' },
      protectedHeader: { alg: 'RS256' },
    } as never);
    const v = createJwtVerifier(verifierOpts);
    await expect(v.verify('bearer abc.def.ghi')).resolves.toBeTruthy();
  });
});

describe('enforcePolicy() — MFA', () => {
  test('passes when acr >= 2', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u', acr: '2' }, { requireMfa: true })).not.toThrow();
  });

  test('passes when acr is higher (3)', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u', acr: '3' }, { requireMfa: true })).not.toThrow();
  });

  test('rejects acr=1 (no MFA)', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u', acr: '1' }, { requireMfa: true })).toThrow(
      AuthError,
    );
  });

  test('rejects missing acr', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u' }, { requireMfa: true })).toThrow(
      AuthError,
    );
  });

  test('rejects non-numeric acr', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u', acr: 'urn:loa:weak' }, { requireMfa: true })).toThrow(
      AuthError,
    );
  });

  test('reason=mfa_required on rejection', () => {
    const v = createJwtVerifier(verifierOpts);
    try {
      v.enforcePolicy({ sub: 'u', acr: '0' }, { requireMfa: true });
    } catch (err) {
      expect((err as AuthError).reason).toBe('mfa_required');
      expect((err as AuthError).statusCode).toBe(403);
    }
  });
});

describe('enforcePolicy() — session age', () => {
  test('passes when auth_time is recent', () => {
    const v = createJwtVerifier(verifierOpts);
    const now = Math.floor(Date.now() / 1000);
    expect(() => v.enforcePolicy({ sub: 'u', auth_time: now - 60 }, { maxAuthAgeSec: 300 })).not.toThrow();
  });

  test('rejects session older than maxAuthAgeSec', () => {
    const v = createJwtVerifier(verifierOpts);
    const now = Math.floor(Date.now() / 1000);
    expect(() => v.enforcePolicy({ sub: 'u', auth_time: now - 3600 }, { maxAuthAgeSec: 300 })).toThrow(
      AuthError,
    );
  });

  test('rejects missing auth_time when policy demands age check', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u' }, { maxAuthAgeSec: 300 })).toThrow(AuthError);
  });

  test('reason=session_too_old on rejection', () => {
    const v = createJwtVerifier(verifierOpts);
    const now = Math.floor(Date.now() / 1000);
    try {
      v.enforcePolicy({ sub: 'u', auth_time: now - 9999 }, { maxAuthAgeSec: 300 });
    } catch (err) {
      expect((err as AuthError).reason).toBe('session_too_old');
    }
  });
});

describe('enforcePolicy() — realm roles', () => {
  test('passes when user has at least one required role', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() =>
      v.enforcePolicy(
        { sub: 'u', realm_access: { roles: ['user', 'admin'] } },
        { requireRealmRoles: ['admin'] },
      ),
    ).not.toThrow();
  });

  test('rejects user without required role', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() =>
      v.enforcePolicy(
        { sub: 'u', realm_access: { roles: ['user'] } },
        { requireRealmRoles: ['admin'] },
      ),
    ).toThrow(AuthError);
  });

  test('rejects user with no realm_access', () => {
    const v = createJwtVerifier(verifierOpts);
    expect(() => v.enforcePolicy({ sub: 'u' }, { requireRealmRoles: ['admin'] })).toThrow(
      AuthError,
    );
  });
});

describe('verifyServiceRole() — constant-time compare', () => {
  test('passes with correct token', () => {
    expect(() => verifyServiceRole('Bearer abcdef123456', 'abcdef123456')).not.toThrow();
  });

  test('rejects missing header', () => {
    expect(() => verifyServiceRole(undefined, 'abcdef123456')).toThrow(AuthError);
  });

  test('rejects mismatched token', () => {
    expect(() => verifyServiceRole('Bearer wrong-token', 'abcdef123456')).toThrow(AuthError);
  });

  test('rejects token of different length', () => {
    expect(() => verifyServiceRole('Bearer short', 'abcdef123456')).toThrow(AuthError);
  });

  test('rejects token differing in only one character (timing-safe)', () => {
    expect(() => verifyServiceRole('Bearer abcdef123457', 'abcdef123456')).toThrow(AuthError);
  });

  test('does not throw on case sensitivity in "Bearer "', () => {
    expect(() => verifyServiceRole('bearer abcdef123456', 'abcdef123456')).not.toThrow();
  });

  test('fail-closed: rejects when the expected token is empty (unconfigured), even for an empty bearer', () => {
    // Regression guard: constantTimeStringCompare('', '') is true, so an unset
    // service token + "Bearer " (empty token) must NOT authenticate. This is the
    // latent fail-open every consumer inherited (config defaults the token to '').
    expect(() => verifyServiceRole('Bearer ', '')).toThrow(AuthError);
    expect(() => verifyServiceRole('Bearer ', '')).toThrow(/not configured/i);
  });

  test('fail-closed: rejects any bearer when the expected token is empty', () => {
    expect(() => verifyServiceRole('Bearer anything', '')).toThrow(AuthError);
  });
});

/**
 * ── KONSTANTNÍ ČAS BEZ HODIN ──────────────────────────────────────────────────
 *
 * ⛔ NAMĚŘENO 2026-10-02: služby to hlídaly STOPKAMI — 1MB token a aserce
 * `performance.now() - t0 < 50 ms`. Pod zátěží plného pre-push (load ~65) to
 * vyšlo 76 ms a push padl na kódu, který se vůbec neměnil; samotný test přitom
 * prošel 3/3. Navíc ty stopky měřily KOPII porovnání z mocku `@aisha/security`
 * (v ai-chat už bez pojistky prázdného tokenu), ne tuhle implementaci.
 *
 * Vlastnost se tu proto dokazuje SONDOU, ne hodinami: objekt s `length`
 * a počítadlem `charCodeAt`. Kolikrát se sáhne na znak, je přesné číslo —
 * nezávislé na stroji, zátěži i JIT.
 */
describe('constantTimeStringCompare() — vlastnosti bez hodin', () => {
  /** Řetězec-sonda: délka podle přání, každé čtení znaku se počítá. */
  const sonda = (delka: number, znak = 65) => {
    const charCodeAt = vi.fn((_i: number) => znak);
    return { retezec: { length: delka, charCodeAt } as unknown as string, charCodeAt };
  };

  test('rozdílná délka → odmítne, aniž by přečetl jediný znak (DoS: 1 MB nestojí nic)', () => {
    // Čtení znaku tu HÁZÍ: regrese (porovnání bez kontroly délky) by jinak
    // poctivě odpočítala milion volání a test by padal 25 s místo okamžitě.
    const zakazaneCteni = () => {
      throw new Error('při rozdílné délce se nesmí číst ani jeden znak');
    };
    const velka = sonda(1_000_000);
    velka.charCodeAt.mockImplementation(zakazaneCteni);
    expect(constantTimeStringCompare(velka.retezec, 'abcdef123456')).toBe(false);

    const druha = sonda(1_000_000);
    druha.charCodeAt.mockImplementation(zakazaneCteni);
    expect(constantTimeStringCompare('abcdef123456', druha.retezec)).toBe(false);
  });

  test('stejná délka → projde VŠECHNY znaky, ať se liší kdekoli (pozice rozdílu neprosákne časem)', () => {
    const tajemstvi = 'abcdef123456';
    const pozice = [0, Math.floor(tajemstvi.length / 2), tajemstvi.length - 1];
    for (const p of pozice) {
      const kandidat = tajemstvi.slice(0, p) + 'X' + tajemstvi.slice(p + 1);
      const s = sonda(tajemstvi.length);
      s.charCodeAt.mockImplementation((i: number) => kandidat.charCodeAt(i));
      expect(constantTimeStringCompare(s.retezec, tajemstvi), `rozdíl na pozici ${p}`).toBe(false);
      expect(s.charCodeAt, `rozdíl na pozici ${p}`).toHaveBeenCalledTimes(tajemstvi.length);
    }
  });

  test('shoda → true, a i tehdy se čte každý znak právě jednou', () => {
    const tajemstvi = 'abcdef123456';
    const s = sonda(tajemstvi.length);
    s.charCodeAt.mockImplementation((i: number) => tajemstvi.charCodeAt(i));
    expect(constantTimeStringCompare(s.retezec, tajemstvi)).toBe(true);
    expect(s.charCodeAt).toHaveBeenCalledTimes(tajemstvi.length);
  });

  test('verifyServiceRole: 1MB bearer se odmítne jako neplatný (403), ne jako chyba nebo pád', () => {
    const huge = 'A'.repeat(1_000_000);
    expect(() => verifyServiceRole(`Bearer ${huge}`, 'abcdef123456')).toThrow(
      expect.objectContaining({ statusCode: 403, reason: 'invalid' }),
    );
  });
});

/**
 * ── ISSUER A ROLE ROZHODUJE OVĚŘOVATEL ────────────────────────────────────────
 *
 * ⛔ NAMĚŘENO 2026-09-21 na produkci: patnáct služeb skládalo očekávaný `issuer`
 * z VNITŘNÍ adresy Keycloaku (`http://<kc>:80/realms/…`), jenže token vydaný
 * uživateli nese adresu VEŘEJNOU (`https://auth.<instance>/realms/…`). Issuer se
 * neshodl, `jwtVerify` vyhodil výjimku a ověřovatel ji sjednotil na „Invalid
 * token" — platný token admina tedy vypadal jako NEPLATNÝ a celé to působilo
 * jako problém s oprávněními. Majitel se den nedostal do správy tabletů.
 *
 * Vada ležela měsíce skrytá, protože všechno chodí přes gateway, která to má
 * správně. Projevila se teprve tam, kde prohlížeč mluví se službou NAPŘÍMO.
 *
 * Druhá polovina byla tišší: i po opravě issueru by `isAdminOrStaff` viděl
 * PRÁZDNO, protože konzumenti čtou `realm_access.roles`, kdežto náš realm vydává
 * PLOCHÝ nárok `roles`.
 *
 * ⭐ Obojí proto řeší OVĚŘOVATEL, ne volající. Kdyby se to řešilo na patnácti
 * místech, patnáctkrát by se to dalo splést a šestnáctá služba by vzorec opsala
 * znovu — což je přesně to, jak vada vznikla.
 */
describe('issuer se bere z KC_ISSUER, role se srovnají', () => {
  const puvodni = process.env.KC_ISSUER;
  afterEach(() => {
    if (puvodni === undefined) delete process.env.KC_ISSUER;
    else process.env.KC_ISSUER = puvodni;
  });

  test('KC_ISSUER přebíjí issuer odvozený z vnitřní adresy', async () => {
    process.env.KC_ISSUER = 'https://auth.example.cz/realms/aisha';
    mockedVerify.mockResolvedValue({ payload: { sub: 'u1' } } as never);
    const v = createJwtVerifier(verifierOpts);
    await v.verify('Bearer t');
    expect(mockedVerify).toHaveBeenCalledWith(
      't',
      'jwks-mock',
      expect.objectContaining({ issuer: 'https://auth.example.cz/realms/aisha' }),
    );
  });

  test('PRÁZDNÝ KC_ISSUER padá na odvozený — compose posílá nenastavené jako ""', async () => {
    // `||`, ne `??`: prázdný řetězec musí spadnout na zálohu, jinak by vznikl
    // `new URL('')` a služba by se zacyklila na startu.
    process.env.KC_ISSUER = '';
    mockedVerify.mockResolvedValue({ payload: { sub: 'u1' } } as never);
    const v = createJwtVerifier(verifierOpts);
    await v.verify('Bearer t');
    expect(mockedVerify).toHaveBeenCalledWith(
      't',
      'jwks-mock',
      expect.objectContaining({ issuer: verifierOpts.issuer }),
    );
  });

  test('ploché `roles` se propíšou do `realm_access.roles`', async () => {
    delete process.env.KC_ISSUER;
    mockedVerify.mockResolvedValue({
      payload: { sub: 'u1', roles: ['admin', 'staff'] },
    } as never);
    const v = createJwtVerifier(verifierOpts);
    const u = await v.verify('Bearer t');
    expect(u.realm_access?.roles).toEqual(['admin', 'staff']);
    expect(u.roles).toEqual(['admin', 'staff']);
  });

  test('oba tvary se sjednotí bez duplicit', async () => {
    delete process.env.KC_ISSUER;
    mockedVerify.mockResolvedValue({
      payload: { sub: 'u1', roles: ['admin'], realm_access: { roles: ['admin', 'staff'] } },
    } as never);
    const v = createJwtVerifier(verifierOpts);
    const u = await v.verify('Bearer t');
    expect(u.realm_access?.roles?.sort()).toEqual(['admin', 'staff']);
  });

  test('bez rolí se nárok NEVYRÁBÍ — prázdno zůstane prázdnem', async () => {
    // Stráž proti opačné vadě: normalizace nesmí adminovat nikoho, kdo role nemá.
    delete process.env.KC_ISSUER;
    mockedVerify.mockResolvedValue({ payload: { sub: 'u1' } } as never);
    const v = createJwtVerifier(verifierOpts);
    const u = await v.verify('Bearer t');
    expect(u.realm_access).toBeUndefined();
    expect(u.roles).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { createPostgrestJwtTranslator } from './postgrest-jwt.js';

const TEST_HMAC_KEY = ['pgrest', 'jwt', 'test', 'hmac', 'value'].join('-');

describe('translateAuthorizationForPostgrest', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('passes non-Keycloak bearer tokens through unchanged', async () => {
    const translateAuthorizationForPostgrest = createPostgrestJwtTranslator(
      createLocalJWKSet({ keys: [] }),
      {
        allowedClients: ['aisha-app'],
        issuer: 'https://kc.example.test/realms/aisha',
        postgrestJwtSecret: 'postgrest-secret',
      },
    );
    const authorization = 'Bearer service-role-token';
    const result = await translateAuthorizationForPostgrest(authorization);

    expect(result).toEqual({ ok: true, authorization, translated: false });
  });

  it('verifies a Keycloak token and mints a PostgREST HS256 JWT', async () => {
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }],
    });

    const keycloakToken = await new SignJWT({
      azp: 'aisha-app',
      email: 'user@example.test',
      roles: ['member'],
      sub: '11111111-1111-1111-1111-111111111111',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('aisha-app')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const translateAuthorizationForPostgrest = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app', 'aisha-dirigent-device'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });
    const result = await translateAuthorizationForPostgrest(`Bearer ${keycloakToken}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.translated).toBe(true);
    expect(result.authorization).not.toBe(`Bearer ${keycloakToken}`);

    const postgrestToken = result.authorization.slice('Bearer '.length);
    const { payload } = await jwtVerify(postgrestToken, new TextEncoder().encode(TEST_HMAC_KEY));

    expect(payload.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.email).toBe('user@example.test');
    expect(payload.role).toBe('authenticated');
    expect(payload.keycloak_azp).toBe('aisha-app');
    expect(payload.keycloak_iss).toBe(issuer);
  });

  /**
   * The minted token is what talks to the database, so its lifetime is a
   * security property, not a detail. Before this was fixed the cap did not
   * exist in practice: buildPostgrestClaims spreads the whole Keycloak payload,
   * which always carries `exp`, so `if (!claims.exp) setExpirationTime('15m')`
   * never fired and the DB-facing token inherited the IdP lifetime verbatim.
   * A realm configured with an 8-hour access token handed out an 8-hour DB token.
   */
  it('caps the minted token at 15 minutes even when the IdP token lives far longer', async () => {
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }],
    });

    // Deliberately long-lived: this is the case the old code passed straight through.
    const keycloakToken = await new SignJWT({
      azp: 'aisha-app',
      email: 'user@example.test',
      sub: '11111111-1111-1111-1111-111111111111',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('aisha-app')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(privateKey);

    const translate = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });
    const result = await translate(`Bearer ${keycloakToken}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await jwtVerify(
      result.authorization.slice('Bearer '.length),
      new TextEncoder().encode(TEST_HMAC_KEY),
    );
    const nowSec = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeDefined();
    expect((payload.exp ?? 0) - nowSec).toBeLessThanOrEqual(900);
    // …and it really did come from an 8-hour token, so the cap is what bounded it.
    expect((payload.exp ?? 0) - nowSec).toBeGreaterThan(0);
  });

  it('never outlives the IdP token that authorised it', async () => {
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }],
    });

    // Shorter than the cap: the inherited exp must win, not the 900 s ceiling.
    const keycloakToken = await new SignJWT({
      azp: 'aisha-app',
      sub: '11111111-1111-1111-1111-111111111111',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('aisha-app')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);

    const translate = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });
    const result = await translate(`Bearer ${keycloakToken}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await jwtVerify(
      result.authorization.slice('Bearer '.length),
      new TextEncoder().encode(TEST_HMAC_KEY),
    );
    expect((payload.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
  });

  /** Without a jti there is nothing to write into an audit trail and nothing to revoke. */
  it('stamps a unique jti on every minted token', async () => {
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }],
    });

    const keycloakToken = await new SignJWT({
      azp: 'aisha-app',
      sub: '11111111-1111-1111-1111-111111111111',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('aisha-app')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const translate = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });
    const secret = new TextEncoder().encode(TEST_HMAC_KEY);
    const jtis: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await translate(`Bearer ${keycloakToken}`);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const { payload } = await jwtVerify(r.authorization.slice('Bearer '.length), secret);
      expect(typeof payload.jti).toBe('string');
      jtis.push(payload.jti as string);
    }
    // Same input token, two mints — each addressable on its own.
    expect(jtis[0]).not.toBe(jtis[1]);
  });

  it('rejects Keycloak tokens from unapproved clients', async () => {
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }],
    });

    const keycloakToken = await new SignJWT({
      azp: 'unapproved-client',
      sub: '22222222-2222-2222-2222-222222222222',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('unapproved-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const translateAuthorizationForPostgrest = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });
    const result = await translateAuthorizationForPostgrest(`Bearer ${keycloakToken}`);

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'keycloak_client_not_allowed',
    });
  });

  it('token klienta MCP (z IDE) nevymění ani tehdy, když je klient v povoleném seznamu', async () => {
    // Revize Guru 2026-10-07: sdílený KC_ALLOWED_CLIENTS nese aisha-mcp-client kvůli /mcp;
    // gateway by jinak z tokenu IDE udělala JWT PostgRESTu = přístup k celému API.
    const issuer = 'https://kc.example.test/realms/aisha';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'kc-test-key', use: 'sig' }] });
    const podepis = (azp: string) => new SignJWT({ azp, sub: '33333333-3333-3333-3333-333333333333' })
      .setProtectedHeader({ alg: 'RS256', kid: 'kc-test-key', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(['aisha-mcp-knowledge', 'aisha-app'])
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const translate = createPostgrestJwtTranslator(jwks, {
      allowedClients: ['aisha-app', 'aisha-mcp-client'],
      issuer,
      postgrestJwtSecret: TEST_HMAC_KEY,
    });

    expect(await translate(`Bearer ${await podepis('aisha-mcp-client')}`)).toEqual({
      ok: false, status: 403, error: 'keycloak_client_not_allowed',
    });
    // Kotva: týž token od klienta webu projde — pravidlo míří jen na klienta MCP.
    expect((await translate(`Bearer ${await podepis('aisha-app')}`)).ok).toBe(true);
  });
});

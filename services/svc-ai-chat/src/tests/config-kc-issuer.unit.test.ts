import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The property under test is NOT "the config has two keys" — it is that the
 * expected token issuer can differ from the URL the service fetches keys from.
 *
 * Behind an edge those two are never the same string: the browser is redirected
 * to the public IdP hostname (which lands in `iss`), while the service can only
 * reach Keycloak on an internal alias. A verifier that derives both from one
 * `KEYCLOAK_URL` therefore rejects every browser token — observed in production as
 * `unexpected "iss" claim value` on 21/21 calls to /chat over 72 h.
 *
 * So the gate pins independence and the no-env default, not the spelling.
 */

const ENV_KEYS = ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KC_ISSUER', 'KC_JWKS_URL'] as const;

async function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  // ⛔ 2026-08-24: KEYCLOAK_URL a KEYCLOAK_REALM se staly POVINNÝMI (dřív se
  // dosazovaly `keycloak:8080` a `aisha`). Test si prostředí vyprazdňuje, takže
  // musí deklarovat základ — jinak neměří rozdělení issuer/JWKS, ale chybějící
  // vstup. Přepisy z `env` základ přebijí.
  Object.assign(process.env, {
    KEYCLOAK_URL: 'http://test-keycloak.invalid:8080',
    KEYCLOAK_REALM: 'testrealm',
  });
  Object.assign(process.env, env);
  vi.resetModules();
  return (await import('../config.js')).config;
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
});

describe('svc-ai-chat Keycloak issuer/JWKS split', () => {
  it('accepts a public issuer while keys stay on the internal URL', async () => {
    const config = await loadConfig({
      KEYCLOAK_URL: 'http://aisha-keycloak:80',
      KEYCLOAK_REALM: 'aisha',
      KC_ISSUER: 'https://auth.backend.example.com/realms/aisha',
    });

    expect(config.kcIssuer).toBe('https://auth.backend.example.com/realms/aisha');
    // Keys must NOT follow the issuer out to the public edge.
    expect(config.kcJwksUrl).toBe(
      'http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs',
    );
    // The whole point: the two are allowed to disagree.
    expect(config.kcJwksUrl.startsWith(config.kcIssuer)).toBe(false);
  });

  it('lets the JWKS endpoint be overridden on its own', async () => {
    const config = await loadConfig({
      KEYCLOAK_URL: 'http://aisha-keycloak:80',
      KC_JWKS_URL: 'http://keys.internal/jwks.json',
    });

    expect(config.kcJwksUrl).toBe('http://keys.internal/jwks.json');
  });

  it('derives both from KEYCLOAK_URL when neither override is set', async () => {
    // Backwards compatibility: an unset env must reproduce the old behaviour,
    // so deploying this change without touching env is a no-op.
    const config = await loadConfig({
      KEYCLOAK_URL: 'http://keycloak:8080',
      KEYCLOAK_REALM: 'aisha',
    });

    expect(config.kcIssuer).toBe('http://keycloak:8080/realms/aisha');
    expect(config.kcJwksUrl).toBe(
      'http://keycloak:8080/realms/aisha/protocol/openid-connect/certs',
    );
  });
});

/**
 * config.test.ts — loadConfig() environment variable validation
 *
 * Critical: broker depends on env vars (12-factor app). Missing required
 * vars must fail loudly at startup, never silently default to insecure
 * values. Test the requiredEnv() guard.
 */

import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../config.js';

// Mandatory env vars per config.ts loadConfig().
// SOURCE_SERVICE_EMAIL/PASSWORD are deliberately NOT here: the federation
// contract issues member JWTs via onboarding + sourceJwt(authHandshake) only,
// so service-level credentials are optional (SourceAuthManager login is dormant).
const requiredEnvVars = [
  // ⛔ 2026-08-24: POSTGREST_URL / KEYCLOAK_URL / KEYCLOAK_REALM se přesunuly
  // z „volitelné s výchozí hodnotou" mezi POVINNÉ. Dosazované `postgrest:3000`
  // a `keycloak:8080` nenesou prefix instance — na sdíleném hostiteli trefí
  // cizí kontejner. Kontrakt se změnil, takže se mění i tenhle test.
  'POSTGREST_URL',
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
  'POSTGREST_SERVICE_TOKEN',
  'POSTGRES_URL',
  'SOURCE_API_URL',
  'SOURCE_PG_URL',
  'SOURCE_WEBHOOK_HMAC_SECRET',
  // Klient webu instance — stráž běžného uživatele na něj připíná aud/azp; bez výchozí hodnoty.
  'OIDC_APP_CLIENT_ID',
  // Klíč trezoru relací (ADR-004): platformní tajemství, povinné bez ohledu na dráhu.
  'FEDERATION_VAULT_KEY',
] as const;

function setRequiredEnv(): void {
  process.env.POSTGREST_URL = 'http://test-postgrest.invalid:3000';
  process.env.KEYCLOAK_URL = 'http://test-keycloak.invalid:8080';
  process.env.KEYCLOAK_REALM = 'testrealm';
  process.env.POSTGREST_SERVICE_TOKEN = 'pgrst-token';
  process.env.POSTGRES_URL = 'postgres://localhost/aisha';
  process.env.SOURCE_API_URL = 'https://source-api.example';
  process.env.SOURCE_SERVICE_EMAIL = 'service@source';
  process.env.SOURCE_SERVICE_PASSWORD = 'pw';
  process.env.SOURCE_PG_URL = 'postgres://readonly@localhost/source';
  process.env.SOURCE_WEBHOOK_HMAC_SECRET = 'webhook-secret';
  process.env.OIDC_APP_CLIENT_ID = 'web-instance';
  process.env.FEDERATION_VAULT_KEY = randomBytes(32).toString('hex');
}

function clearAllEnv(): void {
  for (const key of requiredEnvVars) {
    delete process.env[key];
  }
  delete process.env.SOURCE_SERVICE_EMAIL;
  delete process.env.SOURCE_SERVICE_PASSWORD;
  delete process.env.SOURCE_AUTH_HANDSHAKE_OUT;
  delete process.env.SOURCE_AUTH_HANDSHAKE_IN;
  delete process.env.SOURCE_JWT_CACHE_TTL_MS;
  delete process.env.SOURCE_SYNC_INTERVAL_MS;
  delete process.env.PORT;
  delete process.env.LOCAL_INGEST_DROP_DIR;
  delete process.env.FEDERATION_VAULT_KEY_ID;
}

describe('loadConfig()', () => {
  beforeEach(() => {
    clearAllEnv();
  });

  it('loads all required env vars and provides defaults for optional ones', () => {
    setRequiredEnv();
    const config = loadConfig();

    expect(config.postgrestServiceToken).toBe('pgrst-token');
    expect(config.sourceApiUrl).toBe('https://source-api.example');
    expect(config.sourcePgUrl).toBe('postgres://readonly@localhost/source');
    expect(config.webhookHmacSecret).toBe('webhook-secret');
    // Deklarovaný klient webu instance, žádný literál (dřív `KEYCLOAK_BROKER_AUDIENCE ?? 'aisha-app'`).
    expect(config.oidcAppClientId).toBe('web-instance');

    // Defaults
    // ⛔ Tohle tvrdilo VÝCHOZÍ hodnotu `http://postgrest:3000`, tedy přesně to
    // dosazení, které nenese prefix instance. Teď se tvrdí, že se vrací
    // hodnota DEKLAROVANÁ v prostředí — a že se žádná nevymýšlí.
    expect(config.postgrestUrl).toBe('http://test-postgrest.invalid:3000');
    expect(config.keycloakUrl).toBe('http://test-keycloak.invalid:8080');
    expect(config.keycloakRealm).toBe('testrealm');
    // No source-specific default committed — operator supplies per source.
    expect(config.sourceAuthHandshakeOutgoing).toBe('');
    expect(config.sourceAuthHandshakeIncoming).toBe('');
    // Service credentials are optional (dormant SourceAuthManager login).
    expect(config.sourceServiceEmail).toBe('service@source');
    expect(config.sourceServicePassword).toBe('pw');
    expect(config.jwtCacheTtlMs).toBe(3_600_000);
    expect(config.port).toBe(8090);
  });

  it.each(requiredEnvVars)(
    'throws clear error when required %s is missing',
    (varName) => {
      setRequiredEnv();
      delete process.env[varName];
      expect(() => loadConfig()).toThrow(new RegExp(varName));
    }
  );

  it('defaults optional service credentials to empty strings when unset', () => {
    setRequiredEnv();
    delete process.env.SOURCE_SERVICE_EMAIL;
    delete process.env.SOURCE_SERVICE_PASSWORD;
    const config = loadConfig();
    expect(config.sourceServiceEmail).toBe('');
    expect(config.sourceServicePassword).toBe('');
  });

  it('respects custom PORT override', () => {
    setRequiredEnv();
    process.env.PORT = '9090';
    expect(loadConfig().port).toBe(9090);
  });

  it('respects custom authHandshake overrides (for testing environments)', () => {
    setRequiredEnv();
    process.env.SOURCE_AUTH_HANDSHAKE_OUT = 'CUSTOM_OUT';
    process.env.SOURCE_AUTH_HANDSHAKE_IN = 'CUSTOM_IN';
    const config = loadConfig();
    expect(config.sourceAuthHandshakeOutgoing).toBe('CUSTOM_OUT');
    expect(config.sourceAuthHandshakeIncoming).toBe('CUSTOM_IN');
  });

  it('parses syncIntervalMs as number (not string)', () => {
    setRequiredEnv();
    process.env.SOURCE_SYNC_INTERVAL_MS = '600000';
    expect(loadConfig().syncIntervalMs).toBe(600_000);
  });

  describe('FEDERATION_VAULT_KEY (ADR-004): start odmítne prázdný i špatně tvarovaný klíč', () => {
    // Compose klíč záměrně nevynucuje `${…:?}` (zapekl by ho do buildu); jedinou pojistkou
    // na KAŽDÉ instanci je tedy start brokeru.
    it.each([
      ['prázdný', ''],
      ['jen mezery', '   '],
      ['krátký (16 B)', 'ab'.repeat(16)],
      ['64 znaků, ne hex', 'zz'.repeat(32)],
      ['base64 místo hex', randomBytes(32).toString('base64')],
    ])('%s → start spadne a hláška řekne, odkud se klíč doručuje', (_popis, hodnota) => {
      setRequiredEnv();
      process.env.FEDERATION_VAULT_KEY = hodnota;
      let chyba = '';
      try {
        loadConfig();
      } catch (e) {
        chyba = e instanceof Error ? e.message : String(e);
      }
      expect(chyba).toMatch(/FEDERATION_VAULT_KEY/);
      expect(chyba).toMatch(/generate-secrets\.mjs/);
      expect(chyba).toMatch(/coolify-sync-envs\.sh/);
      if (hodnota.trim()) expect(chyba).not.toContain(hodnota.trim());
    });

    it('povinný i na dráze jen s drop adresářem (platformní tajemství, ne tajemství dráhy)', () => {
      setRequiredEnv();
      delete process.env.SOURCE_API_URL;
      delete process.env.SOURCE_PG_URL;
      process.env.LOCAL_INGEST_DROP_DIR = '/data/ingest-drop';
      delete process.env.FEDERATION_VAULT_KEY;
      expect(() => loadConfig()).toThrow(/FEDERATION_VAULT_KEY/);
    });

    it('platný klíč projde a konfigurace ho nese (kontrola měřidla)', () => {
      setRequiredEnv();
      const k = loadConfig().federationVaultKey;
      expect(k?.klic.length).toBe(32);
      expect(k?.keyId).toBe('k1');
    });
  });
});

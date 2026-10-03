/**
 * Start brokeru bez platného klíče trezoru relací SPADNE (ADR-004).
 *
 * Compose klíč nevynucuje `${FEDERATION_VAULT_KEY:?}` — ta pojistka by ho zapekla do
 * build-time množiny. Read-back sync-envs hlídá doručení jen na instanci, která ho pouští.
 * Pojistkou pro KAŽDOU instanci (i fork bez našeho sync-envs) je tedy start procesu:
 * měří se skutečný `server.ts`, ne jen `loadConfig`, protože jde o to, jestli proces
 * skončí dřív, než přijme první požadavek.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SLUZBA = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Povinné proměnné kromě klíče; adresy míří do `.invalid`, nic skutečného se netrefí. */
const ZAKLAD: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  OTEL_SDK_DISABLED: 'true',
  LOG_LEVEL: 'warn',
  PORT: '0',
  POSTGREST_URL: 'http://postgrest.invalid:3000',
  POSTGREST_SERVICE_TOKEN: 'pgrst-token',
  POSTGRES_URL: 'postgres://nikdo@db.invalid:5432/aisha',
  KEYCLOAK_URL: 'http://keycloak.invalid:8080',
  KEYCLOAK_REALM: 'testrealm',
  SOURCE_API_URL: 'https://source.invalid',
  SOURCE_PG_URL: 'postgres://readonly@source.invalid/source',
  SOURCE_WEBHOOK_HMAC_SECRET: 'webhook-secret',
  // Povinný od stráže běžného uživatele (PR B1). Bez něj by start padal na klientovi
  // webu, ne na klíči — kontrola měřidla níž by prošla naprázdno.
  OIDC_APP_CLIENT_ID: 'web-instance',
};

function start(klic: string | undefined, timeoutMs: number) {
  const env = { ...ZAKLAD, ...(klic === undefined ? {} : { FEDERATION_VAULT_KEY: klic }) };
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: SLUZBA,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return { status: r.status, signal: r.signal, stderr: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

describe('start brokeru a klíč trezoru relací', () => {
  it.each([
    ['bez klíče', undefined],
    ['prázdný klíč', ''],
    ['krátký klíč', 'ab'.repeat(16)],
    ['64 znaků, ne hex', 'zz'.repeat(32)],
  ])('%s → proces skončí s exit ≠ 0 a hláška jmenuje klíč i cestu doručení', (_popis, klic) => {
    const r = start(klic, 60_000);
    expect(r.signal, `proces nedoběhl sám (${r.signal}) — start klíč neodmítl:\n${r.stderr}`).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/svc-source-broker failed to start/);
    expect(r.stderr).toMatch(/FEDERATION_VAULT_KEY/);
    expect(r.stderr).toMatch(/coolify-sync-envs\.sh/);
    if (klic) expect(r.stderr).not.toContain(klic);
  }, 90_000);

  it('platný klíč start NEzastaví na klíči (kontrola měřidla)', () => {
    // Proces pak jde dál (klienti, naslouchání) — po limitu ho ukončíme. Měří se jen to,
    // že případný pád nemá příčinu v klíči.
    const r = start(randomBytes(32).toString('hex'), 15_000);
    expect(r.stderr).not.toMatch(/FEDERATION_VAULT_KEY/);
  }, 60_000);
});

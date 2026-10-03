#!/usr/bin/env node
/**
 * Doručení bootstrap JWKS pro pki-bridge — jedna „potřebná neznámá" navíc,
 * generovaná a udržovaná skriptem místo dosazovaná.
 *
 * CO DĚLÁ: stáhne VEŘEJNÉ podpisové klíče realmu z veřejné tváře Keycloaku
 * (dosažitelné z operátorského stroje — ten je mimo mesh z definice), ověří,
 * že je to skutečný JWKS dokument, a doručí ho jako PKI_BOOTSTRAP_JWKS:
 *   1. upsert do .env.coolify (trvalý domov doručených hodnot),
 *   2. PATCH env pki appky přes Coolify API,
 *   3. restart pki appky, aby si bridge klíče přečetl.
 *
 * PROČ: multi-node bootstrap má cyklus „ověření tokenu potřebuje JWKS → cesta
 * ke KC potřebuje mesh → mesh potřebuje cert z /v1/issue → /v1/issue potřebuje
 * ověřený token". Doručené klíče ho rozsekávají BEZ druhé kotvy důvěry: jsou
 * to klíče TÉHOŽ issuera, ověřované týmž iss+aud — liší se jen transport
 * (pipeline místo sítě). Živá cesta zůstává primární; runk se použije, jen
 * když nefunguje, a hlásí se to (viz svc-pki-bridge/src/auth.ts).
 *
 * KDY BĚŽÍ: z aisha-cold-start.sh po wave 3 (KC brána prošla → klíče existují
 * a jsou čerstvé), a kdykoli ručně. Idempotentní: stejné klíče = žádný PATCH.
 *
 * Spousti se pres: node scripts/pki-bootstrap-jwks-sync.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

function die(msg) {
  console.error(`[pki-jwks-sync] FATAL: ${msg}`);
  process.exit(1);
}
function info(msg) {
  console.log(`[pki-jwks-sync] ${msg}`);
}

// ── Vstupy: všechno doručené, nic dosazeného ─────────────────────────────────
const envFile = resolve(ROOT, '.env.coolify');
const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const envOf = (key) => {
  const fromProcess = (process.env[key] ?? '').trim();
  if (fromProcess) return fromProcess;
  const m = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
};

const kcPublicDomain = envOf('KEYCLOAK_DOMAIN_PUBLIC');
const realm = envOf('KEYCLOAK_REALM');
const appPrefix = envOf('APP_NAME_PREFIX');
const coolifyUrl = envOf('COOLIFY_URL') || envOf('COOLIFY_BASE_URL');
const coolifyToken = envOf('COOLIFY_API_TOKEN');
for (const [name, value] of [
  ['KEYCLOAK_DOMAIN_PUBLIC', kcPublicDomain],
  ['KEYCLOAK_REALM', realm],
  ['APP_NAME_PREFIX', appPrefix],
]) {
  if (!value) die(`${name} není doručeno (env ani .env.coolify) — bez něj nelze klíče stáhnout ani zacílit appku`);
}

// ── 1) Stáhnout a OVĚŘIT klíče ───────────────────────────────────────────────
const jwksUrl = `https://${kcPublicDomain}/realms/${realm}/protocol/openid-connect/certs`;
info(`fetching ${jwksUrl}`);
const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(20_000) }).catch((e) => die(`fetch selhal: ${e.message}`));
if (!res.ok) die(`JWKS endpoint vrátil HTTP ${res.status} — Keycloak neběží, nebo doména není routovaná`);
const jwks = await res.json().catch(() => die('odpověď není JSON'));
if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) {
  die('odpověď nemá keys[] — tohle není JWKS dokument, NEDORUČUJI');
}
const payload = JSON.stringify(jwks);
info(`JWKS ok: ${jwks.keys.length} klíčů (kids: ${jwks.keys.map((k) => k.kid).join(', ')})`);

// ── 2) Upsert do .env.coolify ────────────────────────────────────────────────
const line = `PKI_BOOTSTRAP_JWKS='${payload.replaceAll("'", `'\\''`)}'`;
const already = envText.match(/^PKI_BOOTSTRAP_JWKS=.*$/m)?.[0] === line;
if (already) {
  info('.env.coolify: beze změny (tytéž klíče)');
} else if (DRY) {
  info('.env.coolify: DRY — zapsal bych upsert');
} else {
  const next = envText.match(/^PKI_BOOTSTRAP_JWKS=/m)
    ? envText.replace(/^PKI_BOOTSTRAP_JWKS=.*$/m, line)
    : envText.replace(/\n*$/, '\n') + line + '\n';
  writeFileSync(envFile, next);
  info('.env.coolify: upsert PKI_BOOTSTRAP_JWKS');
}

// ── 3) Canonical bulk sync + redeploy pki (jen když je Coolify dosažitelné) ─
if (!coolifyUrl || !coolifyToken) {
  info('COOLIFY_URL/API_TOKEN nedoručeny — přeskočen bulk sync+redeploy (lokální/offline běh); env sync to doručí později');
  process.exit(0);
}
const appName = `${appPrefix}-pki`;
// Never reimplement Coolify env mutation here. coolify-sync-envs.sh owns the
// project-scoped application lookup, /envs/bulk contract and the mandatory
// production+preview pair. This avoids both ambiguous global name lookup and
// the obsolete single-key endpoint that returns 422 on current Coolify.
const syncScript = resolve(ROOT, 'scripts/coolify-sync-envs.sh');
const sync = spawnSync('bash', [syncScript, 'pki'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ENV_FILE: envFile,
    APP_NAME_PREFIX: appPrefix,
    COOLIFY_URL: coolifyUrl,
    COOLIFY_API_TOKEN: coolifyToken,
    KEYS: 'PKI_BOOTSTRAP_JWKS',
    NORMALIZE_BUILDTIME: '0',
    SKIP_ENV_PREFLIGHT: '1',
    REDEPLOY: DRY ? '0' : '1',
    DRY_RUN: DRY ? '1' : '0',
  },
});
if (sync.error) die(`canonical env sync nelze spustit: ${sync.error.message}`);
if (sync.status !== 0) die(`canonical env sync pro ${appName} selhal (exit ${sync.status ?? 'signal'})`);
info(DRY
  ? `DRY — canonical bulk sync ověřil cíl ${appName}`
  : `${appName}: production+preview env doručen přes bulk endpoint a redeploy zařazen`);

#!/usr/bin/env node
/**
 * Sync aisha-app redirect URIs required by AISHA web + VS Code extension PKCE.
 *
 * Reads Keycloak admin credentials from env or .env.coolify, updates only the
 * aisha-app public client, and never prints secret values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const DRY_RUN = process.argv.includes('--dry-run');
const ENV_COOLIFY = resolve(ROOT, '.env.coolify');
const KC_URL = process.env.KEYCLOAK_URL;
if (!KC_URL) {
  console.error('ERROR: KEYCLOAK_URL not set');
  process.exit(1);
}
const KC_REALM = process.env.KEYCLOAK_REALM ?? 'aisha';
const KC_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'aisha-app';
const LOCAL_AUTH_CALLBACK = process.env.AISHA_KC_LOCAL_AUTH_CALLBACK ?? 'http://127.0.0.1:3001/auth/v1/callback';
const LOCALHOST_AUTH_CALLBACK = process.env.AISHA_KC_LOCALHOST_AUTH_CALLBACK ?? 'http://localhost:3001/auth/v1/callback';
const LOCAL_DEV_WEB_CALLBACK = process.env.AISHA_KC_LOCAL_DEV_WEB_CALLBACK ?? 'http://localhost:5173/auth/callback';
const LOCAL_PREVIEW_CALLBACK = process.env.AISHA_KC_LOCAL_PREVIEW_CALLBACK ?? 'http://127.0.0.1:4173/auth/callback';
const LOCALHOST_PREVIEW_CALLBACK = process.env.AISHA_KC_LOCALHOST_PREVIEW_CALLBACK ?? 'http://localhost:4173/auth/callback';

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const envFile = readEnvFile(ENV_COOLIFY);

// Public + internal TLDs drive the redirect-URI host structure. Required —
// no hardcoded hostnames. Internal server segment (e.g. "backend") configurable.
const PUBLIC_TLD = process.env.PUBLIC_TLD ?? envFile.PUBLIC_TLD;
const INTERNAL_TLD = process.env.INTERNAL_TLD ?? envFile.INTERNAL_TLD;
const INTERNAL_SERVER = process.env.INTERNAL_SERVER ?? envFile.INTERNAL_SERVER ?? 'backend';
if (!PUBLIC_TLD) {
  console.error('ERROR: PUBLIC_TLD not set');
  process.exit(1);
}
if (!INTERNAL_TLD) {
  console.error('ERROR: INTERNAL_TLD not set');
  process.exit(1);
}

/**
 * OBSLUHOVANÉ DOMÉNY → redirect URI. Odvozeno, ne vyjmenováno.
 *
 * ⛔ NAMĚŘENO 2026-09-01. Množina se stavěla JEN z generických vzorů
 * (`web.${PUBLIC_TLD}`, `api.${PUBLIC_TLD}`). Instance, která obsluhuje jiné
 * hostnames — a to dělá každá multi-brand — je do realmu nedostala vůbec:
 * brandové hostname z `WEB_FQDNS` typicky nemá tvar `web.<tld>`, takže žádnému
 * vzoru neodpovídá. Přihlášení na brand doméně proto skončí na
 * `invalid_redirect_uri`, přestože doména je řádně deklarovaná.
 *
 * Zdrojem pravdy je DEKLARACE instance (WEB_FQDNS / ADDITIONAL_REDIRECT_URLS /
 * ALLOWED_ORIGINS) — to, co je evidované v repu a overlay. Runtime tabulka
 * `branding_hostname_mapping` se tu ZÁMĚRNĚ nečte: tenhle sync běží při deploji,
 * kdy DB nemusí být k dispozici, a míchat běhový zdroj do warmupu základu by
 * rozmazalo hranici — repo warmupuje ZÁKLAD, administrace vlastní zbytek.
 * Brand přidaný jen v administraci se do realmu dostane přes administraci.
 */
function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const WEB_FQDNS = splitList(process.env.WEB_FQDNS ?? envFile.WEB_FQDNS);
const ADDITIONAL_REDIRECT_URLS = splitList(
  process.env.ADDITIONAL_REDIRECT_URLS ?? envFile.ADDITIONAL_REDIRECT_URLS,
);
const ALLOWED_ORIGINS = splitList(process.env.ALLOWED_ORIGINS ?? envFile.ALLOWED_ORIGINS);

/** `https://host` → callbacky, které SPA i gateway na té doméně používají. */
function callbacksFor(origin) {
  const base = origin.replace(/\/+$/, '');
  return [`${base}/auth/callback`, `${base}/auth/v1/callback`];
}

const SERVED_REDIRECT_URIS = [
  ...WEB_FQDNS.flatMap(callbacksFor),
  ...ADDITIONAL_REDIRECT_URLS,
];

const REQUIRED_REDIRECT_URIS = [
  ...SERVED_REDIRECT_URIS,
  `https://api.${INTERNAL_SERVER}.${INTERNAL_TLD}/auth/v1/callback`,
  `https://api.${PUBLIC_TLD}/auth/v1/callback`,
  `https://web.${PUBLIC_TLD}/auth/callback`,
  LOCAL_AUTH_CALLBACK,
  LOCALHOST_AUTH_CALLBACK,
  LOCAL_DEV_WEB_CALLBACK,
  LOCAL_PREVIEW_CALLBACK,
  LOCALHOST_PREVIEW_CALLBACK,
  'aisha-dirigent://oauth-callback',
  'vscode://evymo.aisha-dirigent/did-authenticate',
  'vscode-insiders://evymo.aisha-dirigent/did-authenticate',
  'cursor://evymo.aisha-dirigent/did-authenticate',
  'vscodium://evymo.aisha-dirigent/did-authenticate',
  'vscode://aisha.aisha-dirigent/did-authenticate',
  'vscode://aisha.aisha-dirigent/did-authenticate/',
  'vscode://aisha.aisha-dirigent/did-authenticate*',
  'vscode-insiders://aisha.aisha-dirigent/did-authenticate',
  'vscode-insiders://aisha.aisha-dirigent/did-authenticate/',
  'vscode-insiders://aisha.aisha-dirigent/did-authenticate*',
  'cursor://aisha.aisha-dirigent/did-authenticate',
  'cursor://aisha.aisha-dirigent/did-authenticate/',
  'cursor://aisha.aisha-dirigent/did-authenticate*',
  'vscodium://aisha.aisha-dirigent/did-authenticate',
  'vscodium://aisha.aisha-dirigent/did-authenticate/',
  'vscodium://aisha.aisha-dirigent/did-authenticate*',
  'https://vscode.dev/redirect*',
  'https://insiders.vscode.dev/redirect*',
  'http://127.0.0.1:*',
  'http://localhost:*',
];

const KC_ADMIN_USER = process.env.KEYCLOAK_ADMIN ?? envFile.KEYCLOAK_ADMIN ?? 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? envFile.KEYCLOAK_ADMIN_PASSWORD;

if (!KC_ADMIN_PASSWORD) {
  console.error('KEYCLOAK_ADMIN_PASSWORD missing in environment and .env.coolify');
  process.exit(1);
}

async function kcFetch(path, options = {}) {
  return fetch(`${KC_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function main() {
  const tokenRes = await kcFetch('/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASSWORD,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Keycloak admin login failed: HTTP ${tokenRes.status}`);
  }

  const tokenBody = await tokenRes.json();
  const accessToken = tokenBody.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Keycloak admin token response did not contain access_token');
  }

  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const clientRes = await kcFetch(`/admin/realms/${KC_REALM}/clients?clientId=${encodeURIComponent(KC_CLIENT_ID)}`, {
    headers: authHeaders,
  });

  if (!clientRes.ok) {
    throw new Error(`Keycloak client lookup failed: HTTP ${clientRes.status}`);
  }

  const clients = await clientRes.json();
  if (!Array.isArray(clients) || clients.length === 0) {
    throw new Error(`Client ${KC_CLIENT_ID} not found in realm ${KC_REALM}`);
  }

  const client = clients[0];

  // SLOUČENÍ, NE PŘEPIS — u obou polí. Deploy dorovná DEKLAROVANÝ ZÁKLAD;
  // cokoli si správce přidal v administraci za běhu, zůstává. Kdyby se pole
  // přepisovala, každý deploy by potichu zahodil ruční konfiguraci.
  const currentUris = Array.isArray(client.redirectUris) ? client.redirectUris : [];
  const added = REQUIRED_REDIRECT_URIS.filter((uri) => !currentUris.includes(uri));
  const redirectUris = Array.from(new Set([...currentUris, ...REQUIRED_REDIRECT_URIS]));

  // webOrigins se dosud nesynchronizovaly VŮBEC. Bez nich prohlížeč zablokuje
  // CORS preflight na brand doméně, i když je redirect URI v pořádku — chyba se
  // pak projeví až v konzoli prohlížeče, ne v Keycloaku.
  const currentOrigins = Array.isArray(client.webOrigins) ? client.webOrigins : [];
  const requiredOrigins = Array.from(new Set([...ALLOWED_ORIGINS, ...WEB_FQDNS]));
  const addedOrigins = requiredOrigins.filter((o) => !currentOrigins.includes(o));
  const webOrigins = Array.from(new Set([...currentOrigins, ...requiredOrigins]));

  const changed = added.length > 0 || addedOrigins.length > 0;

  if (changed && !DRY_RUN) {
    const updateRes = await kcFetch(`/admin/realms/${KC_REALM}/clients/${client.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        ...client,
        redirectUris,
        webOrigins,
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`Keycloak client update failed: HTTP ${updateRes.status}`);
    }
  }

  console.log(JSON.stringify({
    realm: KC_REALM,
    clientId: KC_CLIENT_ID,
    dryRun: DRY_RUN,
    changed,
    servedHosts: WEB_FQDNS,
    added,
    addedOrigins,
    totalRedirectUris: redirectUris.length,
    totalWebOrigins: webOrigins.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

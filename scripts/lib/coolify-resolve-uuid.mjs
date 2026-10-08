/**
 * scripts/lib/coolify-resolve-uuid.mjs — DYNAMIC Coolify UUID resolver (Node).
 *
 * Mirrors scripts/lib/coolify-resolve-uuid.sh. Used by Node-based tooling
 * (check-infra.mjs, blue-green-smoke-runner.mjs, models-wizard.mjs, etc.)
 * so we don't fork the resolution logic between bash and JS.
 *
 * Required env:
 *   COOLIFY_URL          (Coolify API base URL — operator-set)
 *   COOLIFY_API_TOKEN
 *   APP_NAME_PREFIX      (identita instance = jméno projektu) nebo COOLIFY_PROJECT_UUID
 *
 * Usage:
 *   import { resolveUuid, resolveAllAishaUuids, redeployApp, clearCache }
 *     from './scripts/lib/coolify-resolve-uuid.mjs';
 *
 *   const uuid = await resolveUuid('aisha-core');
 *   const all  = await resolveAllAishaUuids();   // { 'aisha-core': 'uuid', ... }
 *   await redeployApp('aisha-keycloak');
 *
 * Memory invariants honored:
 *   - feedback_coolify_v4_list_cache_race.md: retry list with backoff up to 5x
 *   - feedback_coolify_api_unified_retry.md:  5s/10s/15s backoff
 *   - per-process cache for repeated resolves (don't hammer the API)
 */

import { createCoolifyClient } from './coolify-http.mjs';
import { createProjectScope, resolveProjectName } from './coolify-project-scope.mjs';

// env.mjs se načítá až při skutečném dotazu: při importu hází na každou chybějící
// URL (i n8n, git host…) a zapisuje .env-prod-backup do process.env. Brána, která
// vstříkne vlastního klienta, tím nesmí projít — skutečný běh ano, beze změny.
async function getEnv() {
  const { COOLIFY_URL: COOLIFY_URL_FROM_ENV } = await import('./env.mjs');
  const url = (process.env.COOLIFY_URL ?? COOLIFY_URL_FROM_ENV).replace(/\/+$/, '');
  const token = process.env.COOLIFY_API_TOKEN ?? process.env.COOLIFY_TOKEN ?? '';
  if (!token) {
    throw new Error(
      'coolify-resolve-uuid: COOLIFY_API_TOKEN (or COOLIFY_TOKEN) not set in env',
    );
  }
  return { url, token };
}

let _cache = null;

export function clearCache() {
  _cache = null;
}

/**
 * Aplikace PROJEKTU instance — nikdy globální seznam.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (GET /api/v1/applications, 227 aplikací): tenhle
 * překladač bral celé `/applications` a `find()` podle jména. Jméno
 * `aisha-registry` nesou dvě aplikace — cizí v projektu a1sh4 stojí v odpovědi
 * na indexu 30, naše (projekt aisha) na 31. `resolveUuid('aisha-registry')` tedy
 * vracel CIZÍ UUID a `redeployApp` by restartoval cizí aplikaci; mapa
 * `resolveAllAishaUuids` naopak brala poslední shodu — dvě funkce téhož modulu
 * se o identitě rozcházely podle pořadí v odpovědi API.
 *
 * Rozsah proto určuje jediný domov hranice (coolify-project-scope.mjs):
 * připnuté COOLIFY_PROJECT_UUID, jinak projekt pojmenovaný identitou instance
 * (APP_NAME_PREFIX) — stejně, jak ho odvozuje cold-start. Nezjištěný rozsah
 * HÁZE; globální seznam jako náhrada neexistuje.
 *
 * @param {{ coolify?: (path: string, options?: object) => Promise<any>, env?: NodeJS.ProcessEnv }} [opts]
 *        `coolify` = vstříknutý klient (brána), jinak createCoolifyClient z prostředí.
 */
async function fetchAllApps({ coolify, env } = {}) {
  if (_cache && !coolify) return _cache;
  let client = coolify;
  if (!client) {
    const { url, token } = await getEnv();
    // 120 s: globální tělo /applications nese docker_compose_raw všech nájemníků
    // (naměřeno 2026-09-13: 10 MB) — inProject ho pak zúží.
    client = createCoolifyClient({ baseUrl: url, token, timeoutMs: 120_000 });
  }
  const scope = await createProjectScope(client, { env }); // hází, když rozsah nejde zjistit
  const backoff = [5_000, 10_000, 15_000, 15_000, 15_000];

  for (let attempt = 1; attempt <= backoff.length; attempt++) {
    const all = await client('/applications');
    const apps = scope.filter(Array.isArray(all) ? all : []);
    if (apps.length > 0) {
      if (!coolify) _cache = apps;
      return apps;
    }
    if (attempt < backoff.length && !coolify) {
      process.stderr.write(
        `[coolify-resolve-uuid] projekt ${scope.projectUuid.slice(0, 8)}… vrátil 0 aplikací (pokus ${attempt}) — zkusím znovu za ${backoff[attempt - 1] / 1000}s\n`,
      );
      await new Promise((r) => setTimeout(r, backoff[attempt - 1]));
    } else if (coolify) {
      break;
    }
  }
  throw new Error(
    `coolify-resolve-uuid: projekt ${scope.projectUuid} nevrátil žádné aplikace — NEZMĚŘENO, ne „aplikace neexistuje"`,
  );
}

/**
 * Resolve Coolify application UUID by name — uvnitř projektu instance.
 * Dvě aplikace téhož jména = chyba (hází), ne volba první shody.
 * @param {string} name e.g. 'aisha-core'
 * @param {{ coolify?: Function, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<string | null>} uuid or null when app is absent
 */
export async function resolveUuid(name, opts = {}) {
  if (!name) throw new Error('resolveUuid: name required');
  const apps = await fetchAllApps(opts);
  const matches = apps.filter((a) => a?.name === name && a?.uuid);
  if (matches.length > 1) {
    throw new Error(
      `coolify-resolve-uuid: '${name}' nesou ${matches.length} aplikace v projektu (${matches.map((a) => a.uuid).join(', ')}) — překlad jméno→UUID je dvojznačný, nevybírám`,
    );
  }
  return matches[0]?.uuid ?? null;
}

/**
 * Resolve all app UUIDs of THIS instance (`<APP_NAME_PREFIX>-*` uvnitř projektu).
 * Dříve natvrdo `aisha-` — z forku by to nabídlo cizí aplikace.
 * @param {{ coolify?: Function, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<Record<string, string>>}
 */
export async function resolveAllAishaUuids(opts = {}) {
  const prefix = resolveProjectName(opts.env);
  if (!prefix) {
    throw new Error(
      'coolify-resolve-uuid: APP_NAME_PREFIX není deklarován — nevím, čí aplikace vypsat (výchozí hodnota se záměrně nedosazuje)',
    );
  }
  const apps = await fetchAllApps(opts);
  const out = {};
  const dupl = new Map();
  for (const a of apps) {
    if (typeof a?.name === 'string' && a.name.startsWith(`${prefix}-`) && a.uuid) {
      if (out[a.name]) dupl.set(a.name, [...(dupl.get(a.name) || [out[a.name]]), a.uuid]);
      out[a.name] = a.uuid;
    }
  }
  if (dupl.size > 0) {
    // Mapa klíčovaná jménem by jednu z nich tiše zahodila (viz bashový sourozenec).
    throw new Error(
      `coolify-resolve-uuid: duplicitní jména v projektu — ${[...dupl].map(([n, u]) => `${n}: ${u.join(', ')}`).join('; ')}`,
    );
  }
  return out;
}

/**
 * Resolve UUID + POST /api/v1/applications/{uuid}/restart.
 * Soft-fails when app not found (resolves to null, returns { ok: false }).
 */
export async function redeployApp(name) {
  const uuid = await resolveUuid(name);
  if (!uuid) {
    return { ok: false, error: 'not_found', name };
  }
  const { url, token } = await getEnv();
  try {
    const res = await fetch(`${url}/api/v1/applications/${uuid}/restart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
    });
    return { ok: res.ok, status: res.status, uuid, name };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200), uuid, name };
  }
}

// CLI passthrough (mirrors bash variant):
//   node scripts/lib/coolify-resolve-uuid.mjs <name>           → prints uuid
//   node scripts/lib/coolify-resolve-uuid.mjs --all-aisha      → JSON
//   node scripts/lib/coolify-resolve-uuid.mjs --redeploy <name>
const isCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('coolify-resolve-uuid.mjs');

if (isCli) {
  const [, , flag, arg2] = process.argv;
  try {
    if (flag === '--all-aisha') {
      const map = await resolveAllAishaUuids();
      process.stdout.write(JSON.stringify(map, null, 2) + '\n');
    } else if (flag === '--redeploy') {
      const result = await redeployApp(arg2);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(result.ok ? 0 : 1);
    } else if (!flag || flag === '--help' || flag === '-h') {
      process.stdout.write(
        `Usage:
  coolify-resolve-uuid.mjs <name>            # prints uuid
  coolify-resolve-uuid.mjs --all-aisha       # JSON map { name: uuid }
  coolify-resolve-uuid.mjs --redeploy <name> # POST /restart
Required env: COOLIFY_URL, COOLIFY_API_TOKEN
`,
      );
    } else {
      const uuid = await resolveUuid(flag);
      if (!uuid) {
        process.stderr.write(`coolify-resolve-uuid: '${flag}' not found\n`);
        process.exit(1);
      }
      process.stdout.write(uuid + '\n');
    }
  } catch (err) {
    process.stderr.write(`coolify-resolve-uuid: ${String(err).slice(0, 200)}\n`);
    process.exit(2);
  }
}

#!/usr/bin/env node
/**
 * generate-coolify-context.mjs — Auto-discover Coolify project + server UUIDs.
 *
 * Companion to generate-secrets.mjs. Where that script GENERATES random
 * secrets, this one DISCOVERS Coolify infrastructure UUIDs by querying the
 * operator's Coolify API. Result: cold-start works against any Coolify
 * cluster (single-server, multi-server, fork operator's own) without the
 * operator having to look up + paste UUIDs into config files.
 *
 * Architecture:
 *   - `pg(key, lookupFn)` is DISCOVER-FIRST (NOT preserve-first like
 *     generate-secrets.mjs): infra UUIDs are read off the live Coolify server
 *     every run, because they can change across a --wipe / re-provision. The
 *     .env.coolify cache is only a resilience fallback when the API can't
 *     answer AND --preserve=1; with --preserve=0 there is no fallback (strict
 *     live verification, as a fresh machine would see).
 *   - `emit(key, value)` writes `KEY='value'\n` to stdout for eval-ing by
 *     the caller (`_gen_tmp=$(node ...); eval "$_gen_tmp"`).
 *   - Soft-fail on API errors: emits warning to stderr, leaves keys empty
 *     so downstream `${VAR:?required}` checks decide whether to abort.
 *
 * Discovery rules:
 *   1. PROJECT  — GET /api/v1/projects, match by name = `${APP_NAME_PREFIX:-${AISHA_STORY:-aisha}}`.
 *   2. SERVERS  — GET /api/v1/servers. Slots come from `coolify/servers.json`
 *      keys (frontend, backend, experimental, build by default). For each slot:
 *        a) Operator-set `${SLOT_UPPER}_HOSTNAME` env wins (matches server.ip
 *           or server.name).
 *        b) Coolify server.name == slot ID (case-insensitive).
 *        c) `is_build_server` flag pairing: if `coolify/servers.json` tags this
 *           slot `is_build_server: true` and exactly one live Coolify server
 *           has `settings.is_build_server === true`, pair them. Generic
 *           structural signal present on both sides — no naming convention
 *           required, works for any fork's dedicated build host.
 *        d) `is_coolify_host` / `has_traefik` pairing: if `coolify/servers.json`
 *           tags this slot `has_traefik: true` and exactly one live server has
 *           top-level `is_coolify_host === true`, pair them. The host Coolify
 *           is installed on also runs the Traefik edge proxy — same kind of
 *           zero-config structural signal as (c), for the edge host.
 *        e) FALLBACK for single-server deploys: if Coolify has exactly 1
 *           server, every slot maps to that one UUID (cloud-single mode —
 *           all stacks deploy on the one server we have).
 *      If a slot still has no match and Coolify has multiple servers, the
 *      live server list (name/uuid/ip/description) is printed to stderr so
 *      the operator can set `${SLOT_UPPER}_HOSTNAME` to pair it.
 *
 * Required env:
 *   COOLIFY_API_TOKEN   — API access token (read-only ok)
 *   COOLIFY_URL         — Coolify base URL (e.g. https://coolify.example.com)
 *
 * Optional env:
 *   COOLIFY_PROJECT_NAME    — defaults to ${APP_NAME_PREFIX} → ${AISHA_STORY} → 'aisha'
 *   APP_NAME_PREFIX         — operator's project namespace (e.g. 'acme')
 *   FRONTEND_HOSTNAME / BACKEND_HOSTNAME / EXPERIMENTAL_HOSTNAME / BUILD_HOSTNAME
 *                           — operator's per-slot hostnames; aids matching
 *
 * Usage (mirrors generate-secrets.mjs):
 *   node scripts/generate-coolify-context.mjs \
 *     --env-coolify=.env.coolify \
 *     --preserve=1
 *
 * Soft skip:
 *   - COOLIFY_URL or COOLIFY_API_TOKEN missing → emit nothing, exit 0.
 *     (local-dev profile has no Coolify; downstream skips Coolify steps.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectName } from './lib/coolify-project-scope.mjs';
import { createCoolifyClient } from './lib/coolify-http.mjs';
import { pbJeProd, pbPrefix } from './lib/prostredi-behu.mjs';
import { nactiSloty, slotyVProvozu, vyzadujeVyslovnouVazbu } from './lib/sloty-serveru.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── CLI args ─────────────────────────────────────────────────────────────────
function getArg(name) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

const envCoolifyPath = getArg('--env-coolify') || '';
const preserve = getArg('--preserve') !== '0';

// ── Parse existing .env.coolify (for preserve mode) ──────────────────────────
function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(.*))$/);
    if (m) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
const existing = parseEnvFile(envCoolifyPath);

// ── Emit pattern (mirrors generate-secrets.mjs) ──────────────────────────────
const lines = [];
function emit(key, value) {
  // Single-quote safe for UUID-shaped strings (no quotes in Coolify v4 UUIDs).
  lines.push(`${key}='${value ?? ''}'`);
}

// ── Soft-skip when Coolify access is not configured ──────────────────────────
const COOLIFY_URL = (process.env.COOLIFY_URL || '').replace(/\/+$/, '');
const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN || process.env.COOLIFY_TOKEN || '';

if (!COOLIFY_URL || !COOLIFY_API_TOKEN) {
  process.stderr.write(
    '[generate-coolify-context] COOLIFY_URL or COOLIFY_API_TOKEN unset — ' +
    'skipping discovery (assume local-dev or operator will supply UUIDs manually).\n',
  );
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

// ── Discover-first resolver for infra UUIDs ──────────────────────────────────
// IMPORTANT: project + per-slot server UUIDs are DISCOVERED identifiers — they
// are READ off the live Coolify server, never authored by the operator, and CAN
// change (e.g. a --wipe / re-provision). So unlike generated secrets (which use
// generate-secrets.mjs' preserve-or-gen-and-NEVER-rekey pattern), the live API
// is always the source of truth here: we discover FRESH on every run.
//
// The .env.coolify cache is only a resilience fallback, used when the live API
// can't answer AND --preserve is on (cold-start, so a transient API blip doesn't
// wipe a working value). With --preserve=0 (cold-start-doctor's Phase F probe)
// there is NO cache fallback — the check then truly verifies live discovery,
// exactly as a fresh machine (which has no .env.coolify cache) would experience.
// Chyba DEKLARACE není výpadek API. `pg()` níž odchytává výjimky schválně, aby
// transientní blip nezahodil funkční hodnotu z cache — jenže operátorem
// deklarovaný stroj, který neexistuje, není blip: propadnout na cache nebo na
// heuristiku by znamenalo nasadit jinam, než bylo řečeno. Tyhle se proto značí
// a `pg` je propouští dál.
function fatalDeclaration(msg) {
  const e = new Error(msg);
  e.fatalDeclaration = true;
  return e;
}

async function pg(key, lookupFn) {
  try {
    const fresh = await lookupFn();
    if (fresh && String(fresh).length > 0) return fresh;
  } catch (err) {
    if (err?.fatalDeclaration) throw err;
    process.stderr.write(`[generate-coolify-context] ${key} fresh discovery failed: ${String(err).slice(0, 200)}\n`);
  }
  if (preserve && existing[key] && existing[key].length > 0) {
    process.stderr.write(`[generate-coolify-context] ${key}: live discovery unavailable → falling back to cached .env.coolify value\n`);
    return existing[key];
  }
  return '';
}

// ── Coolify API helper ───────────────────────────────────────────────────────
// ⛔ VLASTNÍ KOPIE KLIENTA opakovala jakoukoli chybu naslepo (3, 6, 10 s) a
// nerozlišovala 429 od 404 — tedy „server je zahlcený" od „to tam není".
// Sdílený klient obojí rozlišuje a ctí `Retry-After`. Tenhle skript běží
// v cold-startu, kde je rozpočet požadavků (200/okno) napjatý.
//
// Zůstává jen NORMALIZACE TVARU: volající tu čekají pole (`.find(...)`),
// zatímco Coolify vrací u některých koncových bodů jeden objekt. To není
// druhý klient, to je přizpůsobení volacího místa.
const coolifyRaw = createCoolifyClient({
  baseUrl: COOLIFY_URL,
  token: COOLIFY_API_TOKEN,
  timeoutMs: 30_000,
});

async function coolifyGet(endpoint) {
  const json = await coolifyRaw(endpoint);
  return Array.isArray(json) ? json : (json ? [json] : []);
}

// ── Determine the project name to look up ────────────────────────────────────
// ⚠️ ŽÁDNÝ default na 'aisha'. Tenhle prefix vybírá Coolify PROJEKT a filtruje
// aplikace — dosazená hodnota by z forku vyrobila kontext cizí instance
// (2026-08-04: deploy z forku takhle nasadil upstream core).
// Pořadí APP_NAME_PREFIX→AISHA_STORY je deklarované v lib/coolify-project-scope.mjs; neopisuje se.
const APP_NAME_PREFIX = resolveProjectName();
if (!APP_NAME_PREFIX) {
  console.error('FATAL: APP_NAME_PREFIX ani AISHA_STORY nejsou nastavené — nevím, KTERÉ instance se kontext týká.');
  console.error('       Výchozí hodnota se ZÁMĚRNĚ nedosazuje: dosazené "aisha" by mířilo na cizí projekt.');
  process.exit(2);
}
const COOLIFY_PROJECT_NAME = process.env.COOLIFY_PROJECT_NAME || APP_NAME_PREFIX;

// ── Discover (or auto-create) PROJECT_UUID ───────────────────────────────────
// Coolify v4 project lookup is case-insensitive on the name. If the project
// doesn't exist AND auto-create is enabled (COOLIFY_AUTO_CREATE_PROJECT=1,
// default ON when cold-start is invoking us), POST /api/v1/projects to make
// it. Operator's deploy then proceeds against a freshly-created namespace.
async function coolifyPost(endpoint, body) {
  const res = await fetch(`${COOLIFY_URL}/api/v1${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COOLIFY_API_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`POST ${endpoint} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// ⛔ Běh nanečisto (DRY_RUN=1) ani běh se smazáním (WIPE=1) projekt NIKDY
// nezakládá. Založení je mutující volání: v dry-runu porušuje slib „nic se
// nezmění" a při wipu znamená, že hledané jméno míří jinam, než si operátor
// myslí — obojí je důvod zastavit, ne vyrobit nový jmenný prostor.
// Cold-start i doktor sem záměr předávají prostředím (DRY_RUN, WIPE).
const ZAMER_BEZ_ZAKLADANI = process.env.DRY_RUN === '1' || process.env.WIPE === '1';
const AUTO_CREATE_PROJECT =
  !ZAMER_BEZ_ZAKLADANI && (process.env.COOLIFY_AUTO_CREATE_PROJECT ?? '1') !== '0';

// ── PIN VYHRÁVÁ (PR2 izolace, incident 2026-09-24) ───────────────────────────
// Ne-produkční běh dostane od cold-startu připnuté UUID svého projektu
// (AISHA_PROJEKT_PIN). Hledání podle JMÉNA pak NIC nerozhoduje: fork má staging
// i produkci pod jedním jménem instance a jméno ukazovalo na produkci. Pin se
// OVĚŘÍ — v Coolify musí existovat (zastaralý pin = chyba, ne tiché založení),
// a když jméno ukazuje jinam, řekne se to nahlas. Produkční běh pin nedostává a
// hledá dál podle jména (beze změny).
const PROJEKT_PIN = (process.env.AISHA_PROJEKT_PIN || '').trim();
async function overenyPin(pin) {
  let projects;
  try {
    projects = await coolifyGet('/projects');
  } catch (err) {
    process.stderr.write(
      `[generate-coolify-context] WARN: připnutý projekt ${pin.slice(0, 8)}… nejde ověřit (${String(err).slice(0, 160)}) — platí pin\n`,
    );
    return pin;
  }
  if (!projects.some((p) => p?.uuid === pin)) {
    throw fatalDeclaration(
      `připnutý projekt ${pin} v Coolify ${COOLIFY_URL} NENÍ (have: ${projects.map((p) => `${p?.name}=${String(p?.uuid).slice(0, 8)}`).join(', ') || 'none'}) — ` +
        `zastaralý pin prostředí AISHA_ENV=${JSON.stringify(process.env.AISHA_ENV)}. Oprav COOLIFY_<ENV>_PROJECT_UUID; projekt se NEZAKLÁDÁ.`,
    );
  }
  const podleJmena = projects.find((p) => p?.name?.toLowerCase() === COOLIFY_PROJECT_NAME.toLowerCase());
  if (!podleJmena) {
    process.stderr.write(`[generate-coolify-context] note: project '${COOLIFY_PROJECT_NAME}' not found by name — platí připnutý ${pin.slice(0, 8)}…\n`);
  } else if (podleJmena.uuid !== pin) {
    process.stderr.write(
      `[generate-coolify-context] note: jméno '${COOLIFY_PROJECT_NAME}' ukazuje na ${podleJmena.uuid.slice(0, 8)}…, ` +
        `platí připnutý ${pin.slice(0, 8)}… (ne-produkční běh se podle jména neřídí)\n`,
    );
  }
  return pin;
}

const projectUuid = PROJEKT_PIN ? await overenyPin(PROJEKT_PIN) : await pg('COOLIFY_PROJECT_UUID', async () => {
  const projects = await coolifyGet('/projects');
  const match = projects.find(
    (p) => p?.name?.toLowerCase() === COOLIFY_PROJECT_NAME.toLowerCase(),
  );
  if (match) return match.uuid;

  if (ZAMER_BEZ_ZAKLADANI) {
    throw fatalDeclaration(
      `project '${COOLIFY_PROJECT_NAME}' not found in Coolify ${COOLIFY_URL} ` +
        `(AISHA_ENV=${JSON.stringify(process.env.AISHA_ENV)}, ` +
        `have: ${projects.map((p) => p?.name).filter(Boolean).join(', ') || 'none'}) — ` +
        `DRY_RUN/WIPE never creates a project. Check COOLIFY_PROJECT_NAME / APP_NAME_PREFIX ` +
        `or pin the run's COOLIFY_PROJECT_UUID.`,
    );
  }

  // Not found — auto-create if allowed
  if (AUTO_CREATE_PROJECT) {
    process.stderr.write(
      `[generate-coolify-context] project '${COOLIFY_PROJECT_NAME}' not found, auto-creating (set COOLIFY_AUTO_CREATE_PROJECT=0 to disable)\n`,
    );
    try {
      const created = await coolifyPost('/projects', {
        name: COOLIFY_PROJECT_NAME,
        description: 'Auto-created by AISHA cold-start',
      });
      const newUuid = created?.uuid || created?.data?.uuid || '';
      if (newUuid) {
        process.stderr.write(`[generate-coolify-context] created project '${COOLIFY_PROJECT_NAME}' = ${newUuid.slice(0, 8)}…\n`);
        return newUuid;
      }
      process.stderr.write(`[generate-coolify-context] WARN: project create returned no UUID: ${JSON.stringify(created).slice(0, 200)}\n`);
    } catch (err) {
      process.stderr.write(`[generate-coolify-context] WARN: project create failed: ${String(err).slice(0, 200)}\n`);
    }
  } else {
    process.stderr.write(
      `[generate-coolify-context] WARN: project '${COOLIFY_PROJECT_NAME}' not found in Coolify (have: ${projects.map((p) => p?.name).filter(Boolean).join(', ') || 'none'}). Create it manually or unset COOLIFY_AUTO_CREATE_PROJECT=0.\n`,
    );
  }
  return '';
});
emit('COOLIFY_PROJECT_UUID', projectUuid);

// ── Load slot definitions from coolify/servers.json (canonical slot names +
// per-slot metadata used for structural matching, e.g. is_build_server) ─────
// Jeden domov: lib/sloty-serveru.mjs. Nečitelný nebo prázdný registr je CHYBA —
// dřív ho tiše nahradila vestavěná kopie čtyř slotů (DEFAULT_SLOT_DEFS) a discovery
// pak běžela nad jiným seznamem slotů, než jaký instance deklaruje.
let SLOT_DEFS;
try {
  SLOT_DEFS = nactiSloty(REPO_ROOT);
} catch (err) {
  console.error(`FATAL: registr slotů coolify/servers.json nejde přečíst — ${String(err?.message ?? err)}`);
  process.exit(2);
}
const SLOTS = Object.keys(SLOT_DEFS);

// ── Profile-declared slot -> server-name bindings ────────────────────────────
// Read through buildTopology() rather than re-reading config/profiles/<id>.json
// here: that loader already applies ${VAR} substitution, so a binding may itself
// be env-driven, and a fourth private copy of "how do I find the active profile"
// is how the toolchain ended up with several answers to the same question.
//
// Deliberately non-fatal: this script soft-skips when Coolify is not configured
// at all (local-dev), so a missing or unparsable profile must not turn a working
// no-Coolify run into a hard failure. An empty map simply means "nothing
// declared" — identical to every upstream profile.
const PROFILE_TOPOLOGY = await (async () => {
  try {
    const { buildTopology } = await import('./lib/derive-domains.mjs');
    return buildTopology();
  } catch (err) {
    process.stderr.write(
      `[generate-coolify-context] note: no profile topology (${String(err).slice(0, 120)})\n`,
    );
    return {};
  }
})();
const PROFILE_SERVER_BINDINGS = PROFILE_TOPOLOGY.server_bindings ?? {};

// ── Fetch all Coolify servers (single API call, reused across slots) ─────────
let coolifyServers = [];
try {
  coolifyServers = await coolifyGet('/servers');
} catch (err) {
  process.stderr.write(
    `[generate-coolify-context] WARN: /servers fetch failed: ${String(err).slice(0, 200)}. Slot UUIDs will be empty.\n`,
  );
}

// ── Resolve UUID for one slot ────────────────────────────────────────────────
// Matching order:
//   1. operator env ${SLOT_UPPER}_HOSTNAME → match server.ip or server.name
//   2. Coolify server.name == slot ID (case-insensitive)
//   3. profile server_bindings[slot] → match server.name (case-insensitive)
//   4. is_build_server flag pairing (slotDef.is_build_server === true and
//      exactly one live server has settings.is_build_server === true)
//   5. is_coolify_host / has_traefik pairing (slotDef.has_traefik === true and
//      exactly one live server has top-level is_coolify_host === true) — the
//      host Coolify itself runs on also runs the Traefik edge proxy.
//   6. Fallback: if exactly 1 server in Coolify, use it (single-server mode)
//
// (3) sits above the structural pairings on purpose: DECLARED beats INFERRED.
// The inferences are heuristics about what a server probably is; the profile is
// the operator stating what it IS. Below them, (3) could never take effect for
// the slot that needs it most — a `has_traefik` slot always matched (5) first.
//
// That ordering was a real hazard, not a style point. Until server_bindings
// existed, the slot→host map lived ONLY in a gitignored .env.local on one
// workstation. Run cold-start anywhere else — a colleague's machine, CI, a
// restore after wipe — and the frontend slot fell through to (5) and silently
// resolved to whichever host runs Coolify. On a shared control plane that is a
// box full of OTHER tenants' production, and nothing failed loudly to say so.
// Prefix prostředí. Definován PŘED resolverem, protože ten podle něj čte
// per-prostředí deklaraci slotu — bez toho by ji viděl až po sobě.
// Z jednoho domova (prostredi-behu.mjs). Produkční běh (i `<story>-prod`) zůstává
// na COOLIFY_PROD_ jako dosud; ne-produkční dostane prefix svého slotu. Dřív tu
// stálo „začíná na STAG?" a `<story>-staging` četl PRODUKČNÍ deklarace serverů
// a vydával COOLIFY_PROD_PROJECT_UUID se stagingovým UUID (PR2 izolace).
const ENV_PREFIX = pbJeProd(process.env.AISHA_ENV || '') ? 'COOLIFY_PROD_' : pbPrefix(process.env.AISHA_ENV || '');
if (!ENV_PREFIX) {
  console.error(`FATAL: AISHA_ENV=${JSON.stringify(process.env.AISHA_ENV)} není známý tvar prostředí (production, staging, <story>-{staging,prod}).`);
  process.exit(2);
}

async function resolveServerSlot(slot, slotDef) {
  if (coolifyServers.length === 0) return '';

  const slotUpper = slot.toUpperCase();

  // (0) PER-PROSTŘEDÍ DEKLARACE — `COOLIFY_<ENV>_SERVER_NAME_<SLOT>`.
  //
  // ⛔ NAMĚŘENO 2026-09-03 na <fork>: operátor měl COOLIFY_PROD_SERVER_UUID_FRONTEND
  // správně nastavené na server `<fork>`, a produkce přesto vznikla na Talosu —
  // slot propadl až na heuristiku (5) „slot s Traefikem = Coolify host". Přesně
  // ten scénář, který popisuje komentář nad touhle funkcí. Chyběl článek: pravidlo
  // (1) čte `<SLOT>_HOSTNAME`, což je JEDNA globální proměnná pro obě prostředí,
  // a profilová vazba (3) žije v profilu, který prod i staging SDÍLEJÍ. Deklarace
  // stroje je ale vlastnost PROSTŘEDÍ — jeden profil, dva stroje.
  //
  // Deklaruje se JMÉNEM, ne UUID, ze stejného důvodu jako u (3): uuid se při
  // přeprovizování Coolify přerazí, jméno ne. Deklarovaný, ale neexistující server
  // je fail-loud — tiché propadnutí na heuristiku je právě to, co tenhle incident
  // způsobilo.
  const declaredName = (process.env[`${ENV_PREFIX}SERVER_NAME_${slotUpper}`] || '').trim();
  if (declaredName) {
    const m = coolifyServers.find((s) => s?.name?.toLowerCase() === declaredName.toLowerCase());
    if (!m?.uuid) {
      throw fatalDeclaration(
        `${ENV_PREFIX}SERVER_NAME_${slotUpper}=${declaredName} — takový server v Coolify není. ` +
          `Dostupné: ${coolifyServers.map((s) => s?.name).filter(Boolean).join(', ')}. ` +
          `Deklarovaný stroj se NEDOHADUJE: tiché propadnutí na heuristiku je to, ` +
          `kvůli čemu produkce jednou vznikla na cizím hostiteli.`,
      );
    }
    return m.uuid;
  }

  // (0b) Zpětná kompatibilita: per-prostředí deklarace UUID. Ověřuje se proti
  // živému seznamu — zastaralé uuid (přeprovizovaný server) je fail-loud, ne
  // tiché propadnutí. Preferuj (0): jméno přeprovizování přežije.
  const declaredUuid = (process.env[`${ENV_PREFIX}SERVER_UUID_${slotUpper}`] || '').trim();
  if (declaredUuid) {
    const m = coolifyServers.find((s) => s?.uuid === declaredUuid);
    if (!m) {
      throw fatalDeclaration(
        `${ENV_PREFIX}SERVER_UUID_${slotUpper}=${declaredUuid} — takové uuid v Coolify není ` +
          `(přeprovizovaný server?). Deklaruj stroj jménem přes ${ENV_PREFIX}SERVER_NAME_${slotUpper}.`,
      );
    }
    return m.uuid;
  }

  const operatorHostname = process.env[`${slotUpper}_HOSTNAME`] || '';
  const operatorIp = process.env[`${slotUpper}_IP`] || '';

  // (1) Operator-set hostname/IP match — case-insensitive on name (Coolify
  // commonly capitalises server names: "Talos", "Backend"; operator may type
  // lowercase in .env-prod-backup).
  if (operatorHostname || operatorIp) {
    const hostLc = operatorHostname.toLowerCase();
    const m = coolifyServers.find(
      (s) =>
        (operatorHostname && (s?.name?.toLowerCase() === hostLc || s?.ip === operatorHostname)) ||
        (operatorIp && s?.ip === operatorIp),
    );
    if (m?.uuid) return m.uuid;
  }

  // ⛔ SLOT S VÝSLOVNOU VAZBOU (has_gpu, lib/sloty-serveru.mjs) SE NEHÁDÁ. Platí jen
  // deklarace — (0)/(0b) výš, (1) jméno/IP z ${SLOT}_HOSTNAME/_IP a (3) server_bindings
  // profilu. Heuristiky (2) jméno == slot, (4) build, (5) Traefik a hlavně (6)
  // „jediný server" by GPU slot posadily na produkční hostitel — a s ním firewall
  // hostitele (accel-hostfw), který tam nemá co dělat.
  const jenVyslovne = vyzadujeVyslovnouVazbu(slotDef);

  // (2) server.name == slot ID
  const byName = jenVyslovne ? null : coolifyServers.find((s) => s?.name?.toLowerCase() === slot.toLowerCase());
  if (byName?.uuid) return byName.uuid;

  // (3) Profile-declared binding: slot -> server NAME, resolved against the
  // live server list every run. Storing the name (not the uuid) is what makes
  // this survive a Coolify re-provision: the uuid is re-minted, the name is not.
  // A declared-but-missing server is fail-loud — silently falling through to a
  // heuristic is exactly how the frontend slot used to land on the wrong host.
  const bound = String(PROFILE_SERVER_BINDINGS[slot] ?? '').trim();
  if (bound) {
    const boundLc = bound.toLowerCase();
    const m = coolifyServers.find((s) => s?.name?.toLowerCase() === boundLc || s?.ip === bound);
    if (m?.uuid) return m.uuid;
    process.stderr.write(
      `[generate-coolify-context] FATAL: profile binds slot '${slot}' to server '${bound}', ` +
        `which Coolify does not have. Known: ${coolifyServers.map((s) => s?.name).filter(Boolean).join(', ')}. ` +
        `Refusing to guess a host — fix server_bindings in the profile, or override with ${slotUpper}_HOSTNAME.\n`,
    );
    process.exit(2);
  }

  if (jenVyslovne) return '';

  // (4) is_build_server flag pairing — structural signal present on both
  // sides (coolify/servers.json slot metadata + Coolify server.settings).
  // Only fires when exactly one live server carries the flag, so it can't
  // misattribute the dedicated build host when Coolify has several servers
  // but no naming convention links them to AISHA's role names.
  if (slotDef?.is_build_server === true) {
    const buildServers = coolifyServers.filter((s) => s?.settings?.is_build_server === true);
    if (buildServers.length === 1) return buildServers[0].uuid;
  }

  // (5) is_coolify_host / has_traefik pairing — same structural logic as (4),
  // for the edge/proxy host instead of the build host.
  if (slotDef?.has_traefik === true) {
    const edgeServers = coolifyServers.filter((s) => s?.is_coolify_host === true);
    if (edgeServers.length === 1) return edgeServers[0].uuid;
  }

  // (6) Single-server fallback
  if (coolifyServers.length === 1) {
    return coolifyServers[0].uuid;
  }

  return '';
}

// ── Discover per-slot SERVER_UUIDs ───────────────────────────────────────────
// Track resolved UUIDs per slot so the env-prefixed mirror block below sees
// the freshly-discovered values (NOT just what was already in .env.coolify).
const resolvedSlotUuid = {};
const unmatchedSlots = [];
for (const slot of SLOTS) {
  const key = `COOLIFY_SERVER_UUID_${slot.toUpperCase()}`;
  const uuid = await pg(key, () => resolveServerSlot(slot, SLOT_DEFS[slot]));
  emit(key, uuid);
  resolvedSlotUuid[slot] = uuid;
  if (!uuid) unmatchedSlots.push(slot);
}

// ── Per-slot host ADDRESS, for extra_hosts / internal-zone resolution ───────
// The internal name of a service is `<service>.<slot>.<internal_tld>` — the
// middle segment is the ROLE, and the role is an alias for whichever host
// currently carries it. Compose files turn that alias into an address via
// `extra_hosts`. Today all but one of those entries hardcode `host-gateway`,
// which silently assumes the target role lives on the SAME machine as the
// container doing the lookup. True on one node; wrong the moment a role moves,
// and wrong in a way that resolves successfully to the wrong host rather than
// failing — `auth.backend.<tld>` would answer with the local node's gateway.
//
// So publish the address alongside the uuid, derived from the SAME resolution:
// profile binds role -> server NAME, Coolify tells us that server's ip. The
// address is never committed (repo stays template-only, cf. the NETBIRD_MGMT_HOST
// note in aisha-env-doctor.mjs) — it is re-derived on every deploy, which is
// also what makes it survive a host re-provision.
//
// A role on the local node keeps `host-gateway`: Docker resolves that to the
// container's own gateway, which is both correct and cheaper than routing out
// to the node's LAN ip. Single-node therefore emits exactly today's values.
//
// This generalises a pattern the repo already documents for one name
// (NETBIRD_MGMT_HOST) to every role — it adds the verb, not a new vocabulary.
// The address is a property of the ROLE alone, never of the pair (consumer,
// role): which container asks is unknowable here, and a value that silently
// means "wherever I happen to be" is precisely the class of bug this replaces.
// So emit the role's own routable address, and fall back to `host-gateway` only
// when there is genuinely nothing to resolve — an unmapped slot, or a Coolify
// record with no ip. That keeps a single-server install on today's behaviour by
// construction, because an unmapped/ip-less role is exactly the degenerate case.
// Coolify's `ip` is not always an address: for the host Coolify itself runs on
// it is the literal `host.docker.internal`, a Docker-local magic name that means
// "my own host" and therefore means something DIFFERENT in every container. Put
// into extra_hosts on another node it would resolve to the wrong machine, or to
// nothing. Only a literal IP is a portable address, so anything else degrades to
// `host-gateway` — which is the correct reading of "the Coolify host, as seen
// from a container on it" anyway.
const isIpLiteral = (v) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(String(v ?? '')) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(String(v ?? ''));
const slotAddr = {};
for (const slot of SLOTS) {
  const slotUpper = slot.toUpperCase();
  const server = coolifyServers.find((s) => s?.uuid === (resolvedSlotUuid[slot] || ''));
  slotAddr[slot] = isIpLiteral(server?.ip) ? server.ip : 'host-gateway';
  emit(`${slotUpper}_HOST_ADDR`, slotAddr[slot]);
}

// ── Per-SERVICE address, so a compose file never has to know the topology ────
// A compose site resolves a NAME (`${KEYCLOAK_DOMAIN}`), and the address it
// needs is wherever THAT service runs. Writing `${BACKEND_HOST_ADDR}` there
// would hardcode "keycloak lives on backend" into two dozen files: move the
// service in the profile and every one of them silently keeps pointing at the
// old role. So resolve service -> placement -> slot address here, once, and let
// compose reference the service it is actually talking about.
//
// Same degradation rule as above: unknown placement or unmapped slot yields
// `host-gateway`, i.e. today's literal, so nothing changes on a single node.
const svcKey = (id) => `${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_HOST_ADDR`;
for (const [id, svc] of Object.entries(PROFILE_TOPOLOGY.services ?? {})) {
  emit(svcKey(id), slotAddr[svc?.placement] ?? 'host-gateway');
}

// ── Where PUBLIC names land ─────────────────────────────────────────────────
// A public hostname (`${KEYCLOAK_DOMAIN_PUBLIC}`) does NOT resolve to the
// service's own node — it resolves to whichever node terminates public traffic,
// because that is the node running the edge proxy that routes by Host header.
// Conflating the two is easy and wrong: a container would reach Keycloak's node
// directly on a port the public vhost is not served on, and get a confusing
// 404/TLS error rather than a clean failure.
//
// The edge node is identified structurally — the slot flagged `has_traefik` in
// coolify/servers.json — not by naming a slot here, so a fork that calls its
// edge role something else still gets the right answer.
const edgeSlot = SLOTS.find((s) => SLOT_DEFS[s]?.has_traefik === true);
emit('PUBLIC_EDGE_HOST_ADDR', (edgeSlot && slotAddr[edgeSlot]) || 'host-gateway');

// ── Also emit env-prefixed forms used by coolify-environments.env ──────────
// COOLIFY_PROD_PROJECT_UUID, COOLIFY_PROD_SERVER_UUID_FRONTEND, etc.
// These are the keys coolify-environments.env templates expand to. We mirror
// the resolved values into the prefixed slots so resolve_target_env() picks
// them up without further work.
emit(`${ENV_PREFIX}PROJECT_UUID`, projectUuid);
for (const slot of SLOTS) {
  const slotUpper = slot.toUpperCase();
  // Prefer the just-resolved value; fall back to existing .env.coolify entry.
  const uuid = resolvedSlotUuid[slot] || existing[`COOLIFY_SERVER_UUID_${slotUpper}`] || '';
  emit(`${ENV_PREFIX}SERVER_UUID_${slotUpper}`, uuid);
}

// ── Summary diagnostic to stderr ─────────────────────────────────────────────
const discoveredCount = SLOTS.filter((s) => {
  const key = `COOLIFY_SERVER_UUID_${s.toUpperCase()}`;
  return lines.some((l) => l.startsWith(`${key}=`) && !l.includes("=''"));
}).length;

process.stderr.write(
  `[generate-coolify-context] project=${projectUuid ? projectUuid.slice(0, 8) + '…' : 'NOT FOUND'}, ` +
  `${discoveredCount}/${SLOTS.length} server slots mapped ` +
  `(Coolify has ${coolifyServers.length} server${coolifyServers.length === 1 ? '' : 's'})\n`,
);

// ── Unmatched-slot diagnostic ────────────────────────────────────────────────
// Structural matching (operator hostname, name==slot, is_build_server) can't
// pair every slot when Coolify's server names follow no convention AISHA
// recognises. Print the live server list so the operator can pick the right
// ${SLOT_UPPER}_HOSTNAME values rather than guessing UUIDs by hand.
//
// Hlásí se jen slot, který je POTŘEBA: build server, nebo slot V PROVOZU
// (lib/sloty-serveru.mjs — hostí aspoň jednu katalogovou službu s otevřenou
// lane). Volitelný slot bez své lane (GPU uzel `gpu` bez otevřené lane) nemá
// co hledat; hlásit ho by bylo varování bez vady na každé instanci bez GPU.
// Nezměřené „v provozu" se nehádá — pak se hlásí všechny, s poznámkou proč.
let potrebneNenamapovane = unmatchedSlots;
try {
  const vProvozu = new Set(slotyVProvozu({ servers: SLOT_DEFS }));
  potrebneNenamapovane = unmatchedSlots.filter(
    (s) => SLOT_DEFS[s]?.is_build_server === true || vProvozu.has(s),
  );
} catch (err) {
  process.stderr.write(
    `[generate-coolify-context] note: sloty v provozu NEZMĚŘENY (${String(err).slice(0, 160)}) — hlásím všechny nenamapované\n`,
  );
}
if (potrebneNenamapovane.length > 0 && coolifyServers.length > 1) {
  process.stderr.write(
    `[generate-coolify-context] unmatched slot(s): ${potrebneNenamapovane.join(', ')}. ` +
    `Set ${potrebneNenamapovane.map((s) => `${s.toUpperCase()}_HOSTNAME`).join('/')} in .env-prod-backup ` +
    `to one of the Coolify server names below (matched case-insensitively):\n`,
  );
  for (const s of coolifyServers) {
    process.stderr.write(
      `[generate-coolify-context]   - ${s?.name ?? '?'} (uuid=${(s?.uuid ?? '').slice(0, 8)}…, ip=${s?.ip ?? '?'}` +
      `${s?.description ? `, "${s.description}"` : ''})\n`,
    );
  }
}

// ── Write to stdout (caller eval's it) ───────────────────────────────────────
process.stdout.write(lines.join('\n') + '\n');

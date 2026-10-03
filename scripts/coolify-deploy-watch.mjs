#!/usr/bin/env node
/**
 * coolify-deploy-watch.mjs - read-only Coolify deploy + health radar.
 *
 * Usage:
 *   node scripts/coolify-deploy-watch.mjs
 *   node scripts/coolify-deploy-watch.mjs --watch
 *   node scripts/coolify-deploy-watch.mjs --wait --wait-healthy
 *   node scripts/coolify-deploy-watch.mjs --json --once
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as dnsLookupCb } from "node:dns";
import { promisify } from "node:util";
import { createProjectScope, resolveProjectName } from "./lib/coolify-project-scope.mjs";
import { klasifikovatStavAppky } from "./lib/coolify-app-status.mjs";
import { isDirectRun } from "./lib/cli-entry.mjs";
import { porovnej } from "./lib/razeni.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const flag = (name) => argv.includes(name);
const arg = (name, fallback = "") => {
  const match = argv.find((value) => value.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
};

// ⛔ Nápověda taky KONČÍ PROCES, takže patří za stráž vstupního bodu — jinak
// by ji spustil i pouhý import, kdyby se `--help` náhodou ocitlo v argv
// běžícího testovacího běhce.
if (isDirectRun(import.meta.url) && (flag("--help") || flag("-h"))) {
  console.log(`Coolify deploy watch (read-only)

Usage:
  node scripts/coolify-deploy-watch.mjs [options]

Options:
  --watch              Refresh until Ctrl-C
  --wait               Wait until no active deployments remain
  --wait-healthy       With --wait, also wait until health probes pass
  --interval-s=10      Refresh interval for --watch/--wait
  --timeout-s=1800     Max wait time for --wait
  --prefix=aisha       Coolify app prefix
  --only=core,netbird  Filter apps by short or full name
  --no-health          Skip public endpoint probes
  --strict             Exit non-zero on failed deploys or health failures
  --json               Machine-readable output
  --no-clear           Do not clear terminal between watch refreshes
`);
  process.exit(0);
}

const WATCH = flag("--watch");
const WAIT = flag("--wait");
const WAIT_HEALTHY = flag("--wait-healthy");
const JSON_OUTPUT = flag("--json");
const HEALTH_ENABLED = !flag("--no-health");
const STRICT = flag("--strict");
const NO_CLEAR = flag("--no-clear");
// ⚠️ ŽÁDNÝ default na "aisha": prefix filtruje, ČÍ nasazení se sleduje.
// Pořadí APP_NAME_PREFIX→AISHA_STORY je deklarované v lib/coolify-project-scope.mjs; neopisuje se.
const PREFIX = arg("--prefix", resolveProjectName());
const ONLY = arg("--only", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const INTERVAL_MS = Number(arg("--interval-s", "10")) * 1000;
// Absolutní strop je POJISTKA proti nekonečnu, ne rozpočet na práci — proto je
// velkorysý. O tom, jestli se ještě čeká, rozhoduje STÁNÍ (--stall-s) níž.
const WAIT_TIMEOUT_MS = Number(arg("--timeout-s", "10800")) * 1000;
// Jak dlouho se nesmí NIC pohnout, aby to čekání vzdalo. Sériové nasazení
// těžkého stacku trvá minuty, takže tohle musí být znatelně víc než jedno.
const STALL_TIMEOUT_MS = Number(arg("--stall-s", "900")) * 1000;
const API_TIMEOUT_MS = Number(arg("--api-timeout-ms", "30000"));
const HEALTH_TIMEOUT_MS = Number(arg("--health-timeout-ms", "10000"));
const DEPLOYMENT_LIMIT = Number(arg("--deployments", "100"));

const dnsLookup = promisify(dnsLookupCb);

const tty = process.stdout.isTTY && process.env.NO_COLOR !== "1";
const color = (code, value) => (tty ? `\x1b[${code}m${value}\x1b[0m` : value);
const C = {
  bold: (value) => color(1, value),
  dim: (value) => color(2, value),
  red: (value) => color(31, value),
  green: (value) => color(32, value),
  yellow: (value) => color(33, value),
  blue: (value) => color(34, value),
  cyan: (value) => color(36, value),
};

function parseEnvLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const comment = value.indexOf(" #");
    if (comment >= 0) value = value.slice(0, comment).trim();
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

function loadEnvFile(filePath, env) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(rawLine);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (value && (!env[key] || String(env[key]).includes("${"))) env[key] = value;
  }
}

function loadEnv() {
  const env = {};
  loadEnvFile(resolve(ROOT, "config/domains.env"), env);
  loadEnvFile(resolve(ROOT, ".env.coolify"), env);
  loadEnvFile(resolve(ROOT, ".env.local"), env);
  loadEnvFile(resolve(ROOT, ".env-prod-backup"), env);
  loadEnvFile(resolve(ROOT, ".env.aisha"), env);
  Object.assign(env, process.env);

  for (let pass = 0; pass < 4; pass += 1) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") continue;
      env[key] = value.replace(/\$\{([A-Z_][A-Z0-9_]*)(:-([^}]*))?\}/g, (_all, name, _fallbackExpr, fallback) => {
        const replacement = env[name] || "";
        if (name === key && replacement === value) return fallback || "";
        if (String(replacement).includes("${")) return fallback || "";
        return replacement || fallback || "";
      });
    }
  }
  return env;
}

const env = loadEnv();
const token = (env.COOLIFY_API_TOKEN || env.COOLIFY_API_KEY || "").replace(/^['"]|['"]$/g, "");

/**
 * Chybějící vstupy se hlásí, až když nástroj BĚŽÍ — ne při importu.
 *
 * ⛔ NAMĚŘENO 2026-08-27: tyhle stráže stály v modulovém rozsahu a volaly
 * `process.exit(2)`. Lokálně to nikdo nepoznal (`.env.coolify` existuje), ale
 * v CI ten soubor NENÍ — a protože bránu `cekani-meri-vlastni-svet` čisté
 * funkce z tohohle modulu importuje, shodil se jí CELÝ SOUBOR:
 *     Error: process.exit unexpectedly called with "2"
 * Test tedy nespadl na tvrzení, ale na NAČTENÍ — a to vypadá jako vada měřeného
 * kódu, ne měřidla. Táž třída jako u `coolify-pull-envs.mjs` (2026-08-26);
 * opakoval jsem ji v týž den v jiném souboru.
 *
 * Stráž nemizí, jen se přesouvá tam, kde na ni dojde: modul jde naimportovat,
 * spustit se bez pověření pořád nedá.
 */
function overVstupy() {
  if (!PREFIX) {
    console.error("FATAL: APP_NAME_PREFIX ani AISHA_STORY nejsou nastavené — nevím, KTERÉ nasazení mám sledovat.");
    process.exit(2);
  }
  if (!token) {
    console.error("FATAL: COOLIFY_API_TOKEN missing (env or .env-prod-backup)");
    process.exit(2);
  }
  if (!API_BASE) {
    console.error("FATAL: COOLIFY_URL/COOLIFY_BASE_URL/COOLIFY_API required");
    process.exit(2);
  }
}

function resolveApiBase() {
  const direct = env.COOLIFY_API_URL || env.COOLIFY_API;
  if (direct) return direct.replace(/\/+$/, "");
  const base = env.COOLIFY_BASE_URL || env.COOLIFY_URL;
  // Prázdno se NEmlčí — ohlásí ho `overVstupy()` při spuštění. Tady se jen
  // vrací, aby šel modul naimportovat (viz komentář u `overVstupy`).
  if (!base) return "";
  const clean = base.replace(/\/+$/, "");
  return clean.endsWith("/api/v1") ? clean : `${clean}/api/v1`;
}

const API_BASE = resolveApiBase();

function parseJson(text) {
  const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  if (!clean.trim()) return null;
  try {
    return JSON.parse(clean);
  } catch {
    return clean;
  }
}

async function coolify(path, { timeoutMs = API_TIMEOUT_MS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      const body = parseJson(text);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${path}`);
        error.status = response.status;
        error.body = typeof body === "string" ? body.slice(0, 200) : body;
        if (response.status >= 500 || response.status === 429) {
          lastError = error;
          await sleep(attempt * 2000);
          continue;
        }
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      const transient = error?.name === "TimeoutError" || /aborted|timeout|fetch failed|ECONNRESET/i.test(String(error));
      if (attempt < 3 && transient) {
        await sleep(attempt * 2000);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function selectedApp(app) {
  if (!app.name?.startsWith(`${PREFIX}-`)) return false;
  if (ONLY.length === 0) return true;
  const shortName = app.name.slice(PREFIX.length + 1);
  return ONLY.includes(app.name) || ONLY.includes(shortName);
}

// ⛔ NAMĚŘENO 2026-09-13 (GET /api/v1/applications): `aisha-registry` nesou DVĚ
// aplikace — cizí v projektu a1sh4 a naše v projektu aisha. Výběr podle prefixu
// jména nad globálním seznamem by `--only=registry` sledoval OBĚ a verdikt
// `--strict` by zahrnul stav cizího nájemníka (falešně červené i zelené).
// Rozsah proto dává projekt instance (jediný domov hranice); prefix zůstává jen
// druhým sítem uvnitř něj. Nezjištěný projekt HÁZE — sledovat „něčí" nasazení
// není měření.
let _rozsahProjektu = null;
async function fetchApps() {
  _rozsahProjektu ||= await createProjectScope(coolify);
  const apps = await coolify("/applications");
  if (!Array.isArray(apps)) throw new Error("Coolify /applications did not return an array");
  return apps
    .filter(_rozsahProjektu.inProject)
    .filter(selectedApp)
    .map((app) => ({
      name: app.name || "unknown",
      uuid: app.uuid || app.id || "",
      status: app.status || "unknown",
      last_online_at: app.last_online_at || "",
      server_uuid: app.server_uuid || "",
    }))
    .sort((left, right) => porovnej(left.name, right.name));
}

function deploymentList(body) {
  if (Array.isArray(body?.deployments)) return body.deployments;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body)) return body;
  // ⛔ NAMĚŘENO 2026-08-27 (POTŘETÍ tatáž past): Coolify vrací `/deployments`
  // jako OBJEKT S ČÍSELNÝMI KLÍČI (`{0:…,1:…}`, PHP-serializované pole), ne
  // jako JSON pole. Všechny tři větve výš minou a vrátí se `[]` — takže
  // měřidlo hlásilo `0 active` a u KAŽDÉ appky `none`, ať se dělo cokoli.
  // Prázdný seznam vypadá k nerozeznání od klidné fronty.
  //
  // Naměřeno na běžícím nasazení: syrové `/deployments` mělo
  // `<fork>-domain-services in_progress`, měřidlo tvrdilo `deploys 0 active`.
  // `lib/coolify-http.mjs::readDeploymentQueue` tenhle tvar ošetřuje —
  // tady chyběl vlastní kopii.
  if (body && typeof body === "object") {
    const polozky = Object.values(body).filter((x) => x && typeof x === "object" && !Array.isArray(x));
    if (polozky.length > 0) return polozky;
  }
  return [];
}

function normalizeDeployment(raw) {
  const id = raw?.deployment_uuid || raw?.uuid || raw?.id || "";
  const status = raw?.status || raw?.deployment_status || raw?.state || "unknown";
  return {
    id,
    status,
    active: isActiveDeployment(status),
    app_uuid: raw?.application_uuid || raw?.app_uuid || raw?.resource_uuid || raw?.application?.uuid || raw?.resource?.uuid || "",
    // Coolify 4.3 active-deployment rows use `server_name` for the application
    // display name (despite the field containing e.g. "aisha-core"). Older
    // versions use application_name/resource_name. Missing this alias made an
    // active global queue look empty because no deployment matched its app.
    app_name: raw?.application_name || raw?.app_name || raw?.resource_name || raw?.server_name || raw?.application?.name || raw?.resource?.name || "",
    created_at: raw?.created_at || raw?.createdAt || raw?.queued_at || "",
    updated_at: raw?.updated_at || raw?.updatedAt || raw?.finished_at || raw?.completed_at || "",
    commit: raw?.commit || raw?.git_commit_sha || raw?.commit_sha || "",
  };
}

async function fetchGlobalDeployments() {
  const paths = [
    `/deployments?per_page=${DEPLOYMENT_LIMIT}`,
    "/deployments",
  ];
  let lastError;
  for (const path of paths) {
    try {
      return deploymentList(await coolify(path)).map(normalizeDeployment);
    } catch (error) {
      lastError = error;
    }
  }
  return [{ id: "", status: `ERR:${lastError?.message || "deployments"}`, active: false }];
}

function deploymentMatchesApp(deployment, app) {
  return (
    (deployment.app_uuid && deployment.app_uuid === app.uuid) ||
    (deployment.app_name && deployment.app_name === app.name)
  );
}

function terminalDeploymentStatus(status) {
  return ["finished", "success", "succeeded", "failed", "cancelled", "canceled", "skipped"].includes(
    String(status || "").toLowerCase(),
  );
}

function failedDeploymentStatus(status) {
  return ["failed", "cancelled", "canceled", "error"].includes(String(status || "").toLowerCase());
}

function isActiveDeployment(status) {
  const normalized = String(status || "").toLowerCase();
  if (!normalized || normalized === "none" || normalized === "unknown") return false;
  return !terminalDeploymentStatus(normalized) && !normalized.startsWith("err:");
}

// ⛔ NAMĚŘENO 2026-08-17: pořadí testů tady bylo fail-open. `running:unhealthy`
// se chytlo na `startsWith("running")` DŘÍV, než se došlo k `includes("unhealthy")`,
// takže skončilo ve třídě `running` — a sumarizace ji počítá mezi `healthy_apps`.
// Aplikace, které běží a neprocházejí healthcheckem, se tak hlásily jako v pořádku.
// Verdikt teď dává primitiv nad CELÝMI hodnotami; tahle funkce už jen převádí
// jeho třídu na jméno, které umí obarvit displej.
function appStatusClass(status) {
  const { trida, segmenty } = klasifikovatStavAppky(status);
  switch (trida) {
    case "zdrava":
      return "healthy";
    case "bez-healthchecku":
      return "running";
    case "startuje":
      // Displej rozlišuje první start od restartu — ta informace je v segmentu.
      return segmenty.some((s) => s.toLowerCase().startsWith("restarting")) ? "restarting" : "starting";
    case "nezdrava":
      return "unhealthy";
    case "mrtva":
      return "bad";
    default:
      return "unknown";
  }
}

function statusColor(value, status) {
  const cls = appStatusClass(status);
  if (cls === "healthy" || cls === "running") return C.green(value);
  if (cls === "starting") return C.cyan(value);
  if (cls === "restarting" || cls === "unhealthy") return C.yellow(value);
  if (cls === "bad") return C.red(value);
  return C.dim(value);
}

function deployColor(value, status) {
  if (isActiveDeployment(status)) return C.blue(value);
  if (failedDeploymentStatus(status)) return C.red(value);
  if (String(status || "").toLowerCase() === "finished") return C.green(value);
  return C.dim(value);
}

function healthColor(value, summary) {
  if (summary.total === 0) return C.dim(value);
  if (summary.failed > 0) return C.red(value);
  return C.green(value);
}

function shortId(id) {
  return id ? id.slice(0, 8) : "-";
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width - 1) + " " : text.padEnd(width);
}

function ago(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function https(domain, path = "/") {
  if (!domain || String(domain).includes("${")) return "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${domain}${cleanPath}`;
}

function healthChecksForEnv() {
  const realm = env.KEYCLOAK_REALM || "aisha";
  // Prefer public *.${PUBLIC_TLD} domains routed through the edge-proxy (web stack).
  // Internal *.backend.${INTERNAL_TLD} hosts sit behind Coolify Traefik and typically
  // return 404 on /health because Traefik path-prefix matching differs.
  const apiPublic = env.API_DOMAIN_PUBLIC || env.API_DOMAIN;
  const appPublic = env.APP_DOMAIN || env.DIRIGENT_DOMAIN;
  const dirigentDomain = env.DIRIGENT_DOMAIN || env.APP_DOMAIN;
  const mcpDomain = env.MCP_DOMAIN;
  const n8nPublic = env.N8N_DOMAIN_PUBLIC ||
    (env.N8N_WEBHOOK_URL ? env.N8N_WEBHOOK_URL.replace(/^https?:\/\//, "").replace(/\/$/, "") : "") ||
    env.N8N_DOMAIN;
  const keycloakPublicDomain =
    env.KEYCLOAK_DOMAIN_PUBLIC ||
    env.AUTH_DOMAIN_PUBLIC ||
    env.KEYCLOAK_DOMAIN;

  const candidates = [
    // Edge proxy hosts (web stack): every public *.${PUBLIC_TLD} goes here first
    { app: `${PREFIX}-edge`, name: "web", url: https(appPublic, "/"), expect: [200, 301, 302] },
    { app: `${PREFIX}-edge`, name: "dirigent", url: https(dirigentDomain, "/"), expect: [200, 301, 302] },
    { app: `${PREFIX}-edge`, name: "api-public", url: https(apiPublic, "/health"), expect: [200] },
    { app: `${PREFIX}-edge`, name: "mcp-public", url: https(mcpDomain, "/health"), expect: [200, 401, 404] },
    // Backend services (Coolify Traefik directly)
    { app: `${PREFIX}-core`, name: "gateway", url: https(env.API_DOMAIN, "/health"), expect: [200] },
    { app: `${PREFIX}-core`, name: "postgrest", url: https(env.API_DOMAIN, "/rest/v1/"), expect: [200] },
    { app: `${PREFIX}-keycloak`, name: "kc-public-oidc", url: https(keycloakPublicDomain, `/realms/${realm}/.well-known/openid-configuration`), expect: [200] },
    { app: `${PREFIX}-keycloak`, name: "kc-backend-health", url: https(env.KEYCLOAK_DOMAIN, "/health"), expect: [200] },
    { app: `${PREFIX}-observability`, name: "langfuse", url: https(env.LANGFUSE_DOMAIN, "/api/public/health"), expect: [200] },
    { app: `${PREFIX}-orchestration`, name: "n8n", url: https(n8nPublic, "/healthz"), expect: [200] },
    { app: `${PREFIX}-admin`, name: "nocodb", url: https(env.NOCODB_DOMAIN, "/"), expect: [200, 302] },
    { app: `${PREFIX}-admin`, name: "appsmith", url: https(env.APPSMITH_DOMAIN, "/"), expect: [200, 302] },
    { app: `${PREFIX}-pki`, name: "pki", url: https(env.PKI_DOMAIN, "/"), expect: [200, 302] },
    { app: `${PREFIX}-netbird`, name: "netbird", url: https(env.NETBIRD_DOMAIN, "/"), expect: [200] },
    { app: `${PREFIX}-registry`, name: "registry", url: https(env.REGISTRY_DOMAIN, "/v2/"), expect: [200, 401] },
    { app: `${PREFIX}-messaging`, name: "matrix", url: https(env.MATRIX_DOMAIN, "/_matrix/client/versions"), expect: [200] },
  ];
  return candidates.filter((check) => check.url && check.url !== "https:///");
}

/**
 * Je ta adresa vidět ODSUD?
 *
 * ⛔ NAMĚŘENO 2026-08-26: 11 z 16 sond míří na `*.${MESH_TLD}` — jména, která
 * z principu existují jen UVNITŘ meshe. Operátorský stroj ani CI runner v ní
 * nejsou, takže `--wait-healthy` čekal na podmínku, která nemohla nastat, a
 * spálil 90 minut na běhu, kde bylo všechno v pořádku. `deploy-and-verify.sh`
 * si tuhle vadu zapsal už 2026-08-08 a vyřešil ji tím, že sondy odtud
 * NESPOUŠTÍ — druhý volající ten poznatek nikdy nedostal.
 *
 * Nestačí ale mesh sondy prostě vynechat: kdyby watch běžel NA peeru meshe,
 * měřitelné jsou. Proto se to MĚŘÍ, ne předpokládá — a rozlišovačem je
 * překlad jména. Že jméno neexistuje, se u `.internal` nedá splést s výpadkem
 * wildcard DNS (žádný tam není).
 *
 * ⛔ Podmínka je ZDVOJENÁ schválně: „nepřeloží se" samo o sobě by z výpadku
 * DNS u VEŘEJNÉHO jména udělalo tiché zelené. Neměřitelné je jen jméno, které
 * je mesh-vnitřní A zároveň se odsud nepřeloží.
 */
async function jeVidetOdsud(check) {
  const meshTld = (env.MESH_TLD || "").trim();
  // ⛔ Bez `try/catch`: fail-open `return true` v catch bloku je vada sama o
  // sobě (brána silent-degradation ji chytila na tomhle řádku). `URL.parse`
  // vrací null místo výjimky, takže se rozhoduje podle HODNOTY, ne podle toho,
  // že něco spadlo. Nečitelná adresa NENÍ mesh jméno — sonda ji změří a chybu
  // ohlásí sama; tady se nesmí umlčet.
  const hostname = URL.parse(check.url)?.hostname ?? "";
  if (!hostname) return true;
  if (!meshTld || !(hostname === meshTld || hostname.endsWith(`.${meshTld}`))) return true;
  try {
    await dnsLookup(hostname);
    return true; // jsme v meshi (nebo jméno jde přeložit) → sonda měří
  } catch {
    return false;
  }
}

async function probeHealth(check) {
  if (!(await jeVidetOdsud(check))) {
    // Třetí stav. NENÍ to `pass` (nic se neověřilo) a NENÍ to `fail`
    // (služba za to nemůže) — obojí by lhalo.
    return { ...check, code: 0, pass: false, merit: false, error: "mimo dosah odsud" };
  }
  try {
    const response = await fetch(check.url, {
      redirect: "manual",
      headers: { "User-Agent": "aisha-coolify-deploy-watch/1" },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return {
      ...check,
      code: response.status,
      pass: check.expect.includes(response.status),
      merit: true,
    };
  } catch (error) {
    return {
      ...check,
      code: 0,
      pass: false,
      merit: true,
      error: error?.name === "TimeoutError" ? "timeout" : String(error?.message || error).slice(0, 100),
    };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function summarizeHealth(results) {
  // Sonda mimo dosah se do sloupce HEALTH nepočítá ani jako ok, ani jako fail —
  // jinak by appka, na kterou odsud není vidět, vypadala jako rozbitá.
  const meritelne = results.filter((result) => result.merit !== false);
  const total = meritelne.length;
  const passed = meritelne.filter((result) => result.pass).length;
  return { total, passed, failed: total - passed, mimoDosah: results.length - total };
}

/**
 * Souhrn snímku — ČISTÁ funkce, aby se dala měřit bez sítě.
 *
 * Univerzum verdiktu se musí krýt s univerzem tabulky: `rows` jsou appky ve
 * scope, a `active_deployments` se počítá JEN z nasazení, která k nim patří.
 *
 * @param {{rows: any[], globalDeployments: any[], healthResults: any[]}} vstup
 */
export function spoctiSouhrn({ rows, globalDeployments, healthResults }) {
  // Nasazení, která patří NAŠIM appkám. Přiřazuje se přes `deploymentMatchesApp`
  // (uuid nebo jméno) — totéž pravidlo, jakým se plní sloupec DEPLOY v tabulce.
  const scopedDeployments = globalDeployments.filter((deployment) =>
    rows.some((row) => deploymentMatchesApp(deployment, row)),
  );
    return {
      total_apps: rows.length,
      healthy_apps: rows.filter((row) => ["healthy", "running"].includes(row.status_class)).length,
      pending_apps: rows.filter((row) => ["starting", "restarting", "unhealthy"].includes(row.status_class)).length,
      bad_apps: rows.filter((row) => row.status_class === "bad").length,
      // ⛔ NAMĚŘENO 2026-08-26: tady stálo `globalDeployments.filter(...)` — tedy
      // CELÁ fronta Coolify, ne jen `--prefix`/`--only`. Tabulka appek scoped
      // BYLA, podmínka konce ne. Watch tak čekal na nasazení CIZÍCH nájemníků
      // (`asar-static-server`, `<fork>-mechanic`, `<fork>-keycloak`) —
      // včetně druhého cold-startu, který běžel vedle. Dva běhy čekaly jeden na
      // druhý. Univerzum měřidla musí být totéž jako univerzum jeho verdiktu.
      active_deployments: scopedDeployments.filter((deployment) => deployment.active).length,
      cizi_aktivni_nasazeni: globalDeployments.filter(
        (deployment) => deployment.active && !scopedDeployments.includes(deployment),
      ).length,
      failed_latest_deployments: rows.filter((row) => failedDeploymentStatus(row.latest_deployment?.status)).length,
      // Sonda mimo dosah se NEPOČÍTÁ do `health_failed`: `--wait-healthy` by pak
      // čekal na podmínku, kterou z tohohle stanoviště nelze splnit.
      health_total: healthResults.filter((result) => result.merit).length,
      health_passed: healthResults.filter((result) => result.merit && result.pass).length,
      health_failed: healthResults.filter((result) => result.merit && !result.pass).length,
      health_unmeasurable: healthResults.filter((result) => !result.merit).length,
    };
}

async function collectSnapshot() {
  const observedAt = new Date().toISOString();
  const apps = await fetchApps();
  const appNames = new Set(apps.map((app) => app.name));
  const globalDeployments = await fetchGlobalDeployments();
  const deploymentsByApp = new Map();
  for (const app of apps) {
    deploymentsByApp.set(app.name, globalDeployments.filter((deployment) => deploymentMatchesApp(deployment, app)));
  }
  const unmatchedDeployments = globalDeployments.filter(
    (deployment) => deployment.active && !apps.some((app) => deploymentMatchesApp(deployment, app)),
  );

  let healthByApp = new Map(apps.map((app) => [app.name, []]));
  let healthResults = [];
  if (HEALTH_ENABLED) {
    const checks = healthChecksForEnv().filter((check) => appNames.has(check.app));
    healthResults = await mapLimit(checks, 8, probeHealth);
    healthByApp = new Map(apps.map((app) => [app.name, []]));
    for (const result of healthResults) {
      healthByApp.get(result.app)?.push(result);
    }
  }

  const rows = apps.map((app) => {
    const deployments = deploymentsByApp.get(app.name) || [];
    const latestDeployment = deployments[0] || null;
    const activeDeployment = deployments.find((deployment) => deployment.active) || null;
    const health = healthByApp.get(app.name) || [];
    return {
      ...app,
      status_class: appStatusClass(app.status),
      deployments,
      latest_deployment: latestDeployment,
      active_deployment: activeDeployment,
      health,
      health_summary: summarizeHealth(health),
    };
  });

  const summary = spoctiSouhrn({ rows, globalDeployments, healthResults });

  return {
    observed_at: observedAt,
    coolify_api: API_BASE,
    prefix: PREFIX,
    rows,
    unmatched_deployments: unmatchedDeployments,
    health_results: healthResults,
    summary,
  };
}

function deploymentLabel(row) {
  const deployment = row.active_deployment || row.latest_deployment;
  if (!deployment) return "none";
  return `${deployment.status}:${shortId(deployment.id)}`;
}

function healthLabel(summary) {
  if (!HEALTH_ENABLED) return "off";
  if (summary.total === 0) return "n/a";
  return summary.failed === 0 ? `ok ${summary.passed}/${summary.total}` : `fail ${summary.passed}/${summary.total}`;
}

function printSnapshot(snapshot) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(snapshot, null, WATCH || WAIT ? 0 : 2));
    return;
  }

  if ((WATCH || WAIT) && tty && !NO_CLEAR) {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  console.log(C.bold("AISHA Coolify deploy watch"));
  console.log(`${C.dim("Observed:")} ${snapshot.observed_at}`);
  console.log(`${C.dim("Coolify:")}  ${snapshot.coolify_api.replace(/\/api\/v1$/, "")}`);
  console.log(`${C.dim("Scope:")}    ${PREFIX}-*${ONLY.length ? ` (${ONLY.join(",")})` : ""}`);
  console.log("");
  console.log(`${pad("APP", 24)} ${pad("COOLIFY", 22)} ${pad("DEPLOY", 20)} ${pad("HEALTH", 14)} LAST_ONLINE UUID`);
  console.log("-".repeat(105));
  for (const row of snapshot.rows) {
    const appStatus = statusColor(pad(row.status, 22), row.status);
    const deployment = row.active_deployment || row.latest_deployment;
    const deploy = deployColor(pad(deploymentLabel(row), 20), deployment?.status || "none");
    const healthSummary = row.health_summary;
    const health = healthColor(pad(healthLabel(healthSummary), 14), healthSummary);
    console.log(`${pad(row.name, 24)} ${appStatus} ${deploy} ${health} ${pad(ago(row.last_online_at), 11)} ${shortId(row.uuid)}`);
  }
  console.log("");

  const summary = snapshot.summary;
  console.log(
    `Summary: apps ${summary.healthy_apps}/${summary.total_apps} running, ` +
      `${summary.pending_apps} pending, ${summary.bad_apps} bad | ` +
      `deploys ${summary.active_deployments} active, ${summary.failed_latest_deployments} latest failed | ` +
      `health ${summary.health_passed}/${summary.health_total} ok` +
      (summary.health_unmeasurable ? `, ${summary.health_unmeasurable} mimo dosah odsud` : "") +
      (summary.cizi_aktivni_nasazeni ? ` | ${summary.cizi_aktivni_nasazeni} cizí nasazení (nečeká se na ně)` : ""),
  );

  const active = snapshot.rows.filter((row) => row.active_deployment);
  const unmatchedActive = snapshot.unmatched_deployments || [];
  if (active.length > 0 || unmatchedActive.length > 0) {
    console.log("\nActive deployments:");
    for (const row of active) {
      const deployment = row.active_deployment;
      console.log(`  ${row.name.padEnd(24)} ${deployment.status.padEnd(14)} ${deployment.id || "-"}`);
    }
    for (const deployment of unmatchedActive) {
      const label = deployment.app_name || deployment.app_uuid || "unmatched";
      console.log(`  ${label.padEnd(24)} ${deployment.status.padEnd(14)} ${deployment.id || "-"}`);
    }
  }

  const failed = snapshot.rows.filter((row) => failedDeploymentStatus(row.latest_deployment?.status));
  if (failed.length > 0) {
    console.log("\nLatest failed/cancelled deployments:");
    for (const row of failed) {
      const deployment = row.latest_deployment;
      console.log(`  ${row.name.padEnd(24)} ${deployment.status.padEnd(14)} ${deployment.id || "-"}`);
    }
  }

  const radekSondy = (result) => {
    const got = result.error ? `ERR:${result.error}` : `HTTP ${result.code}`;
    console.log(`  ${result.app.padEnd(24)} ${result.name.padEnd(18)} ${got.padEnd(16)} ${result.url}`);
  };

  // Vada a „nevidím tam odsud" jsou DVĚ RŮZNÉ VĚCI a nesmí stát pod jedním
  // nadpisem: smíchané vypadá 11 nedosažitelných jmen jako 11 rozbitých služeb
  // a operátor začne hledat poruchu, která není.
  const failedHealth = snapshot.health_results.filter((result) => result.merit !== false && !result.pass);
  if (failedHealth.length > 0) {
    console.log("\nHealth failures:");
    for (const result of failedHealth) radekSondy(result);
  }

  const mimoDosah = snapshot.health_results.filter((result) => result.merit === false);
  if (mimoDosah.length > 0) {
    console.log(
      `\nMimo dosah z tohohle stanoviště (${mimoDosah.length}) — vnitřní jména meshe;` +
        ` NEJDE o poruchu, jen se odsud nedají změřit:`,
    );
    for (const result of mimoDosah) radekSondy(result);
  }

  if (WATCH || WAIT) {
    console.log(`\nRefresh: ${INTERVAL_MS / 1000}s${WAIT ? ` | wait timeout: ${WAIT_TIMEOUT_MS / 1000}s` : ""} | Ctrl-C to stop`);
  }
}

/**
 * Hnulo se od minule něco SKUTEČNÉHO? — čistá funkce, aby šla měřit.
 *
 * ⛔ NAMĚŘENO 2026-08-26: dřív se tu pokrok poznával jako „JAKÁKOLI změna
 * otisku" složeného mimo jiné ze zdravotních počtů. Jedna sonda, která kmitala
 * mezi ok a chybou, tím resetovala 900s pojistku donekonečna — watch stál
 * 90 minut na stavu, který se nehnul (29/33 běžících, 4 bad, health 5/16),
 * a hlásil to jako práci. Pojistka proti nekonečnu byla navržená na TICHO,
 * ne na ŠUM; kmitající sonda je horší než mrtvá, protože mrtvá by ji spustila.
 *
 * Pokrok je proto MONOTÓNNÍ: buď ubylo nedodělků (nové minimum), nebo se
 * změnila MNOŽINA běžících nasazení (nasazení doběhlo či začalo). Kmit nahoru
 * a zpátky nové minimum nevyrobí, takže pojistka doběhne.
 *
 * ⛔ Vstupní a výstupní tvar stavu je ZÁMĚRNĚ TÝŽ (`{nejmensiZbyva, otisk}`),
 * aby se výsledek dal beze změny vrátit do dalšího kola. Když se ty dva tvary
 * lišily (`posledniOtisk` na vstupu × `otisk` na výstupu), vycházelo z porovnání
 * `"" !== undefined` a funkce hlásila pokrok VŽDY — tedy přesně ta vada, proti
 * které je psaná. Chytila to brána `cekani-meri-vlastni-svet` hned napoprvé.
 *
 * @param {{summary: any, rows: any[]}} snimek
 * @param {{nejmensiZbyva: number, otisk: string}} stav
 * @returns {{pokrok: boolean, nejmensiZbyva: number, otisk: string}}
 */
export function vyhodnotPokrok(snimek, { nejmensiZbyva, otisk: predchoziOtisk }) {
  const s = snimek.summary;
  const zbyva =
    s.active_deployments + s.pending_apps + s.bad_apps + s.health_failed + s.failed_latest_deployments;
  const otisk = (snimek.rows || [])
    .map((row) => row.active_deployment?.id || "")
    .filter(Boolean)
    .sort()
    .join(",");
  const noveMinimum = zbyva < nejmensiZbyva;
  return {
    pokrok: noveMinimum || otisk !== predchoziOtisk,
    nejmensiZbyva: noveMinimum ? zbyva : nejmensiZbyva,
    otisk,
  };
}

function snapshotHasFailure(snapshot) {
  return snapshot.summary.failed_latest_deployments > 0 || snapshot.summary.bad_apps > 0 || snapshot.summary.health_failed > 0;
}

async function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  overVstupy();
  const start = Date.now();
  let lastSnapshot = null;
  let poslednePohyb = Date.now();
  let posledniOtisk = "";
  let nejmensiZbyva = Infinity;
  while (true) {
    lastSnapshot = await collectSnapshot();
    printSnapshot(lastSnapshot);

    if (!WATCH && !WAIT) {
      process.exit(STRICT && snapshotHasFailure(lastSnapshot) ? 1 : 0);
    }

    if (WAIT) {
      const deploymentsDone = lastSnapshot.summary.active_deployments === 0;
      const healthDone = !WAIT_HEALTHY || lastSnapshot.summary.health_failed === 0;
      if (deploymentsDone && healthDone) {
        const failed = lastSnapshot.summary.failed_latest_deployments > 0;
        process.exit(failed ? 1 : 0);
      }

      // ⛔ ČEKÁ SE NA POKROK, NE NA HODINY.
      //
      // NAMĚŘENO 2026-08-26: fáze D cold-startu čekala pevných 900 s na
      // přenasazení 17 stacků. Coolify je ale zpracovává SÉRIOVĚ (2 souběžně,
      // minuty na kus), takže se do rozpočtu nevešly — čekání vypršelo, fáze D2
      // pustila `coolify-mesh-sync` do nehotové meshe a ta správně zastavila
      // („nevyřešen ANI JEDEN peer"). Celý běh spadl na tom, že měřidlo mělo
      // rozpočet v hodinách místo v POKROKU. Fronta přitom celou dobu jela.
      //
      // Pokrok = jakákoli změna v počtech (ubylo běžících nasazení, přibylo
      // zdravých, ubylo nezdravých). Dokud se něco hýbe, čeká se dál; vzdát se
      // smí jen tehdy, když se `--stall-s` nehnulo NIC. Absolutní strop zůstává
      // jako pojistka proti nekonečnu.
      // ⛔ NAMĚŘENO 2026-08-26: pokrok se tu poznával jako „JAKÁKOLI změna
      // otisku". Jedna sonda, která kmitala mezi ok a chybou, tím resetovala
      // 900s pojistku donekonečna — watch stál 90 minut na stavu, který se
      // nehnul (29/33, 4 bad, health 5/16), a hlásil to jako práci. Pojistka
      // proti nekonečnu byla navržená na TICHO, ne na ŠUM; kmitající sonda je
      // horší než mrtvá, protože mrtvá by ji spustila.
      //
      // Pokrok je proto MONOTÓNNÍ: buď ubylo nedodělků (nové minimum), nebo se
      // změnila MNOŽINA běžících nasazení (skutečný pohyb fronty — nasazení
      // doběhlo či začalo). Kmit nahoru a zpátky nové minimum nevyrobí.
      const stav = vyhodnotPokrok(lastSnapshot, { nejmensiZbyva, otisk: posledniOtisk });
      nejmensiZbyva = stav.nejmensiZbyva;
      posledniOtisk = stav.otisk;
      if (stav.pokrok) poslednePohyb = Date.now();
      const stojiMs = Date.now() - poslednePohyb;
      if (stojiMs > STALL_TIMEOUT_MS) {
        console.error(
          `\nStání: ${Math.round(STALL_TIMEOUT_MS / 1000)}s beze změny ` +
            `(${lastSnapshot.summary.active_deployments} nasazení běží, ` +
            `${lastSnapshot.summary.healthy_apps}/${lastSnapshot.summary.total_apps} zdravých). ` +
            `Celkem čekáno ${Math.round((Date.now() - start) / 60000)} min.`,
        );
        process.exit(2);
      }
      if (Date.now() - start > WAIT_TIMEOUT_MS) {
        console.error(
          `\nAbsolutní strop ${Math.round(WAIT_TIMEOUT_MS / 60000)} min vyčerpán ` +
            `(fronta se ještě hýbala před ${Math.round(stojiMs / 1000)}s).`,
        );
        process.exit(2);
      }
    }

    await sleep(INTERVAL_MS);
  }
}

// ⛔ NE `import.meta.url === \`file://${process.argv[1]}\``. Viz lib/cli-entry.mjs:
// řetězcové porovnání se rozejde na symlinku, worktree i diakritice a blok se
// TIŠE přeskočí. Bez strážce navíc nejde modul naimportovat v testu — import by
// spustil síťovou smyčku.
if (isDirectRun(import.meta.url)) main().catch((error) => {
  console.error(`FATAL: ${error.message}`);
  if (process.env.DEBUG) console.error(error);
  process.exit(2);
});

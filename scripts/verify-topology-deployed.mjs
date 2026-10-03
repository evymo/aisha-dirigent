#!/usr/bin/env node
/**
 * verify-topology-deployed.mjs — compare resolver output to actual Coolify env.
 *
 * Read-only operational verifier. Does NOT mutate anything.
 *
 * For each app in coolify/manifests/aisha.manifest:
 *  1. Reads its actual env from Coolify API (/applications/{uuid}/envs)
 *  2. Computes what the topology resolver SAYS it should have for the same
 *     profile + mesh state
 *  3. Reports drift: domains the resolver expects vs. what's actually set
 *
 * Why this matters:
 *   The resolver is now the primary path (AISHA_PROFILE=cloud-multi default).
 *   Operational drift — e.g. someone manually pinned a *_DOMAIN in Coolify UI
 *   that conflicts with the catalog — would silently break routing on the
 *   next deploy. This script makes drift visible.
 *
 * Run:
 *   node scripts/verify-topology-deployed.mjs
 *   node scripts/verify-topology-deployed.mjs --profile=cloud-multi
 *   node scripts/verify-topology-deployed.mjs --json     # machine-readable
 *   node scripts/verify-topology-deployed.mjs --strict   # exit 1 on drift
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENV_BACKUP = resolve(ROOT, ".env-prod-backup");
const DERIVE = resolve(ROOT, "scripts/lib/derive-domains.mjs");

const argv = process.argv.slice(2);
const arg = (n) => {
  const m = argv.find((a) => a.startsWith(n + "="));
  return m ? m.slice(n.length + 1) : null;
};
const flag = (n) => argv.includes(n);
// ⛔ Tady stálo `?? "cloud-multi"` — a je to MĚŘIDLO. Dosazený tvar by znamenal,
// že se nasazení porovnává proti topologii, kterou nikdo nezvolil: zelená by
// pak netvrdila „nasazení souhlasí", ale „souhlasí s něčím jiným".
// Třetí domov téže odpovědi (naměřeno 2026-08-22); ostatní dva už jsou pryč.
const PROFILE = arg("--profile") ?? (process.env.AISHA_PROFILE ?? "").trim();
if (!PROFILE) {
  console.error(
    "AISHA_PROFILE není deklarovaný a --profile nebyl předán — proti jakému TVARU\n" +
      "  nasazení se má měřit? Dosazený tvar by vydal zelenou nad cizí topologií.\n" +
      "  Deklaruj AISHA_PROFILE, nebo předej --profile=<id>.",
  );
  process.exit(1);
}
const STRICT = flag("--strict");
const JSON_OUT = flag("--json");

// ── Color helpers ────────────────────────────────────────────────────────────
const C = JSON_OUT
  ? { red: (s) => s, green: (s) => s, yellow: (s) => s, blue: (s) => s, dim: (s) => s, bold: (s) => s }
  : {
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      blue: (s) => `\x1b[34m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
    };
const log = (s) => { if (!JSON_OUT) console.log(s); };

// ── Coolify API ──────────────────────────────────────────────────────────────
function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  if (!existsSync(ENV_BACKUP)) {
    throw new Error(`COOLIFY_API_TOKEN not set and ${ENV_BACKUP} missing`);
  }
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN not found");
}

const TOKEN = loadToken();
const COOLIFY_URL = (() => {
  const v = process.env.COOLIFY_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_URL required\n"); process.exit(2); }
  return v;
})();
const API = `${COOLIFY_URL}/api/v1`;

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

// ── Run resolver, parse shell output ─────────────────────────────────────────
function getResolverEnv() {
  const out = execFileSync(
    "node",
    [DERIVE, `--profile=${PROFILE}`, "--shell"],
    { cwd: ROOT, encoding: "utf-8", env: { ...process.env, AISHA_PROFILE: PROFILE } },
  );
  const env = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    // Resolver hodnoty uvozuje (soubor se sourcuje — strukturované hodnoty
    // jako `<ID>_MESH_INGRESS_ROUTES` nesou `|` a `;`). Tady čteme hodnotu,
    // ne shell literál, takže okrajové uvozovky pryč.
    if (m) env[m[1]] = m[2].replace(/^'([\s\S]*)'$/, "$1").replaceAll(`'\\''`, "'");
  }
  return env;
}

// ── Map app names to their service catalog id ────────────────────────────────
// Coolify app names are `aisha-<id>`; manifest lists `<id>:<server>:<file>`.
// Jméno apky v Coolify je `<APP_NAME_PREFIX>-<id služby>`, takže id se ODVODÍ
// odloupnutím prefixu. Dřív tu byla mapa 13 jmen napsaných s `aisha-` natvrdo:
// na instanci s jiným prefixem nesedlo ANI JEDNO, filtr propustil nula apek a
// skript vypsal `0 ok, 0 drift` — zeleně vypadající výsledek z prázdného vstupu.
// Bez fallbacku: neznámá identita instance se musí ozvat, ne uhodnout.
function instancePrefix() {
  const p = (process.env.APP_NAME_PREFIX || "").trim();
  if (p) return p;
  throw new Error(
    "APP_NAME_PREFIX není nastaven — bez identity instance nelze určit, které apky " +
      "v Coolify patří téhle instalaci. Deklaruj ho (.env.coolify / prostředí); " +
      "odhad by měřil cizí instanci, nebo nic.",
  );
}

// Vars to verify per service. Each service should have its primary domain
// set on its app's Coolify env (propagated by scripts/coolify-deploy-init.sh).
// Vars that are merely consumed by compose with `${VAR:-default}` fallback
// (e.g. VITE_PUBLIC_SITE_URL build-time, APP_DOMAIN as docker_compose_domains
// only) aren't listed — the compose default IS the right value for cloud-multi.
const EXPECTED_VARS = {
  keycloak: ["KEYCLOAK_DOMAIN"],
  pki: ["PKI_DOMAIN"],
  orchestration: ["N8N_DOMAIN", "KEYCLOAK_DOMAIN"],
  observability: ["LANGFUSE_DOMAIN"],
  admin: ["NOCODB_DOMAIN", "APPSMITH_DOMAIN", "INTRANET_DOMAIN", "KEYCLOAK_DOMAIN"],
  messaging: ["MATRIX_DOMAIN", "ELEMENT_DOMAIN", "ELEMENT_CALL_DOMAIN"],
  integration: [],
  core: ["API_DOMAIN"],
  edge: ["MCP_DOMAIN", "DIRIGENT_DOMAIN", "API_DOMAIN_PUBLIC"],
  netbird: ["NETBIRD_DOMAIN"],
  registry: ["REGISTRY_DOMAIN"],
  ledger: [],
  exec: [],
};

// ── Main ─────────────────────────────────────────────────────────────────────
log(`\n${C.bold("verify-topology-deployed")} — drift between resolver and Coolify\n`);
log(`  profile: ${PROFILE}`);

const resolverEnv = getResolverEnv();
log(`  resolver: ${Object.keys(resolverEnv).filter((k) => k.endsWith("_DOMAIN")).length} domain vars\n`);

const apps = await api("/applications");
// Confine verification to OUR project's environments — another tenant's
// same-named aisha-* app on the shared host would otherwise pollute the
// topology check. Fail-loud without COOLIFY_PROJECT_UUID (no global fallback).
const scope = await createProjectScope(api);
const PREFIX = instancePrefix();
const aishaApps = apps.filter((a) => scope.inProject(a) && a.name?.startsWith(`${PREFIX}-`));
log(`  prefix instance: ${PREFIX}-`);
log(`  Coolify apps: ${aishaApps.length} found\n`);
// Nula apek NENÍ „vše v pořádku" — je to měřidlo bez vstupu. Ohlásit hlasitě,
// jinak by prázdný filtr prošel jako čistý výsledek.
if (aishaApps.length === 0) {
  log(`  ${C.red("✗")} Žádná apka s prefixem ${PREFIX}- v projektu — není co ověřovat.`);
  log(`  ${C.dim("(zkontroluj APP_NAME_PREFIX a COOLIFY_PROJECT_UUID; prázdný vstup není zelený výsledek)")}\n`);
  process.exit(2);
}

const issues = [];
const summary = { ok: 0, drift: 0, missing: 0, unknown: 0 };

for (const app of aishaApps) {
  const svcId = app.name.slice(PREFIX.length + 1);
  if (!(svcId in EXPECTED_VARS)) {
    // Vypsat JMÉNEM, ne jen započítat: apka, pro kterou tenhle skript nemá
    // očekávané proměnné, je nepokrytý kus instalace — a nepokryté místo se
    // musí dát přečíst, jinak se souhrn tváří jako úplný.
    log(`  ${C.dim("?")} ${app.name.padEnd(25)} ${C.dim("(EXPECTED_VARS pro '" + svcId + "' nedeklarováno — nekontrolováno)")}`);
    summary.unknown++;
    continue;
  }
  const expected = EXPECTED_VARS[svcId] ?? [];
  if (expected.length === 0) {
    log(`  ${C.dim("·")} ${app.name.padEnd(25)} ${C.dim("(no domain vars expected)")}`);
    summary.ok++;
    continue;
  }

  // Read actual env
  let envs;
  try {
    envs = await api(`/applications/${app.uuid}/envs`);
  } catch (e) {
    log(`  ${C.red("✗")} ${app.name.padEnd(25)} env fetch failed: ${e.message}`);
    issues.push({ app: app.name, kind: "fetch_error", message: e.message });
    summary.drift++;
    continue;
  }

  const actualEnv = {};
  for (const e of envs || []) actualEnv[e.key] = e.value;

  const localIssues = [];
  for (const key of expected) {
    const want = resolverEnv[key];
    const have = actualEnv[key];
    if (!want) {
      localIssues.push({ key, kind: "resolver_missing", want, have });
      continue;
    }
    if (!have) {
      localIssues.push({ key, kind: "app_missing", want, have });
      continue;
    }
    if (have !== want) {
      localIssues.push({ key, kind: "drift", want, have });
    }
  }

  if (localIssues.length === 0) {
    log(`  ${C.green("✓")} ${app.name.padEnd(25)} ${C.dim(`(${expected.length} vars ok)`)}`);
    summary.ok++;
  } else {
    log(`  ${C.yellow("⚠")} ${app.name.padEnd(25)} ${localIssues.length} issue(s):`);
    for (const i of localIssues) {
      const tag = i.kind === "drift" ? C.red("DRIFT")
        : i.kind === "app_missing" ? C.yellow("MISSING")
        : C.yellow("RESOLVER");
      log(`      ${tag} ${i.key}: resolver=${i.want ?? "(unset)"} | app=${i.have ?? "(unset)"}`);
      issues.push({ app: app.name, ...i });
    }
    summary.drift++;
  }
}

log(`\n  ${C.bold("Summary:")} ${C.green(summary.ok + " ok")}, ${C.yellow(summary.drift + " drift")}, ${C.dim(summary.unknown + " unknown apps")}\n`);

if (JSON_OUT) {
  console.log(JSON.stringify({ profile: PROFILE, summary, issues }, null, 2));
}

if (STRICT && summary.drift > 0) process.exit(1);
process.exit(0);

#!/usr/bin/env node
// =============================================================================
// local-compose-gen.mjs — "Local deploy" compose generator
// =============================================================================
// This is the local equivalent of production "story init + compose application"
// (coolify-story-init.sh + coolify-deploy-init.sh).
//
// It takes the *same* production sources:
//   - coolify/manifests/aisha.manifest
//   - docker-compose.coolify-*.yml
//
// and produces a runnable local docker-compose for the chosen apps/preset,
// using config from config/local-presets.mjs (which is the local deployment
// configuration — see comment there).
//
// The result (docker-compose.local.generated.json + written dev env) is the
// "deployed" state for local development.
//
// See config/local-presets.mjs for the full analogy to production deploy.
//
// Usage:
//   node scripts/local-compose-gen.mjs --preset minimum
//   node scripts/local-compose-gen.mjs --preset full-light --out custom.json
//   node scripts/local-compose-gen.mjs --apps core,keycloak --dry-run
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  presets,
  hostPorts,
  domainToHostPort,
  devEnvDefaults,
  stackDependencies,
  isExposedToHost,
  resolveExposedHostPorts,
  INSTANCE_PREFIX,
} from "../config/local-presets.mjs";
import { applyHostClientAuthFix, KC_CONTAINER } from "./lib/kc-host-auth.mjs";
import { parseUnsetVarWarnings } from "./lib/env-completeness.mjs";
import { nedorucene, popisNedorucenych, povinneSouboru } from "./lib/povinne-promenne.mjs";
import { namespaceContainerNames } from "./lib/container-namespacing.mjs";
import { collapseToLocalNetwork } from "./lib/container-namespacing.mjs";
import { LOCAL_STACK, LOCAL_STACK_PREFIX } from "./lib/local-stack-name.mjs";
import { findDiscoveryConsumersInStack, DISCOVERY_OIDC_CONSUMERS } from "./lib/oidc-consumer-support.mjs";
import { validateLocalStackEnv, CRITICAL_ENV_KEYS } from "./lib/local-env-assertions.mjs";
import { buildTopology, containerNameFrom } from "./lib/derive-domains.mjs";
import { neutralizeMeshRouteForLocal } from "./lib/local-mesh-route.mjs";
import { rewritePublicApiUrlsInEnv } from "./lib/local-api-upstream.mjs";

// Defensive guard for direct `node scripts/local-compose-gen.mjs` invocations on
// a stale Node (the warmup wrapper also checks). The repo pins Node 22 (.nvmrc);
// older runtimes lack APIs used here and fail with confusing errors.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(NODE_MAJOR) && NODE_MAJOR < 22) {
  console.error(`[local-compose-gen] FAIL Node ${process.versions.node} — requires Node >=22 (see .nvmrc). Run: nvm use 22`);
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = join(REPO_ROOT, "coolify/manifests/aisha.manifest");
const DEFAULT_OUT = join(REPO_ROOT, "docker-compose.local.generated.json");
// Dev-env side-effect path. Tests + parallel invocations can redirect it via
// AISHA_DEV_ENV_FILE so concurrent generator runs don't RACE on the single shared
// repo .env.local.dev (the side-effect is preset-dependent, so a parallel run with a
// different preset would clobber it mid-test). Empty/unset → the canonical repo path.
const DEV_ENV_FILE = process.env.AISHA_DEV_ENV_FILE
  ? resolve(REPO_ROOT, process.env.AISHA_DEV_ENV_FILE)
  : join(REPO_ROOT, ".env.local.dev");
// Per-implementation container/volume prefix — see scripts/lib/local-stack-name.mjs
// (one local instance per implementation; never collide with other implementations).
const VOL_PREFIX = LOCAL_STACK_PREFIX;

// Path-prefix → domain mapping for OAuth/redirect URL rewriting.
// Order: longest prefix first (specific před generic).
const DOMAIN_PATH_HINTS = [
  { pathPrefix: "/admin/realms/", domainKey: "KEYCLOAK_DOMAIN" },
  { pathPrefix: "/realms/",       domainKey: "KEYCLOAK_DOMAIN" },
  { pathPrefix: "/auth/",         domainKey: "KEYCLOAK_DOMAIN" },
  { pathPrefix: "/dashboard/",    domainKey: "NETBIRD_DOMAIN" },
  { pathPrefix: "/webhook/",      domainKey: "N8N_DOMAIN" },
  { pathPrefix: "/n8n/",          domainKey: "N8N_DOMAIN" },
  { pathPrefix: "/api/",          domainKey: "API_DOMAIN" },
  // OAuth2 callbacks jsou per-app, fallback bude default API
  { pathPrefix: "/oauth2/",       domainKey: null },
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n").filter((_, i) => i < 30).join("\n"));
  process.exit(0);
}

let selectedApps;
let presetName = null;
if (args.apps) {
  selectedApps = args.apps.split(",").map(s => s.trim()).filter(Boolean);
} else if (args.preset) {
  const preset = presets[args.preset];
  if (!preset) {
    console.error(`Unknown preset: ${args.preset}. Available: ${Object.keys(presets).join(", ")}`);
    process.exit(1);
  }
  selectedApps = [...preset.apps];
  presetName = args.preset;
} else {
  console.error("Specify --preset <name> or --apps <a,b,c>");
  process.exit(1);
}

// ── Cross-stack dependency resolution ───────────────────────────────────────
const resolved = new Set(selectedApps);
let added = [];
for (const app of selectedApps) {
  const deps = stackDependencies[app] || [];
  for (const dep of deps) {
    if (!resolved.has(dep)) {
      resolved.add(dep);
      added.push({ app, dep });
    }
  }
}
if (added.length > 0) {
  console.error(`[local-compose-gen] Cross-stack deps auto-added:`);
  for (const { app, dep } of added) {
    console.error(`   ${app} → ${dep}`);
  }
}
selectedApps = Array.from(resolved);

const manifest = parseManifest(readFileSync(MANIFEST_PATH, "utf-8"));
const appsToBuild = selectedApps.map(name => {
  const entry = manifest.find(m => m.name === name);
  if (!entry) {
    console.error(`App "${name}" not found in manifest. Available: ${manifest.map(m => m.name).join(", ")}`);
    process.exit(1);
  }
  return entry;
});

console.error(`[local-compose-gen] Selected apps: ${appsToBuild.map(a => a.name).join(", ")}`);

// Allow overriding the local seed profile (dev/demo/template) via env.
// This lets users do e.g. AISHA_SEED_PROFILE=template npm run warmup:local ...
// or via the --seed-profile flag in local-warmup.sh.
// "dev" = active development content (lively, editable).
// "demo" = test/demo data.
// "template"/sablona = clean/minimal content (pairs well with a web sablona).
if (process.env.AISHA_SEED_PROFILE) {
  devEnvDefaults.AISHA_SEED_PROFILE = process.env.AISHA_SEED_PROFILE;
}

// Allow explicit web sablona selection (domains/templates/<value>).
// Mirrors how prod uses AISHA_SEED_DOMAIN (or PUBLIC_TLD convention).
if (process.env.AISHA_SEED_DOMAIN) {
  devEnvDefaults.AISHA_SEED_DOMAIN = process.env.AISHA_SEED_DOMAIN;
}

// Web brand multidomain + instance data/design import — same env contract as
// prod so local docker can exercise brand routing + the DB-only seed import.
// Empty by default (canonical web only / community no-op); nothing hardcoded.
for (const k of [
  "AISHA_WEB_PUBLIC_ALIASES",
  "AISHA_WEB_APEX_MODE",
  "AISHA_INSTANCE_DATA_GIT_URL",
  "AISHA_WEB_DESIGN_GIT_URL",
  "AISHA_LLM_MOCK",
]) {
  if (process.env[k]) devEnvDefaults[k] = process.env[k];
}

// Respect env overrides for n8n domains (N8N_DOMAIN for direct, MCP_DOMAIN/DIRIGENT_DOMAIN for the public aliases).
// This ensures that when running local deploy with e.g. MCP_DOMAIN=mcp.mycompany.com, the compose labels
// for the MCP router get the correct value (consistent with services.json public_aliases).
if (process.env.N8N_DOMAIN) {
  devEnvDefaults.N8N_DOMAIN = process.env.N8N_DOMAIN;
}
if (process.env.MCP_DOMAIN) {
  devEnvDefaults.MCP_DOMAIN = process.env.MCP_DOMAIN;
}
if (process.env.DIRIGENT_DOMAIN) {
  devEnvDefaults.DIRIGENT_DOMAIN = process.env.DIRIGENT_DOMAIN;
}

// When asking for "template" (sablona) profile and no explicit domain was given,
// auto-pick one of our committed sablony so the public web gets a nice starting
// design from domains/templates/ instead of the plain neutral default.
// The /seed-default self-trigger in svc-web-artifact will then ingest it on boot.
// User can still override with AISHA_SEED_DOMAIN=... or --seed-domain.
const effectiveProfile = devEnvDefaults.AISHA_SEED_PROFILE || "dev";
if (effectiveProfile === "template" && !devEnvDefaults.AISHA_SEED_DOMAIN) {
  devEnvDefaults.AISHA_SEED_DOMAIN = "cafe-shop";
  console.error("[local-compose-gen] template/sablona profile → defaulting AISHA_SEED_DOMAIN=cafe-shop (from domains/templates/; override via AISHA_SEED_DOMAIN= or --seed-domain)");
}

// ── Minimal host exposure + free-port allocation ────────────────────────────
// Only the host front door publishes a host port (gateway/web/keycloak, data-
// driven via isExposedToHost — see config/local-presets.mjs EXPOSE_TO_HOST).
// For those few, probe 127.0.0.1:<port>; if a desired port is taken by another
// dev stack, allocate the next free one. Operator-pinned LOCAL_*_PORT overrides
// stay authoritative (never moved). The resolved map drives matchHostPorts below
// and is recorded into the dev env file (so warmup + the IDE extension read the
// REAL gatewayUrl/web/keycloak host ports, not the wished-for ones).
const pinnedHostPorts = new Set(
  [process.env.LOCAL_DB_PORT, process.env.LOCAL_POSTGREST_PORT, process.env.LOCAL_GATEWAY_PORT,
   process.env.LOCAL_WEB_PORT, process.env.LOCAL_KC_PORT]
    .map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0),
);
const exposedHostPorts = await resolveExposedHostPorts({ pinnedHostPorts });
for (const [name, portMap] of Object.entries(exposedHostPorts)) {
  for (const [containerPort, hostPort] of Object.entries(portMap)) {
    const desired = hostPorts[name]?.[containerPort];
    if (desired !== undefined && Number(desired) !== Number(hostPort)) {
      console.error(`[local-compose-gen] port ${name} ${containerPort}: desired host :${desired} taken → using :${hostPort}`);
    }
  }
}
console.error(`[local-compose-gen] Host-exposed services (only these publish a host port): ${Object.keys(exposedHostPorts).join(", ") || "(none)"}`);

// Record the actually-allocated host ports into the dev env manifest so bring-up
// + the extension resolve the real URLs (gatewayUrl etc.). Keys mirror the
// LOCAL_*_PORT contract the getters/overrides already use.
const allocatedPortEnv = {};
const portRecord = (name, containerPort, envKey) => {
  // Klíče vystavených portů (config/local-presets.mjs hostPorts) jsou role
  // `<něco>-gateway|web|keycloak|db`, kontejner `<INSTANCE_PREFIX>-<role>`.
  // ⛔ Přesná shoda jména dřív NIKDY nenastala (local-gateway ≠ aisha-gateway),
  // takže se skutečné porty do env nezapsaly a celý blok níž byl mrtvý kód.
  const role = name.startsWith(`${INSTANCE_PREFIX}-`) ? name.slice(INSTANCE_PREFIX.length + 1) : name;
  const key = exposedHostPorts[name] ? name : Object.keys(exposedHostPorts).find((k) => k.endsWith(`-${role}`));
  const p = key ? exposedHostPorts[key]?.[containerPort] : undefined;
  if (p !== undefined) allocatedPortEnv[envKey] = String(p);
};
// ⛔ JMÉNA SE SKLÁDAJÍ Z IDENTITY (2026-08-25). Stálo tu natvrdo `aisha-gateway`,
// `aisha-web`, `aisha-keycloak`, `aisha-db` — jméno KONKRÉTNÍ instance v souboru,
// který má sloužit každému forku. `config/local-presets.mjs` přitom prefix
// ODVOZUJE (fail-closed z profilu local-dev), takže dva soubory téhož lokálního
// stacku braly identitu ze dvou různých míst: jeden ji dopočítal, druhý ji opsal.
portRecord(`${INSTANCE_PREFIX}-gateway`, 3001, "LOCAL_GATEWAY_PORT");
portRecord(`${INSTANCE_PREFIX}-web`, 80, "LOCAL_WEB_PORT");
portRecord(`${INSTANCE_PREFIX}-keycloak`, 80, "LOCAL_KC_PORT");
portRecord(`${INSTANCE_PREFIX}-db`, 5432, "LOCAL_DB_PORT");
if (allocatedPortEnv.LOCAL_GATEWAY_PORT) {
  const gp = allocatedPortEnv.LOCAL_GATEWAY_PORT;
  allocatedPortEnv.VITE_AISHA_GATEWAY_URL = `http://localhost:${gp}`;
  allocatedPortEnv.VITE_API_URL = `http://localhost:${gp}`;
  allocatedPortEnv.VITE_AISHA_BACKEND_URL = `http://localhost:${gp}`;
  // Veřejná adresa gatewaye = host port lokálního stacku. Gateway běží s
  // NODE_ENV=production: bez PUBLIC_URL odpovídají trasy přihlášení 503 a
  // /.well-known/app-config.json vrací RELATIVNÍ mcp_url/aisha_url.
  allocatedPortEnv.PUBLIC_URL = `http://localhost:${gp}`;
}
if (allocatedPortEnv.LOCAL_WEB_PORT) {
  // Kam se prohlížeč vrací po přihlášení. Bez ní by se odvodila z APP_DOMAIN
  // (`https://web.local`), kde lokálně nic neposlouchá.
  allocatedPortEnv.FRONTEND_URL = `http://localhost:${allocatedPortEnv.LOCAL_WEB_PORT}`;
}
if (allocatedPortEnv.LOCAL_KC_PORT) {
  const kp = allocatedPortEnv.LOCAL_KC_PORT;
  // ⛔ ŽÁDNÝ LITERÁL `aisha` (2026-08-25). Komentář tu tvrdil, že je to „jen
  // výchozí brand identita" — jenže tahle hodnota jde do VITE_KC_AUTHORITY, tedy
  // do adresy, na kterou se SPA přihlašuje. Dosazená cizí značka znamená build,
  // který se hlásí do cizího realmu.
  //
  // Zdroj je ale JINÝ než u nasazení: lokální stack má realm deklarovaný v
  // config/local-presets.mjs (LOCAL_KC_REALM → devEnvDefaults.KEYCLOAK_REALM),
  // a TÝŽ realm importuje Keycloak i čte gateway. Jméno stacku (LOCAL_STACK)
  // realm není — VITE_KC_AUTHORITY s ním by mířila do realmu, který neexistuje.
  const kcRealm = (process.env.KEYCLOAK_REALM || "").trim() || devEnvDefaults.KEYCLOAK_REALM;
  if (!kcRealm) {
    console.error("[local-compose-gen] FAIL KEYCLOAK_REALM není deklarovaný (config/local-presets.mjs)");
    process.exit(1);
  }
  allocatedPortEnv.VITE_KC_URL = `http://127.0.0.1:${kp}`;
  allocatedPortEnv.VITE_KC_AUTHORITY = `http://127.0.0.1:${kp}/realms/${kcRealm}`;
}
Object.assign(devEnvDefaults, allocatedPortEnv);

writeDevEnvFile(DEV_ENV_FILE, devEnvDefaults, presetName);
console.error(`[local-compose-gen] Wrote dev env defaults → ${DEV_ENV_FILE}`);

// ── Povinné proměnné: VŠECHNY naráz, dřív než je docker najde po jedné ──────
// `docker compose config` níž spadne na PRVNÍ nenastavené `${X:?}` a o dalších
// mlčí — oprava pak jde kolečkem „doplň jednu, spusť, spadni na další", po
// jednom compose souboru. Táž otázka, jakou klade sync i CI před nasazením
// (scripts/lib/povinne-promenne.mjs); hodnoty jsou tady to, co compose opravdu
// uvidí: devEnvDefaults (jdou do --env-file) a prostředí procesu, které má
// u compose PŘEDNOST.
{
  const hodnoty = new Map(Object.entries(devEnvDefaults).map(([k, v]) => [k, v == null ? "" : String(v)]));
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) hodnoty.set(k, v);
  const mezery = [];
  for (const app of appsToBuild) {
    const composeFile = join(REPO_ROOT, app.composeFile);
    if (!existsSync(composeFile)) continue; // chybějící soubor hlásí průchod níž
    const v = nedorucene(povinneSouboru(composeFile), hodnoty);
    if (!v.ok) mezery.push(`${app.name} (${app.composeFile}): ${popisNedorucenych(v)}`);
  }
  if (mezery.length > 0) {
    console.error(`[local-compose-gen] FAIL ${mezery.length} compose soubor(y) chtějí povinné proměnné, které lokální stack nemá:`);
    for (const m of mezery) console.error(`     - ${m}`);
    console.error(`[local-compose-gen]   Doplň je do config/local-presets.mjs:devEnvDefaults (skutečná dev hodnota —`);
    console.error(`[local-compose-gen]   \`\${X:?}\` prázdnou nepřijme).`);
    process.exit(1);
  }
}

const merged = {
  // Compose project name — per-IMPLEMENTATION (scripts/lib/local-stack-name.mjs):
  // isolates this implementation's one-and-only local instance from other
  // implementations' local stacks on the same machine.
  name: LOCAL_STACK,
  services: {},
  volumes: {},
  // Build secrets (`build.secrets: [git_token]` u Keycloaku). Bez top-level
  // deklarace compose odmítne celý projekt („refers to undefined build secret").
  secrets: {},
  networks: {
    [LOCAL_STACK]: { driver: "bridge" },
  },
};

// Track service provenance: which app first defined each service.
// Used to give meaningful warnings when configs diverge across stacks.
const serviceOrigin = new Map();   // svcName → first-app-name
const duplicateConflicts = [];     // collected for end-of-run summary
const allUnsetVars = new Set();    // env-completeness: bare vars docker resolved to ""

// ── Pass 1: render + transform every selected stack; keep the bundles so the
//    cross-stack divergence scan below can compare a service NAME's definition
//    across all stacks BEFORE deciding how to merge it. ─────────────────────
const appBundles = [];
for (const app of appsToBuild) {
  const composeFile = join(REPO_ROOT, app.composeFile);
  if (!existsSync(composeFile)) {
    console.error(`[local-compose-gen] WARN: compose file not found: ${app.composeFile} (skipping ${app.name})`);
    continue;
  }
  console.error(`[local-compose-gen] Processing ${app.name} (${app.composeFile})`);
  const { doc: rendered, unsetVars } = renderComposeJson(composeFile, DEV_ENV_FILE);
  for (const v of unsetVars) allUnsetVars.add(v);
  const transformed = transformForLocal(rendered);
  appBundles.push({
    name: app.name,
    composeFile: app.composeFile,
    services: transformed.services || {},
    volumes: transformed.volumes || {},
    secrets: transformed.secrets || {},
  });
}

// ── Cross-stack divergence scan ──────────────────────────────────────────────
// A service NAME defined by ≥2 stacks with DIFFERENT config cannot share one
// merged key: last-wins would silently drop a stack's variant. The canonical
// case is `pki-init`, which runs issue-netbird-mesh-cert.sh in netbird but only
// copies a CA bundle in langfuse and builds a combined bundle in observability.
// Such names are namespaced per-stack (<stack>__<svc>); identical duplicates
// (true shared helpers) keep the bare name and are merged once.
const defsByName = new Map();
for (const b of appBundles) {
  for (const [svcName, def] of Object.entries(b.services)) {
    if (!defsByName.has(svcName)) defsByName.set(svcName, []);
    defsByName.get(svcName).push({ app: b.name, def });
  }
}
const divergentNames = new Set();      // init containers → namespaced per stack
const sharedDivergent = [];            // long-lived divergent → last-wins (warn)
for (const [svcName, defs] of defsByName) {
  if (defs.length < 2) continue;
  const first = defs[0].def;
  const divergent = defs.slice(1).some((d) => diffServiceConfig(first, d.def).length > 0);
  if (!divergent) continue;
  // Only INIT / one-shot containers (restart "no") are safe to namespace per
  // stack: they run-and-exit, are referenced ONLY structurally (depends_on,
  // network_mode), and nothing connects to them by hostname. pki-init is the
  // canonical case. Long-lived divergent services (redis, netbird-agent) are
  // reached by clients via a SHARED hostname (redis://aisha-redis:6379, etc.);
  // splitting them into per-stack copies would break that in-network DNS and
  // collide on container_name. Those stay shared (last-wins) with a warning —
  // sharing one local instance is the right behaviour for the merged dev stack.
  const allInit = defs.every((d) => d.def?.restart === "no");
  if (allInit) {
    divergentNames.add(svcName);
  } else {
    sharedDivergent.push({ name: svcName, apps: defs.map((d) => d.app) });
  }
}
if (divergentNames.size > 0) {
  console.error(
    `[local-compose-gen] ⚠ ${divergentNames.size} divergent INIT service(s) → per-stack namespacing: ${[...divergentNames].sort().join(", ")}`,
  );
}
const sharedDivergentNames = new Set(sharedDivergent.map((s) => s.name));
for (const s of sharedDivergent) {
  console.error(
    `[local-compose-gen] ⚠ divergent long-lived service "${s.name}" (${s.apps.join(", ")}) — kept SHARED (last-wins); clients reach it by hostname so it must stay single-instance locally.`,
  );
}

// ── Pass 2: merge. Divergent names → namespaced + intra-stack refs rewritten;
//    identical duplicates → shared (bare name, merged once). ────────────────
for (const b of appBundles) {
  // Only divergent names that THIS stack actually defines get a rename entry.
  const renameMap = {};
  for (const svcName of Object.keys(b.services)) {
    if (divergentNames.has(svcName)) renameMap[svcName] = namespaceServiceKey(b.name, svcName);
  }
  // Rewrite same-file references (depends_on / network_mode / volumes_from /
  // links) so a stack's services still point at ITS namespaced peers.
  if (Object.keys(renameMap).length > 0) {
    for (const svc of Object.values(b.services)) rewriteServiceRefs(svc, renameMap);
  }
  for (const [svcName, def] of Object.entries(b.services)) {
    const key = renameMap[svcName] ?? svcName;
    if (renameMap[svcName]) {
      console.error(`[local-compose-gen]   ${b.name}: namespaced divergent "${svcName}" → "${key}"`);
      duplicateConflicts.push({ service: svcName, app: b.name, namespacedTo: key });
    } else if (merged.services[key]) {
      const note = sharedDivergentNames.has(svcName)
        ? "divergent — last-wins, see warning above"
        : "identical config — shared";
      console.error(`[local-compose-gen]   ${b.name} re-declares ${svcName} (${note})`);
    } else {
      serviceOrigin.set(svcName, b.name);
    }
    merged.services[key] = def;
  }
  for (const [volName, volDef] of Object.entries(b.volumes)) {
    merged.volumes[volName] = volDef;
  }
  for (const [secretName, secretDef] of Object.entries(b.secrets)) {
    // `name` je projektové jméno zdrojového compose souboru — merged projekt má
    // vlastní (LOCAL_STACK), takže zdroj (`environment:` / `file:`) stačí.
    const { name: _projectScopedName, ...source } = secretDef || {};
    merged.secrets[secretName] = source;
  }
}

// End-of-run summary
if (duplicateConflicts.length > 0) {
  console.error(
    `[local-compose-gen] ⚠ ${duplicateConflicts.length} divergent service occurrence(s) namespaced per-stack (no silent last-wins).`,
  );
}

// ── Env-completeness hard-fail: a bare ${VAR} referenced in compose but missing
//    from devEnvDefaults is substituted by `docker compose config` with a BLANK
//    STRING (only a stderr warning), so malformed config (empty host/secret)
//    silently reaches the local stack — the KEYCLOAK_DOMAIN_PUBLIC bug class.
//    Fail loudly with the exact vars to declare. See scripts/lib/env-completeness.mjs.
if (allUnsetVars.size > 0) {
  const list = [...allUnsetVars].sort();
  console.error(`[local-compose-gen] FAIL ${list.length} env var(s) referenced in compose but missing from config/local-presets.mjs devEnvDefaults (would silently resolve to ""):`);
  for (const v of list) console.error(`     - ${v}`);
  console.error(`[local-compose-gen]   Declare each in devEnvDefaults (a real dev value, or "" if intentionally empty).`);
  process.exit(1);
}

// ── Host-client Keycloak OIDC integrity (model-driven, all consumers) ────────
// transformForLocal() leaves OIDC URLs mangled: in-network keys (jwks/token/
// userinfo) rewritten to http://localhost:<port> (= the consumer container
// itself) and host-facing keys (issuer/auth) as the malformed https:/// from the
// unset KEYCLOAK_DOMAIN_PUBLIC. The resolver re-classifies EVERY OIDC URL by its
// path and rewrites: issuer/auth → host-facing 127.0.0.1:<kcPort> (so the gateway
// MINTS + oauth2-proxy redirects the browser correctly); jwks/token/userinfo →
// in-network aisha-keycloak:80. Covers gateway, svc-mcp-knowledge, svc-plugin-
// system, svc-matrix, AND every oauth2-proxy sidecar — no key-name special-cases.
// See scripts/lib/kc-endpoint-resolver.mjs + the local-host-auth gate.
applyHostClientAuthFix(merged);
if (Object.values(merged.services).some((s) => s?.container_name === KC_CONTAINER)) {
  console.error("[local-compose-gen] Host-client KC OIDC fix applied (issuer/auth → host-facing; jwks/token/userinfo → in-network)");
}

// ── Local env DOCTOR — HARD-FAIL on empty/placeholder/malformed critical env ──
// env-completeness above catches a bare ${VAR} that resolves to "" but NOT a key
// HOLDING a placeholder (POSTGREST_SERVICE_TOKEN="dev-service-role-key") or a too-
// short/empty JWT_SECRET — those slipped through and broke svc-mcp-knowledge
// service-role auth (jwtVerify on a non-JWT → PGRST301). Validate the RESOLVED
// per-service env (post applyHostClientAuthFix, so the rewritten KC URLs are
// judged) and fail BEFORE writing the compose, naming every bad key.
// See scripts/lib/local-env-assertions.mjs.
{
  // Flatten each service's environment (array "K=V" | object) → { NAME: value }.
  const flattenEnv = (env) => {
    const out = {};
    if (Array.isArray(env)) {
      for (const e of env) {
        const eq = String(e).indexOf("=");
        if (eq > 0) out[String(e).slice(0, eq)] = String(e).slice(eq + 1);
      }
    } else if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) out[k] = v == null ? "" : String(v);
    }
    return out;
  };
  // Critical secrets some services reference ONLY via the shared env-file (so the
  // resolved per-service env lacks the key); resolve those from devEnvDefaults so
  // the doctor still judges them (the spec's back-fill). URLs are validated only
  // where a service actually declares them (post-rewrite values).
  const SECRET_BACKFILL = ["JWT_SECRET", "POSTGREST_SERVICE_TOKEN"];
  const resolvedServices = {};
  for (const [svcKey, svc] of Object.entries(merged.services)) {
    if (!svc || typeof svc !== "object") continue;
    const env = flattenEnv(svc.environment);
    for (const k of SECRET_BACKFILL) {
      // If the service declares the key but it's still an unresolved ${VAR} ref,
      // OR doesn't declare it at all but is a service that consumes it, resolve
      // from devEnvDefaults so the real value (not the template) is asserted.
      if (k in env && /^\$\{?[A-Z]/.test(String(env[k])) && devEnvDefaults[k] !== undefined) {
        env[k] = devEnvDefaults[k];
      }
    }
    // Only keep services that carry at least one critical key (keeps the doctor's
    // report focused; non-critical services are irrelevant here).
    if (CRITICAL_ENV_KEYS.some((k) => k in env)) {
      resolvedServices[svc.container_name || svcKey] = { env };
    }
  }
  try {
    const { checked } = validateLocalStackEnv(resolvedServices);
    console.error(`[local-compose-gen] Env doctor OK — ${checked} critical env value(s) validated across ${Object.keys(resolvedServices).length} service(s)`);
  } catch (err) {
    console.error(`[local-compose-gen] FAIL ${err.message}`);
    console.error("[local-compose-gen]   Fix the value(s) in config/local-presets.mjs devEnvDefaults (or the source compose) and re-run. Compose NOT written.");
    process.exit(1);
  }
}

// ── Browser CORS for the local web app (gateway ALLOWED_ORIGINS) ─────────────
// In production the gateway's ALLOWED_ORIGINS is pushed into its Coolify app env
// (coolify-deploy-init.sh → set_coolify_env_if), so the shared coolify compose
// never declares it. Locally there is no Coolify to push it, and the gateway's
// config.ts default (localhost:5173,localhost:8100) does NOT cover the dev web
// origins — so every in-BROWSER RPC (get_my_user_roles, get_user_permissions, …)
// fails the CORS preflight and the SPA can't resolve roles (admin → 403). Node-
// side callers (Playwright page.request) bypass CORS and hide this, so it only
// bites the real browser. Inject the local web origins here unless already set.
// Covers: 8080 (canonical local web), 5173 (`npm run dev`), 4173 (`npm run
// dev:e2e`), each as both 127.0.0.1 and localhost (CORS origins are exact-match).
{
  const gw =
    merged.services.gateway ??
    Object.values(merged.services).find((s) => s?.container_name === "aisha-gateway");
  if (gw) {
    // Local dev CORS origins — host/port lists are env-overridable (no fixed
    // values baked in); the defaults cover the served (8080), Vite dev (5173)
    // and Vite preview (4173) ports on both loopback aliases.
    const LOCAL_WEB_HOSTS = (process.env.LOCAL_WEB_HOSTS ?? "127.0.0.1,localhost")
      .split(",").map((h) => h.trim()).filter(Boolean);
    const LOCAL_WEB_PORTS = (process.env.LOCAL_WEB_PORTS ?? "8080,5173,4173")
      .split(",").map((p) => p.trim()).filter(Boolean);
    const LOCAL_WEB_ORIGINS = LOCAL_WEB_HOSTS
      .flatMap((h) => LOCAL_WEB_PORTS.map((p) => `http://${h}:${p}`))
      .join(",");
    const hasKey = (env) =>
      Array.isArray(env)
        ? env.some((e) => /^ALLOWED_ORIGINS=/.test(e))
        : Boolean(env && typeof env === "object" && "ALLOWED_ORIGINS" in env);
    if (!hasKey(gw.environment)) {
      if (Array.isArray(gw.environment)) {
        gw.environment.push(`ALLOWED_ORIGINS=${LOCAL_WEB_ORIGINS}`);
      } else {
        gw.environment = { ...(gw.environment || {}), ALLOWED_ORIGINS: LOCAL_WEB_ORIGINS };
      }
      console.error(`[local-compose-gen] Gateway ALLOWED_ORIGINS set for local browser CORS (${LOCAL_WEB_ORIGINS})`);
    }
  }
}

// ── Gateway: veřejná adresa a frontend = skutečné host porty lokálního stacku ──
// Nastavuje se AŽ po transformaci: rewriteDomainStr přepisuje každé
// `http://localhost:<port>` na port gatewaye, takže by FRONTEND_URL skončila na :3001.
if (merged.services.gateway && allocatedPortEnv.PUBLIC_URL) {
  const env = merged.services.gateway.environment;
  if (env && !Array.isArray(env)) {
    env.PUBLIC_URL = allocatedPortEnv.PUBLIC_URL;
    if (allocatedPortEnv.FRONTEND_URL) {
      env.FRONTEND_URL = allocatedPortEnv.FRONTEND_URL;
      // /.well-known/app-config.json: web_url by se jinak odvodil z APP_DOMAIN
      // (`https://web.local`), kde lokálně nic neposlouchá.
      env.APP_CONFIG_WEB_URL = allocatedPortEnv.FRONTEND_URL;
    }
    // keycloak_url pro klienty (rozšíření, mobil): host-facing issuer lokálního KC.
    if (allocatedPortEnv.VITE_KC_AUTHORITY) env.APP_CONFIG_KEYCLOAK_URL = allocatedPortEnv.VITE_KC_AUTHORITY;
  }
}

// ── PGRST202 guard: PostgREST must wait for migrate, else it caches an empty
//    schema on a fresh wipe and authed RPCs return PGRST202 "function not in
//    schema cache". Base coolify.yml only depends on db; the e2e overlay handles
//    this for e2e, so do the same for the local generated stack.
//    (memory: project_local_host_client_auth_2026-06-06 diagnostic map.)
if (merged.services.postgrest && merged.services.migrate) {
  const pg = merged.services.postgrest;
  let dep = pg.depends_on;
  if (Array.isArray(dep)) {
    const obj = {};
    for (const d of dep) obj[d] = { condition: "service_started" };
    dep = obj;
  } else if (!dep || typeof dep !== "object") {
    dep = {};
  }
  if (!dep.migrate) {
    dep.migrate = { condition: "service_completed_successfully" };
    console.error("[local-compose-gen] PostgREST now waits for migrate (PGRST202 schema-cache race guard)");
  }
  pg.depends_on = dep;
}

// ── Local dev currency: mount the WORKING-TREE aisha/db over the migrate image's
//    baked copy so a fresh cold-start ALWAYS applies the CURRENT baseline + seed
//    WITHOUT an image rebuild. The bring-up does `docker compose up -d` (not
//    `--build`), so it reuses the cached migrate image; without this overlay a
//    changed baseline/seed never reaches the local DB (Dockerfile.migrate bakes
//    via `COPY . .`). Prod keeps the baked copy (no host mount); this is local-only.
if (merged.services.migrate) {
  const m = merged.services.migrate;
  if (!Array.isArray(m.volumes)) m.volumes = [];
  const alreadyMounted = m.volumes.some(
    (v) => (typeof v === "object" ? v.target : String(v)).includes("/app/aisha/db"),
  );
  if (!alreadyMounted) {
    m.volumes.push({ type: "bind", source: "./aisha/db", target: "/app/aisha/db", read_only: true });
    console.error("[local-compose-gen] migrate mounts working-tree ./aisha/db (current baseline/seed, no rebuild)");
  }
}

// ── Discovery-OIDC consumer support boundary ─────────────────────────────────
// These consumers do server-side OIDC discovery from a single issuer URL and
// CANNOT complete login under local-warmup's no-Traefik/no-/etc/hosts model (no
// single host:port is both in-network-reachable AND equal to the host-facing iss).
// Warn (non-fatal) so the dev isn't surprised — the gateway/SPA + oauth2-proxy
// admin UIs DO work. See scripts/lib/oidc-consumer-support.mjs +
// docs/LOCAL_WARMUP_OIDC_SUPPORT.md. Runs BEFORE namespacing (matches original names).
const discoveryConsumers = findDiscoveryConsumersInStack(merged);
if (discoveryConsumers.length > 0) {
  console.error(`[local-compose-gen] ⚠ ${discoveryConsumers.length} discovery-OIDC consumer(s) won't complete login under local-warmup (use the e2e/full Traefik stack):`);
  for (const cn of discoveryConsumers) {
    const sluzba = Object.keys(DISCOVERY_OIDC_CONSUMERS).find((k) => cn.endsWith(`-${k}`));
    console.error(`     - ${cn}: ${DISCOVERY_OIDC_CONSUMERS[sluzba]}`);
  }
}

// ── Container-name namespacing (coexistence) ─────────────────────────────────
// Rename each container_name to a project-local form so local-warmup and the e2e
// stack — which inherit the SAME `container_name: aisha-*` from the shared coolify
// compose files — can run SIMULTANEOUSLY without a global Docker name collision.
// The original name is preserved as a local-network alias (LOCAL_STACK net), so in-network
// service-to-service URLs (http://aisha-keycloak:80 etc.) still resolve. Runs
// LAST — after everything that keys on the original container_name
// (matchHostPorts, applyHostClientAuthFix).
namespaceContainerNames(merged, VOL_PREFIX);

// ── MESH JMÉNO PLATÍ I LOKÁLNĚ ──────────────────────────────────────────────
//
// ⛔ PROČ (2026-08-25). Lokál a produkce pojmenovávaly touž službu dvěma
// způsoby: produkce mesh FQDN (`<label>.<mesh_tld>`), lokál plochý container
// alias (`http://<kontejner>:<port>`). Kód, který mezi oběma přechází — testy,
// fixtury, `internalUrlFor` — musel proto držet obě varianty, a právě to
// udržovalo ploché tvary při životě. Mesh je podmínka provozu AISHA stacku,
// ne volitelný režim, takže tvar jména musí být JEDEN.
//
// Docker alias tečky unese (produkční pki-bridge to už dělá — `${PKI_BRIDGE_DOMAIN}`
// je jeho alias na sdílené síti), takže mesh FQDN jde lokálně rozřešit BEZ mesh:
// jméno je totéž, mění se jen vrstva, která ho přeloží. Přesně to pravidlo, které
// derive-domains říká o produkci — „kolokace se řeší VRSTVOU POD jménem, ne tím,
// že se jméno změní".
//
// Jméno se BERE Z TOPOLOGIE, neskládá se tady: container_name ≠ mesh jméno
// (`local-keycloak` vs `auth.mesh.local.internal`), takže odvození z kontejneru
// by vyrobilo jméno, které v produkci neexistuje.
addMeshAliases(merged);

function addMeshAliases(doc) {
  let topo;
  try {
    topo = buildTopology({ profileId: "local-dev", meshEnabled: true });
  } catch (err) {
    console.error(`[local-compose-gen] mesh aliasy PŘESKOČENY — topologie se nepostavila: ${err.message}`);
    return;
  }
  const alias = new Map(); // container_name (bez prefixu) → [mesh jména]
  for (const svc of Object.values(topo.services ?? {})) {
    const compose = svc.compose;
    const primary = (svc.urls?.internal ?? [])[0]?.url;
    if (!compose || !primary) continue;
    const cil = svc.internal_url?.service ?? svc.public_face?.service;
    if (!cil) continue;
    const cn = containerNameFrom(compose, cil, topo.app_name_prefix);
    if (!cn) continue;
    if (!alias.has(cn)) alias.set(cn, []);
    alias.get(cn).push(primary);
  }
  let n = 0;
  for (const s of Object.values(doc?.services ?? {})) {
    if (!s?.container_name || s.network_mode) continue;
    const orig = s.container_name.startsWith(VOL_PREFIX)
      ? s.container_name.slice(VOL_PREFIX.length)
      : s.container_name;
    const jmena = alias.get(orig);
    if (!jmena?.length) continue;
    const net = s.networks?.[LOCAL_STACK];
    if (!net || typeof net !== "object") continue;
    const existing = Array.isArray(net.aliases) ? net.aliases : [];
    net.aliases = [...new Set([...existing, ...jmena])];
    n += jmena.length;
  }
  console.error(`[local-compose-gen] mesh aliasů přidáno: ${n}`);
}

// Z čeho tenhle stack vznikl. Compose rozšíření (`x-*`) docker ignoruje; čte ho
// local-warmup.sh, když vygenerovaný soubor ZNOVU POUŽIJE: zdrojové compose se
// mezitím mohly změnit a znovupoužitý stack by pak nesl jejich starou podobu.
merged["x-aisha-zdroje"] = appBundles.map((b) => b.composeFile).filter(Boolean);

const outPath = args.out || DEFAULT_OUT;
const json = JSON.stringify(merged, null, 2);

if (args["dry-run"]) {
  console.error(`[local-compose-gen] DRY RUN — would write ${json.length} bytes to ${outPath}`);
  console.error(`[local-compose-gen] Services: ${Object.keys(merged.services).length}`);
  console.error(`[local-compose-gen] Volumes:  ${Object.keys(merged.volumes).length}`);
  process.exit(0);
}

writeFileSync(outPath, json);
console.error(`[local-compose-gen] OK Wrote ${outPath} (${Object.keys(merged.services).length} services, ${Object.keys(merged.volumes).length} volumes)`);
console.error(`[local-compose-gen] Run: docker compose -f ${outPath} up -d`);

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out["dry-run"] = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function parseManifest(text) {
  // Format: `app: <name>:<host>:<compose-file>[:<tag>=<value>[,<tag>=<value>...]]`
  // Examples:
  //   app: keycloak:backend:docker-compose.coolify-keycloak.yml
  //   app: keycloak:backend:docker-compose.coolify-keycloak.yml:bluegreen=on
  //   app: orchestration:backend:docker-compose.coolify-n8n.yml:bluegreen=on,story=*
  //   app: edge:frontend:docker-compose.coolify-prebuilt.yml:bluegreen=on,story=customer-acme
  const apps = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i);
    if (!m) continue;
    const tags = {};
    if (m[4]) {
      // Tags separator: comma (`,`) or colon (`:`) — both supported pro back-compat
      for (const part of m[4].split(/[,:]/)) {
        const eq = part.indexOf("=");
        if (eq > 0) {
          tags[part.slice(0, eq)] = part.slice(eq + 1);
        } else if (part) {
          tags[part] = true;  // bare flag without value
        }
      }
    }
    apps.push({ name: m[1], host: m[2], composeFile: m[3], tags });
  }
  return apps;
}

function writeDevEnvFile(path, defaults, presetName) {
  const lines = [
    "# Auto-generated by scripts/local-compose-gen.mjs — DO NOT COMMIT",
    "# Dev defaults pro lokální warmup. Pro produkci viz .env.coolify.",
    presetName ? `# AISHA_LOCAL_PRESET=${presetName}` : "",
    "",
  ].filter(Boolean);
  for (const [k, v] of Object.entries(defaults)) {
    lines.push(`${k}=${v}`);
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

function renderComposeJson(composeFile, envFile) {
  // spawnSync (not execFileSync) so we can read stderr on SUCCESS too — that is
  // where `docker compose config` reports `"<VAR>" variable is not set` for bare
  // ${VAR}s missing from the env file (the silent-empty class). No shell, no
  // injection. `config --format json` canonicalizes YAML, resolves env
  // interpolation, expands anchors (<<: *netbird-common etc).
  const r = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "--env-file", envFile, "config", "--format", "json"],
    { encoding: "utf-8", cwd: REPO_ROOT, maxBuffer: 50 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    console.error(`[local-compose-gen] FAIL docker compose config for ${composeFile}`);
    console.error(`   stderr: ${(r.stderr || "").toString().slice(0, 800) || "(none)"}`);
    console.error(`   Pravděpodobně chybí dev default v config/local-presets.mjs:devEnvDefaults`);
    process.exit(1);
  }
  return { doc: JSON.parse(r.stdout), unsetVars: parseUnsetVarWarnings(r.stderr || "") };
}

function transformForLocal(doc) {
  const out = JSON.parse(JSON.stringify(doc));

  // ── Top-level networks: drop, merged compose declares only the LOCAL_STACK net ──
  delete out.networks;

  // ── Volumes: rename top-level keys + their `name:` field ──────────────
  // Mapping: oldName → newName so service mounts can be rewritten.
  const volumeRename = {};
  if (out.volumes) {
    const newVolumes = {};
    for (const [origKey, volDef] of Object.entries(out.volumes)) {
      const newKey = renameVolume(origKey);
      volumeRename[origKey] = newKey;
      const newDef = { ...(volDef || {}) };
      if (newDef.name) {
        newDef.name = renameVolumeName(newDef.name);
      } else {
        // Volume bez explicit `name:` — Docker použil compose project + key.
        // V merged compose je project name LOCAL_STACK (per-implementace), takže to
        // bude `${LOCAL_STACK}_<key>` automaticky. Ponecháme bez name.
      }
      newVolumes[newKey] = newDef;
    }
    out.volumes = newVolumes;
  }

  // ── Per-service transforms ────────────────────────────────────────────
  for (const [svcName, svc] of Object.entries(out.services || {})) {
    if (svc.network_mode) {
      // Services using network_mode (e.g. core-mesh-ingress: "service:netbird-agent")
      // share the network namespace of the target service. They MUST NOT declare
      // a `networks:` key (Docker Compose treats network_mode + networks as mutually
      // exclusive). Drop any that docker-compose-config may have normalized in.
      delete svc.networks;
    } else if (svc.networks) {
      // Normal services: route to the local bridge and keep in-network DNS working —
      // including the aliases the source declares (n8n--main answers as <prefix>-n8n).
      svc.networks = collapseToLocalNetwork(svc.networks, LOCAL_STACK);
    }

    // Drop Coolify-specific labels
    if (svc.labels) {
      svc.labels = filterLabels(svc.labels);
    }

    // Rewrite volume references in service-level mounts
    if (Array.isArray(svc.volumes)) {
      svc.volumes = svc.volumes.map(v => rewriteServiceVolume(v, volumeRename));
    }

    // Init container detection: restart "no" → disable healthcheck
    // (init containers typically lack curl/wget → healthcheck would fail)
    if (svc.restart === "no") {
      svc.healthcheck = { disable: true };
    } else {
      // Keep init's `restart: "no"`; for normal services force unless-stopped
      svc.restart = "unless-stopped";
    }

    delete svc.deploy;

    // Lokálně není NetBird mesh: nepodmíněná mesh routa v entrypointu a DNS na
    // mesh resolver by službu shodily (scripts/lib/local-mesh-route.mjs).
    neutralizeMeshRouteForLocal(svc, { meshDnsIp: devEnvDefaults.NETBIRD_DNS_IP });

    // Domain rewriting in environment values (OAuth redirects, etc.)
    if (svc.environment) {
      svc.environment = rewriteDomainsInEnv(svc.environment);
      // Serverová volání na veřejnou tvář API → mesh jméno API (scripts/lib/local-api-upstream.mjs).
      svc.environment = rewritePublicApiUrlsInEnv(svc.environment, {
        apiDomain: devEnvDefaults.API_DOMAIN,
        apiUpstream: devEnvDefaults.API_UPSTREAM_MESH,
      });
    }
    if (Array.isArray(svc.command)) {
      svc.command = svc.command.map(c => rewriteDomainStr(c));
    }

    // ── Host port publishing — MINIMAL EXPOSURE ──────────────────────────
    // Only services flagged exposeToHost (gateway/web/keycloak; +db when opted
    // in) get a host `ports:` publish — and with the FREE-PORT-ALLOCATED host
    // port resolved above. Everything else is internal-only: any host `ports:`
    // inherited from the prod compose is STRIPPED so postgrest/redis/db/svc-*
    // never collide with other dev stacks on the machine. In-network DNS
    // (container_name) is untouched, so service-to-service traffic still works.
    const exposureName = matchExposureName(svcName, svc.container_name);
    if (exposureName && isExposedToHost(exposureName)) {
      const portsForService = exposedHostPorts[exposureName] || matchHostPorts(svcName, svc.container_name);
      if (portsForService) {
        svc.ports = svc.ports || [];
        for (const [containerPort, hostPort] of Object.entries(portsForService)) {
          const mapping = `${hostPort}:${containerPort}`;
          const exists = svc.ports.some(p =>
            (typeof p === "string" && p === mapping) ||
            (typeof p === "object" && p.published === Number(hostPort) && p.target === Number(containerPort))
          );
          if (!exists) svc.ports.push(mapping);
        }
      }
    } else {
      // Internal-only service: drop any host port publish carried over from the
      // prod compose (the host reaches it through the gateway).
      if (svc.ports) delete svc.ports;
    }

    // Local/dev build helper: ensure SKIP_I18N_CHECK is passed as a concrete
    // Docker build arg for the SPA web image (the one using Dockerfile.web).
    // We bake the actual value ("true" for local dev) at generation time into
    // the output compose JSON. This is more reliable than leaving a ${VAR}
    // template (source prebuilt declares VITE_* args but not SKIP; some web
    // defs in coolify ymls have build: but no args: at all).
    // Dockerfile.web: ARG SKIP_I18N_CHECK=false  (so prod/CI runs the gate).
    const df = (svc.build && svc.build.dockerfile) || "";
    const isSpaWeb = svcName === "web" ||
                     df === "Dockerfile.web" ||
                     /Dockerfile\.web$/.test(df);
    if (isSpaWeb) {
      if (!svc.build) {
        svc.build = { context: ".", dockerfile: "Dockerfile.web" };
      }
      if (!svc.build.args) {
        svc.build.args = {};
      }
      const skipVal = devEnvDefaults.SKIP_I18N_CHECK ?? "true";
      // App-config build args (Dockerfile.web ARG set): the web defs in the
      // coolify ymls carry `build:` without `args:`, and `--env-file` only
      // feeds interpolation/runtime env — never Dockerfile ARGs. Without these
      // baked in, render-app-config.mjs FATALs on API_DOMAIN_PUBLIC/ANON_KEY/
      // KEYCLOAK_DOMAIN/MATRIX_DOMAIN/DIRIGENT_DOMAIN/APP_DOMAIN (same failure
      // the prebuilt compose fixed for prod on 2026-06-11).
      const WEB_APP_CONFIG_ARGS = [
        "VITE_AISHA_BACKEND_URL",
        "VITE_AISHA_BACKEND_ANON_KEY",
        "VITE_AISHA_BACKEND_PUBLISHABLE_KEY",
        "VITE_AISHA_GATEWAY_URL",
        "VITE_AISHA_GATEWAY_KEY",
        "VITE_API_URL",
        "VITE_WS_URL",
        "VITE_PUBLIC_SITE_URL",
        "VITE_SENTRY_DSN",
        "VITE_WEB_PUSH_VAPID_PUBLIC_KEY",
        "VITE_REQUIRE_AISHA_BACKEND_ENV",
        "VITE_KC_URL",
        "VITE_KC_AUTHORITY",
        "VITE_KC_CLIENT_ID",
        "VITE_AUTH_REDIRECT_URI",
        "VITE_AUTH_POST_LOGOUT_URI",
        "KEYCLOAK_REALM",
        "MATRIX_DOMAIN",
        "DIRIGENT_DOMAIN",
      ];
      const bakeArg = (key, val) => {
        if (val === undefined || val === null) return;
        if (Array.isArray(svc.build.args)) {
          const has = svc.build.args.some((a) =>
            (typeof a === "string" && a.startsWith(`${key}=`)) ||
            (typeof a === "object" && a !== null && key in a)
          );
          if (!has) svc.build.args.push({ [key]: String(val) });
        } else if (typeof svc.build.args === "object") {
          if (!(key in svc.build.args)) svc.build.args[key] = String(val);
        }
      };
      for (const key of WEB_APP_CONFIG_ARGS) {
        bakeArg(key, process.env[key] ?? devEnvDefaults[key]);
      }
      if (Array.isArray(svc.build.args)) {
        const hasSkip = svc.build.args.some((a) =>
          (typeof a === "string" && a.includes("SKIP_I18N_CHECK")) ||
          (typeof a === "object" && "SKIP_I18N_CHECK" in a)
        );
        if (!hasSkip) {
          svc.build.args.push({ SKIP_I18N_CHECK: skipVal });
        }
      } else if (typeof svc.build.args === "object") {
        svc.build.args.SKIP_I18N_CHECK = skipVal;
      }
    }
  }

  return out;
}

function renameVolume(key) {
  // Rename top-level volume key to local prefix to avoid collision.
  if (key.startsWith(VOL_PREFIX)) return key;
  return VOL_PREFIX + key;
}

function renameVolumeName(name) {
  // Top-level `name:` field — rename `aisha_v2_X` / `aisha_X` → `${VOL_PREFIX}X`.
  if (name.startsWith(VOL_PREFIX)) return name;
  if (name.startsWith("aisha_v2_")) return VOL_PREFIX + name.slice("aisha_v2_".length);
  if (name.startsWith("aisha_")) return VOL_PREFIX + name.slice("aisha_".length);
  if (name.startsWith("aisha-")) return VOL_PREFIX + name.slice("aisha-".length);
  return VOL_PREFIX + name;
}

function rewriteServiceVolume(v, volumeRename) {
  // Service mounts can be string ("vol:/path") or object ({type, source, target}).
  if (typeof v === "string") {
    const colon = v.indexOf(":");
    if (colon === -1) return v;
    const left = v.slice(0, colon);
    const rest = v.slice(colon);
    // Skip bind mounts (start with `.` or `/`) — those are host paths
    if (left.startsWith(".") || left.startsWith("/")) return v;
    if (volumeRename[left]) return volumeRename[left] + rest;
    return v;
  }
  if (typeof v === "object" && v !== null) {
    const out = { ...v };
    if (out.type === "volume" && out.source && volumeRename[out.source]) {
      out.source = volumeRename[out.source];
    }
    return out;
  }
  return v;
}

function filterLabels(labels) {
  const drop = (k) =>
    k.startsWith("coolify.") ||
    k === "traefik.docker.network" ||
    k.startsWith("traefik.http.routers.") ||
    k.startsWith("traefik.http.middlewares.") ||
    k.startsWith("traefik.http.services.");

  if (Array.isArray(labels)) {
    return labels.filter(l => {
      const eq = l.indexOf("=");
      const k = eq > 0 ? l.slice(0, eq) : l;
      return !drop(k);
    });
  }
  if (typeof labels === "object" && labels !== null) {
    const out = {};
    for (const [k, v] of Object.entries(labels)) {
      if (!drop(k)) out[k] = v;
    }
    return out;
  }
  return labels;
}

// Compare two service configs deep, ignoring fields that legitimately differ
// per stack (container_name, labels). Returns list of diff descriptions.
// Namespaced service KEY for a divergent duplicate: "<stack>__<svc>".
// The stack prefix is sanitised to a compose-safe slug (lowercase, [a-z0-9-]).
function namespaceServiceKey(appName, svcName) {
  const prefix = String(appName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}__${svcName}`;
}

// Rewrite a service's same-file references to renamed peers. `renameMap` is
// { origServiceKey → namespacedKey } for the divergent services in THIS stack.
// Cross-stack DNS is unaffected (it resolves via container_name aliases, not
// service keys), so only intra-stack structural refs need rewriting.
function rewriteServiceRefs(svc, renameMap) {
  if (!svc || typeof svc !== "object") return;
  // depends_on: array of names OR object keyed by name (long-form conditions).
  if (Array.isArray(svc.depends_on)) {
    svc.depends_on = svc.depends_on.map((d) => renameMap[d] ?? d);
  } else if (svc.depends_on && typeof svc.depends_on === "object") {
    const next = {};
    for (const [dep, cond] of Object.entries(svc.depends_on)) next[renameMap[dep] ?? dep] = cond;
    svc.depends_on = next;
  }
  // network_mode: "service:<name>" shares another service's netns.
  if (typeof svc.network_mode === "string") {
    const m = svc.network_mode.match(/^service:(.+)$/);
    if (m && renameMap[m[1]]) svc.network_mode = `service:${renameMap[m[1]]}`;
  }
  // volumes_from / links: "<name>" or "<name>:<suffix>".
  for (const field of ["volumes_from", "links"]) {
    if (Array.isArray(svc[field])) {
      svc[field] = svc[field].map((entry) => {
        const [name, ...rest] = String(entry).split(":");
        return renameMap[name] ? [renameMap[name], ...rest].join(":") : entry;
      });
    }
  }
}

function diffServiceConfig(a, b) {
  const IGNORE = new Set(["container_name", "labels", "ports"]);  // ports už doplníme z hostPorts
  const diffs = [];
  const aKeys = new Set(Object.keys(a || {}));
  const bKeys = new Set(Object.keys(b || {}));
  for (const k of new Set([...aKeys, ...bKeys])) {
    if (IGNORE.has(k)) continue;
    const av = a?.[k];
    const bv = b?.[k];
    if (!stableEqual(av, bv)) {
      const aStr = JSON.stringify(av)?.slice(0, 60) ?? "(missing)";
      const bStr = JSON.stringify(bv)?.slice(0, 60) ?? "(missing)";
      diffs.push(`${k}: ${aStr} → ${bStr}`);
    }
  }
  return diffs;
}

function stableEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => stableEqual(x, b[i]));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((k, i) => k === bKeys[i])) return false;
    return aKeys.every((k) => stableEqual(a[k], b[k]));
  }
  return false;
}

function matchHostPorts(svcName, containerName) {
  const key = matchExposureName(svcName, containerName);
  return key ? hostPorts[key] : null;
}

// Resolve the canonical hostPorts KEY (container role) for a service, using the
// same fuzzy matching matchHostPorts used to use — but returning the KEY so the
// exposure flag (isExposedToHost) and the resolved free-port map are keyed
// correctly. Returns null when no hostPorts entry matches.
function matchExposureName(svcName, containerName) {
  const candidates = [containerName, svcName].filter(Boolean);
  for (const c of candidates) {
    if (hostPorts[c]) return c;
  }
  for (const c of candidates) {
    for (const key of Object.keys(hostPorts)) {
      if (key === c) return key;
      if (key.endsWith(`-${c}`) || c.endsWith(key)) return key;
    }
  }
  return null;
}

function rewriteDomainsInEnv(env) {
  // env can be array of "K=V" or object {K: V}
  if (Array.isArray(env)) {
    return env.map(e => {
      const eq = e.indexOf("=");
      if (eq < 0) return e;
      const k = e.slice(0, eq);
      const v = rewriteDomainStr(e.slice(eq + 1));
      return `${k}=${v}`;
    });
  }
  if (typeof env === "object" && env !== null) {
    const out = {};
    for (const [k, v] of Object.entries(env)) {
      out[k] = typeof v === "string" ? rewriteDomainStr(v) : v;
    }
    return out;
  }
  return env;
}

function rewriteDomainStr(s) {
  // Replace `https?://localhost/...` → `http://localhost:<port>/...` based on
  // explicit path-prefix lookup table. Pokud path není v tabulce, fallback
  // na default port pro `localhost` host (gateway 3001).
  //
  // `docker compose config` už rozresolvoval `${X_DOMAIN:-default}` na literal
  // "localhost", takže pracujeme s URLs typu `https://localhost/realms/aisha`.
  if (typeof s !== "string") return s;
  // DB DSN host: the prod compose reaches Postgres via the bare service key `@db:5432`,
  // which resolves only through Compose's IMPLICIT service-name alias — fragile once the
  // local generator namespaces container_names + adds per-service network aliases (and the
  // hand-created LOCAL_STACK net). The db service's EXPLICIT, always-present alias is
  // `aisha-db` (already used by every other cross-stack consumer: langfuse/openclaw/matrix/
  // realtime/llm-gateway), so pin DB DSN hosts to it. Fixes the whole @db:5432 class at once
  // (svc-env anchor, migrate, postgrest, gateway) — not just the postgrest symptom.
  s = s.replace(/@db:(\d+)/g, `@${INSTANCE_PREFIX}-db:$1`);
  return s.replace(/https?:\/\/localhost(?::\d+)?(\/[^\s"']*)?/g, (_match, path = "") => {
    const port = lookupPortForPath(path) || domainToHostPort.API_DOMAIN.port;
    return `http://localhost:${port}${path}`;
  });
}

function lookupPortForPath(path) {
  if (!path) return null;
  for (const hint of DOMAIN_PATH_HINTS) {
    if (path.startsWith(hint.pathPrefix) && hint.domainKey) {
      const dh = domainToHostPort[hint.domainKey];
      if (dh) return dh.port;
    }
  }
  return null;
}

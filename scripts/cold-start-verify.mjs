#!/usr/bin/env node
/**
 * cold-start-verify.mjs - read-only production verifier for AISHA cold-starts.
 *
 * This script intentionally does not patch Coolify, restart apps, or mutate any
 * external state. Use it after cold-start/redeploy to separate real service
 * failures from stale health scripts or cosmetic Coolify compose statuses.
 *
 * Probe plan = curated checks (precise paths/codes per service) ∪ topology
 * derived coverage: every `*_DOMAIN` / `*_DOMAIN_PUBLIC` hostname emitted by
 * scripts/lib/derive-domains.mjs that lacks a curated probe gets a generic
 * route-exists check (GET / must NOT be an edge 404), and the apex (bare
 * PUBLIC_TLD, when != APP_DOMAIN) must answer 308 → https://${APP_DOMAIN}.
 * The closed loop is locked by src/tests/gates/domain-coverage.gate.test.ts.
 *
 * Flags:
 *   --json                  structured output (additive `domainCoverage` block)
 *   --skip-coolify          skip the Coolify app-status API section
 *   --skip-public-aliases   skip cookie-domain public-alias probes
 *   --skip-domain-coverage  curated probes only (no topology-derived checks)
 *   --print-coverage        print the probe plan as JSON and exit (no network)
 *   --timeout-ms=N          per-probe timeout (default 10000)
 *
 * Dveře (svc-knock): verify zná jejich vztah k instanci — deklarace ↔ profil na
 * aplikaci edge, režim ↔ roster, ruční port ↔ deklarace operátora, adresa
 * verdiktu s identitou, posluchač (zdraví edge = healthcheck svc-knock: netns
 * + /ready PING do mapy) a kolize veřejných UDP portů s cizími projekty.
 * Zaklepat NEUMÍ — vyhrazené pověření pro klepání z pracovní stanice není
 * rozhodnuté a CI klepat nesmí; výstup to říká jako NEZMĚŘENO.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopology, formatShellExports } from "./lib/derive-domains.mjs";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { createProjectScope, resolveProjectName } from "./lib/coolify-project-scope.mjs";
import { ctenarSouboru, vadyDveri, zmerDvereNaAplikaci } from "./lib/dvere-soulad.mjs";
import { resolveInstanceIdentity, resolveManifestPath } from "./lib/coolify-instance-scope.mjs";
import { vlastnictviProstredi } from "./lib/vlastnictvi-aplikaci.mjs";
import { judgeResponse } from "./lib/routing-probe.mjs";
import { jeProkazatelneZdrava, klasifikovatStavAppky } from "./lib/coolify-app-status.mjs";
import { porovnej } from "./lib/razeni.mjs";
import { CONFIG_ENV_FILES } from "./lib/config-env-files.mjs";
import { drzeniProcesu } from "./lib/coolify-mutace.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const hasFlag = (name) => argv.includes(name);
const argValue = (name, fallback = "") => {
  const match = argv.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
};

const JSON_OUTPUT = hasFlag("--json");
const SKIP_COOLIFY = hasFlag("--skip-coolify");
const SKIP_PUBLIC_ALIASES = hasFlag("--skip-public-aliases");
// --skip-domain-coverage: opt out of the topology-derived probes (apex +
// generic route-exists checks) and keep only the curated list below.
const SKIP_DOMAIN_COVERAGE = hasFlag("--skip-domain-coverage");
// --print-coverage: emit the computed probe plan as JSON WITHOUT touching the
// network (no HTTP probes, no Coolify API). Consumed by the
// domain-coverage gate to assert the closed loop offline.
const PRINT_COVERAGE = hasFlag("--print-coverage");
const TIMEOUT_MS = Number(argValue("--timeout-ms", "10000"));

// Per-fork Coolify namespace. Default `aisha` matches upstream evymo deploy;
// forks set APP_NAME_PREFIX (e.g. acme) in their
// config/domains-<env>.env overlay → cold-start sources it before verify runs.
// ⚠️ ŽÁDNÝ default na "aisha": tenhle prefix rozhoduje, ČÍ aplikace se ověřují.
// Pořadí APP_NAME_PREFIX→AISHA_STORY je deklarované v lib/coolify-project-scope.mjs; neopisuje se.
const APP_NAME_PREFIX = resolveProjectName();

/**
 * Fail-closed patří tam, kde se ROZHODUJE, ne na vstup do souboru.
 *
 * Prefix vybírá, ČÍ aplikace se ověřují (`startswith("<prefix>-")`), takže bez
 * něj se ověřovat nedá. `--print-coverage` ale jen vypisuje plán sond a na
 * žádnou instanci nesahá — kontrola na začátku modulu ho zbytečně zabila
 * (naměřeno bránou domain-coverage, která ten režim volá).
 */
function requirePrefix() {
  if (APP_NAME_PREFIX) return APP_NAME_PREFIX;
  console.error("FATAL: APP_NAME_PREFIX ani AISHA_STORY nejsou nastavené — nevím, KTEROU instanci mám ověřit.");
  console.error("       Výchozí hodnota se ZÁMĚRNĚ nedosazuje: dosazené 'aisha' by ověřovalo cizí aplikace.");
  process.exit(2);
}

// All domain values now come from config/domains.env (SoT) or process.env.
// Iter 13 dropped the in-script DEFAULTS map per the template-only directive
// — no hardcoded deployment hostnames committed to the repo. Operator sets
// these via config/domains.env (and per-env overlays like domains-acme.env)
// before invoking cold-start-verify.
const DEFAULTS = {
  KEYCLOAK_REALM: "aisha", // brand identity, not deployment-specific
};

function loadEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (const [key, value] of Object.entries(env)) {
      env[key] = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] ?? "");
    }
  }
  return env;
}

// config/domains.env is template-only (iter 15): raw `${X:-}` forms only
// expand when sourced by bash. Whatever survives loadEnvFile's `${X}` passes
// with a literal `${` is an unresolved template, not a value — drop it so it
// never leaks into probe URLs (and so the resolver self-heal below can fill it).
function sanitizeEnvMap(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string" && value.includes("${")) continue;
    out[key] = value;
  }
  return out;
}

const domainEnv = sanitizeEnvMap(loadEnvFile(resolve(ROOT, "config/domains.env")));
const env = { ...DEFAULTS, ...domainEnv, ...process.env };

// ── Closed-loop domain coverage (topology resolver = SoT) ───────────────────
// The curated probe list below is hand-maintained: it carries the right paths
// and expected codes per service, but a NEW *_DOMAIN key emitted by the
// topology resolver never automatically joined verification — that's exactly
// how the unrouted apex (bare PUBLIC_TLD → edge 404) escaped detection on the
// 2026-06-12 post-wipe cold-start. The resolver output is therefore enumerated
// here: every resolved hostname without a curated probe gets a generic
// route-exists check, and the apex gets an explicit 308-redirect probe.
function resolveTopologyDomains() {
  try {
    const topo = buildTopology({});
    const domains = {};
    const tlds = {};
    for (const line of formatShellExports(topo).split("\n")) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (key === "PUBLIC_TLD" || key === "INTERNAL_TLD" || key === "MESH_TLD") {
        tlds[key] = value;
        continue;
      }
      if (!/_DOMAIN$|_DOMAIN_(PUBLIC|INTERNAL)$/.test(key)) continue;
      // Alias-scope INTERNAL forms (e.g. APP_INTERNAL_DOMAIN for the
      // public-canonical web service) are convenience emissions — no routing
      // plane (deploy-init, domain doctor, Traefik labels) registers them.
      // The routing contract is each service's CANONICAL scope + its public
      // faces; only those join coverage.
      if (/_INTERNAL_DOMAIN$|_DOMAIN_INTERNAL$/.test(key)) continue;
      // Unroutable sentinels (RFC 6761 `.invalid`, e.g. the disabled apex
      // redirect) are intentionally not served — never probe them.
      if (!value || value.endsWith(".invalid")) continue;
      domains[key] = value;
    }
    return { domains, tlds, profile: topo.profile, error: "" };
  } catch (error) {
    return { domains: {}, tlds: {}, profile: "", error: error.message };
  }
}

const topology = SKIP_DOMAIN_COVERAGE
  ? { domains: {}, tlds: {}, profile: "", error: "skipped (--skip-domain-coverage)" }
  : resolveTopologyDomains();

// Self-heal env gaps from the resolver (mirrors cold-start, where the resolver
// populates *_DOMAIN before domains.env is sourced). Operator env always wins —
// only keys missing entirely are filled.
for (const [key, value] of Object.entries({ ...topology.tlds, ...topology.domains })) {
  if (!env[key]) env[key] = value;
}
// n8n public face: dedicated key when the operator declares one, else the MCP
// alias (both hostnames route to the same n8n backend through edge-proxy —
// same fallback scripts/smoke-routing.sh uses).
if (!env.N8N_PUBLIC_DOMAIN && env.MCP_DOMAIN) env.N8N_PUBLIC_DOMAIN = env.MCP_DOMAIN;

function httpsUrl(domain, path = "/") {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${domain}${cleanPath}`;
}

function expectedLabel(codes) {
  return codes.join(",");
}

function cookieDomainLabel(domains) {
  return domains.length > 0 ? domains.join(",") : "none";
}

function readSetCookieDomains(headers) {
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return cookies
    .map((cookie) => cookie.match(/(?:^|;)\s*Domain=([^;]+)/i)?.[1]?.replace(/^\./, "") ?? "")
    .filter(Boolean);
}

function cookieDomainMatches(domains, expectedDomain) {
  const normalizedExpected = expectedDomain.replace(/^\./, "");
  return domains.some((domain) => domain.replace(/^\./, "") === normalizedExpected);
}

async function fetchStatus(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "aisha-cold-start-verify/1" },
    });
    // Celá hlavičková mapa jde dál, aby verdikt mohl posoudit i to, co
    // stavový kód neřekne (podpis odražeče, výchozí 404 edge) — viz
    // `judgeResponse` v scripts/lib/routing-probe.mjs.
    const headers = {};
    for (const [k, v] of response.headers) headers[k.toLowerCase()] = v;
    const cl = headers["content-length"];
    return {
      ok: true,
      code: response.status,
      contentType: response.headers.get("content-type") ?? "",
      location: response.headers.get("location") ?? "",
      cookieDomains: readSetCookieDomains(response.headers),
      headers,
      bodyLen: cl != null ? parseInt(cl, 10) : null,
    };
  } catch (error) {
    return { ok: false, code: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Status + body probe with optional request headers (e.g. the intranet key for
// gateway /source). Returns the body so a check can assert on content. The
// caller MUST NOT persist `headers` into the results payload — some carry
// secrets (INTRANET_API_KEY). Redirect is manual so a login-page 302 is a code,
// not a followed redirect.
async function fetchProbe(url, { headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "aisha-cold-start-verify/1", ...headers },
    });
    // A body-read failure on an otherwise-answered probe is a real failure for
    // our content asserts, so let it fall to the error branch below (no silent
    // inner catch) — same shape as fetchStatus.
    const body = await response.text();
    return { ok: true, code: response.status, body };
  } catch (error) {
    return { ok: false, code: 0, body: "", error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function loadCoolifyToken() {
  if (process.env.COOLIFY_API_TOKEN) return process.env.COOLIFY_API_TOKEN.replace(/^['"]|['"]$/g, "");
  const tokenFile = resolve(ROOT, ".env-prod-backup");
  if (!existsSync(tokenFile)) return "";
  for (const line of readFileSync(tokenFile, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

async function fetchCoolifyApps() {
  const token = loadCoolifyToken();
  // No token = intentionally credential-less read-only run (documented mode);
  // explicit --skip-coolify = operator opt-out. Both are visibly labeled
  // `skipped` in the output. Everything else must be a REAL answer or a
  // REAL failure — an API error must never silently drop the app-status
  // assertions (fail-open verifier ≙ no verifier).
  if (!token || SKIP_COOLIFY) return { skipped: true, apps: [] };
  const baseEnv = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
  if (!baseEnv) return { skipped: false, apps: [], error: "COOLIFY_URL (or COOLIFY_BASE_URL) required when COOLIFY_API_TOKEN is set" };
  try {
    // Shared retry/timeout client (scripts/lib/coolify-http.mjs) — same 60s +
    // backoff behavior as coolify-domain-doctor.mjs. The old 10s single-shot
    // fetch aborted during Coolify slow stretches while the doctor succeeded,
    // and the abort was then silently swallowed.
    const coolify = createCoolifyClient({ baseUrl: baseEnv, token });
    const apps = (await coolify("/applications"))
      .filter((app) => app.name?.startsWith(`${requirePrefix()}-`))
      .map((app) => ({ name: app.name, status: app.status || "unknown", last_online_at: app.last_online_at || "" }))
      .sort((left, right) => porovnej(left.name, right.name));
    return { skipped: false, apps };
  } catch (error) {
    return { skipped: false, error: error.message, apps: [] };
  }
}

// Story name drives the manifest path (coolify/manifests/${STORY}.manifest) and
// the app namespace, exactly like aisha-cold-start.sh:63.
//
// Ptá se TÉHOŽ domova jako prefix výš — `AISHA_STORY` je jen druhý pravopis téže
// deklarace a jeho kanály jsou tytéž. Dřív tu stálo `process.env.AISHA_STORY`,
// tedy jen prostředí: v repu riqu z toho vyšlo prázdno, cesta se složila na
// `coolify/manifests/.manifest` a verify spadl na ENOENT (naměřeno 2026-08-14).
const IDENTITY = resolveInstanceIdentity({ required: false });
const STORY = IDENTITY.story || APP_NAME_PREFIX;
const IDENTITY_SOURCE = IDENTITY.source;

// ── Expected Coolify apps: derived from the deploy SoT (the manifest) ───────
// coolify/manifests/${STORY}.manifest drives coolify-story-init.sh — the exact
// set of apps a cold-start creates. The old hand-maintained 13-role list had
// drifted 8 apps behind (shared-redis/ai-chat/realtime/llm-gateway/openclaw/
// clamav/observability-stack/source-broker), so missing apps went undetected.
// source-broker mirrors story-init's provisioning condition: the app exists
// only when SOURCE_API_URL is set (federation opt-in). Parses the app GROUP
// (role:GROUP:compose) so the status verdict can hold `experimental` apps
// (ledger/exec) to a softer bar — they may be intentionally stopped.
//
// ⛔ 2026-10-04: čtení šlo napřímo na `coolify/manifests/${STORY}.manifest` (overlay
// instance i MANIFEST_FILE ignorovalo) a vlastním regexem `^app:` — a čekalo i služby,
// které tohle prostředí NEVLASTNÍ (profil: external_domain, např. sdílený Keycloak),
// takže by staging s cizím Keycloakem hlásil „chybí aplikace“. Teď týmž resolverem
// manifestu jako ostatní nástroje a jen VLASTNÍ aplikace (domov vlastnictví).
function expectedAppsFromManifest() {
  const manifestPath = resolveManifestPath({ explicit: process.env.MANIFEST_FILE || undefined, explicitHint: "MANIFEST_FILE=<path>" });
  const vl = vlastnictviProstredi({ manifest: manifestPath });
  for (const x of vl.externi) console.log(`  ${x.hlaska} — její aplikaci neočekávám`);
  const entries = vl.vlastni
    .map((a) => ({ role: a.role, group: a.slot }))
    .filter((e) => e.role !== "source-broker" || Boolean(process.env.SOURCE_API_URL));
  if (entries.length === 0) {
    throw new Error(`No app entries parsed from ${manifestPath} — manifest format changed?`);
  }
  // Fail loud on an undeclared instance (upstream's requirePrefix) while keeping
  // the manifest-driven split: `required` gates the verdict, `all` is reported.
  // The experimental plane (ledger/exec) may be intentionally stopped, so it must
  // not fail a cold-start that is otherwise complete.
  const prefix = requirePrefix();
  const all = entries.map((e) => `${prefix}-${e.role}`);
  const required = entries
    .filter((e) => e.group !== "experimental")
    .map((e) => `${prefix}-${e.role}`);
  return { all, required };
}

const checks = [
  { group: "canonical", name: "gateway health", url: httpsUrl(env.API_DOMAIN, "/health"), expect: [200] },
  { group: "canonical", name: "PostgREST", url: httpsUrl(env.API_DOMAIN, "/rest/v1/"), expect: [200] },
  { group: "canonical", name: "web", url: httpsUrl(env.APP_DOMAIN, "/"), expect: [200] },
  { group: "canonical", name: "Keycloak OIDC", url: httpsUrl(env.KEYCLOAK_DOMAIN, `/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`), expect: [200] },
  { group: "canonical", name: "n8n direct", url: httpsUrl(env.N8N_DOMAIN, "/healthz"), expect: [200] },
  { group: "canonical", name: "Langfuse", url: httpsUrl(env.LANGFUSE_DOMAIN, "/api/public/health"), expect: [200] },
  { group: "canonical", name: "NocoDB", url: httpsUrl(env.NOCODB_DOMAIN, "/"), expect: [200, 302] },
  { group: "canonical", name: "Appsmith", url: httpsUrl(env.APPSMITH_DOMAIN, "/"), expect: [200, 302] },
  { group: "canonical", name: "PKI", url: httpsUrl(env.PKI_DOMAIN, "/"), expect: [200, 302] },
  { group: "canonical", name: "Matrix Synapse", url: httpsUrl(env.MATRIX_DOMAIN, "/_matrix/client/versions"), expect: [200] },
  { group: "canonical", name: "Element Web", url: httpsUrl(env.ELEMENT_DOMAIN, "/"), expect: [200] },
  { group: "canonical", name: "Element Call", url: httpsUrl(env.ELEMENT_CALL_DOMAIN, "/"), expect: [200] },
  { group: "public", name: "NetBird", url: httpsUrl(env.NETBIRD_DOMAIN, "/"), expect: [200] },
  { group: "public", name: "Registry cache", url: httpsUrl(env.REGISTRY_DOMAIN, "/v2/"), expect: [200, 401] },
];

if (!SKIP_PUBLIC_ALIASES) {
  // Public-alias cookies must scope to the registrable parent zone of the
  // public app domain (PUBLIC_TLD, the SoT in config/domains.env). Derived,
  // never hardcoded — fail fast so a missing TLD surfaces as a config error
  // rather than a silently-skipped cookie-domain assertion.
  const publicCookieDomain = env.PUBLIC_TLD;
  if (!publicCookieDomain) {
    throw new Error(
      "PUBLIC_TLD is required for public-alias cookie-domain checks. "
      + "Set it in config/domains.env / process.env, or pass --skip-public-aliases.",
    );
  }
  checks.push(
    // NOTE: NO pgAdmin public probe here. db.${PUBLIC_TLD} was intentionally
    // dropped from the routing contract on 2026-05-07 ("db is NOT a publicly
    // provided service" — see scripts/coolify-domain-doctor.mjs aisha-core /
    // pgadmin-auth). The stale curated probe of STUDIO_DOMAIN kept this
    // verifier permanently red on a correctly-configured production until
    // 2026-07-03. The admin-only face is probed below (STUDIO_DOMAIN_DIRECT).
    { group: "public-alias", name: "n8n public alias", url: httpsUrl(env.N8N_PUBLIC_DOMAIN, "/healthz"), expect: [200] },
    { group: "public-alias", name: "n8n public auth", url: httpsUrl(env.N8N_PUBLIC_DOMAIN, "/"), expect: [200, 302], expectCookieDomain: publicCookieDomain },
    // api.${PUBLIC_TLD} — THE public application-gateway face. Curated probe
    // on /health (the gateway 404s on GET /, so the generic route-exists
    // check false-failed the single most important public surface).
    { group: "public-alias", name: "gateway API (public)", url: httpsUrl(env.API_DOMAIN_PUBLIC, "/health"), expect: [200] },
  );
}

// pgAdmin admin-only face (db.backend.${INTERNAL_TLD}, oauth2-proxied).
// STUDIO_DOMAIN_DIRECT is operator/domains.env-scoped (the core catalog entry
// documents pgAdmin as "not modeled here yet"), so the probe is guarded on
// the env var being resolvable — mirrors the LIVE/GATEWAY guard pattern.
if (env.STUDIO_DOMAIN_DIRECT && !env.STUDIO_DOMAIN_DIRECT.includes("${")) {
  checks.push({
    group: "canonical",
    name: "pgAdmin (db internal)",
    url: httpsUrl(env.STUDIO_DOMAIN_DIRECT, "/"),
    expect: [200, 302],
  });
}

// ── Realtime (ws-gateway) — OPTIONAL (tier:optional, absent in
// cloud-single/local-dev). Curated /health probes so the WebSocket host proves
// its route via the real health endpoint instead of the generic GET / coverage
// check: ws-gateway only serves /ws + /health, so GET / would 404 and the
// route-exists codes (no 404) would false-fail an otherwise healthy route.
// Skipped when realtime is filtered out (LIVE_DOMAIN absent or .invalid sentinel).
if (env.LIVE_DOMAIN && !env.LIVE_DOMAIN.endsWith(".invalid")) {
  checks.push({
    group: "canonical",
    name: "ws-gateway (live internal)",
    url: httpsUrl(env.LIVE_DOMAIN, "/health"),
    expect: [200],
  });
}
if (env.LIVE_DOMAIN_PUBLIC && !env.LIVE_DOMAIN_PUBLIC.endsWith(".invalid")) {
  checks.push({
    group: "public-alias",
    name: "ws-gateway (live public)",
    url: httpsUrl(env.LIVE_DOMAIN_PUBLIC, "/health"),
    expect: [200],
  });
}

// ── LLM gateway (IDE proxy surface) — OPTIONAL (tier:optional, capability
// gated). Curated probes: llmgateway serves its health on the ROOT path
// (apps/gateway/src/app.ts — same endpoint its compose healthcheck uses), so
// the generic route-exists check would work but a curated 200 expectation is
// tighter. Both faces matter: gateway.${INTERNAL_TLD} (backend Traefik) and
// gateway.${PUBLIC_TLD} (edge-fronted — ANTHROPIC_BASE_URL for IDEs).
if (env.GATEWAY_DOMAIN && !env.GATEWAY_DOMAIN.endsWith(".invalid")) {
  checks.push({
    group: "canonical",
    name: "llm-gateway (internal)",
    url: httpsUrl(env.GATEWAY_DOMAIN, "/"),
    expect: [200],
  });
}
if (env.GATEWAY_DOMAIN_PUBLIC && !env.GATEWAY_DOMAIN_PUBLIC.endsWith(".invalid")) {
  checks.push({
    group: "public-alias",
    name: "llm-gateway (public)",
    url: httpsUrl(env.GATEWAY_DOMAIN_PUBLIC, "/"),
    expect: [200],
  });
}

// ── OpenClaw companion — OPTIONAL (requires llm-gateway). /health is the
// service's own liveness endpoint (compose healthcheck path).
if (env.COMPANION_DOMAIN && !env.COMPANION_DOMAIN.endsWith(".invalid")) {
  checks.push({
    group: "canonical",
    name: "openclaw (internal)",
    url: httpsUrl(env.COMPANION_DOMAIN, "/health"),
    expect: [200],
  });
}
if (env.COMPANION_DOMAIN_PUBLIC && !env.COMPANION_DOMAIN_PUBLIC.endsWith(".invalid")) {
  checks.push({
    group: "public-alias",
    name: "openclaw (public)",
    url: httpsUrl(env.COMPANION_DOMAIN_PUBLIC, "/health"),
    expect: [200],
  });
}

const ROUTE_EXISTS_CODES = [200, 301, 302, 303, 307, 308, 401, 403];

// ── Apex (bare PUBLIC_TLD) ─────────────────────────────────────────────────
// redirect mode: edge-proxy answers HTTP 308 to the canonical web host.
// serve mode: Coolify routes the apex to the web container and the DB
// branding_hostname_mapping row decides which GrapesJS page is rendered.
// This is env/data driven; no production brand hostname belongs in open code.
const apexMode = String(env.AISHA_WEB_APEX_MODE || "redirect").trim().toLowerCase() === "serve"
  ? "serve"
  : "redirect";
const apex = {
  enabled: !SKIP_DOMAIN_COVERAGE
    && Boolean(env.PUBLIC_TLD) && Boolean(env.APP_DOMAIN)
    && env.PUBLIC_TLD !== env.APP_DOMAIN
    && apexMode === "redirect",
  domain: "",
  redirectTarget: "",
};
if (apex.enabled) {
  apex.domain = env.PUBLIC_TLD;
  apex.redirectTarget = `https://${env.APP_DOMAIN}`;
  checks.push({
    group: "public",
    name: "apex redirect",
    url: httpsUrl(env.PUBLIC_TLD, "/"),
    expect: [308],
    expectLocationPrefix: `https://${env.APP_DOMAIN}`,
  });
} else if (
  !SKIP_DOMAIN_COVERAGE
  && apexMode === "serve"
  && Boolean(env.PUBLIC_TLD)
  && Boolean(env.APP_DOMAIN)
  && env.PUBLIC_TLD !== env.APP_DOMAIN
) {
  checks.push({
    group: "public",
    name: "apex web",
    url: httpsUrl(env.PUBLIC_TLD, "/"),
    expect: ROUTE_EXISTS_CODES,
  });
}

// ── Generic coverage — every resolver-emitted domain must be ROUTED ─────────
// Hosts with a curated probe keep their precise path/code expectations; every
// remaining topology hostname gets a route-exists check on GET /. Any of the
// codes below proves an edge router matched (success, redirect, auth wall);
// an edge 404 or a connection failure means the host is unrouted → FAIL.
if (!SKIP_DOMAIN_COVERAGE) {
  const curatedHosts = new Set(
    checks.map((check) => {
      try {
        return new URL(check.url).hostname;
      } catch {
        return "";
      }
    }),
  );
  const keysByHost = new Map();
  for (const [key, host] of Object.entries(topology.domains)) {
    if (!keysByHost.has(host)) keysByHost.set(host, []);
    keysByHost.get(host).push(key);
  }
  for (const [host, keys] of keysByHost) {
    if (curatedHosts.has(host)) continue;
    checks.push({
      group: "domain-coverage",
      name: `route exists: ${keys[0]}${keys.length > 1 ? ` (+${keys.length - 1} alias)` : ""}`,
      url: httpsUrl(host, "/"),
      expect: ROUTE_EXISTS_CODES,
      genericCoverage: true,
      domainKeys: keys,
    });
  }
}

// ── --print-coverage: emit the probe plan and exit (no network) ─────────────
if (PRINT_COVERAGE) {
  const coverage = {
    profile: topology.profile,
    // ČÍ plán to je. Bez téhle věty vypadá plán sond pro dvě různé instance
    // stejně — a přesně tahle nejednoznačnost stála za pádem verify v repu
    // riqu: prázdná identita složila cestu `coolify/manifests/.manifest` a
    // nástroj skončil na ENOENT, tedy hláškou o souborech, ne o instanci.
    // `source` říká, KTERÝ kanál domova odpověděl (prostředí / .env.local /
    // .env-prod-backup / .env.coolify).
    //
    // Pořadí NENÍ kosmetika: brána domain-coverage hledá začátek JSONu podle
    // `{"profile":` (před ním smí být varování resolveru). Držet `profile`
    // první je levnější než rozbít jejího hledače — a hledač se stejně
    // v témže kroku opravuje, aby na pořadí nezáležel.
    identity: { prefix: APP_NAME_PREFIX, story: STORY, source: IDENTITY_SOURCE },
    manifest: `coolify/manifests/${STORY}.manifest`,
    resolverError: topology.error,
    apex,
    checks: checks.map((check) => ({
      group: check.group,
      name: check.name,
      url: check.url,
      host: (() => {
        try {
          return new URL(check.url).hostname;
        } catch {
          return "";
        }
      })(),
      expect: check.expect,
      ...(check.expectLocationPrefix ? { expectLocationPrefix: check.expectLocationPrefix } : {}),
      ...(check.genericCoverage ? { genericCoverage: true } : {}),
      ...(check.domainKeys ? { domainKeys: check.domainKeys } : {}),
    })),
    topologyDomains: topology.domains,
  };
  await new Promise((resolveWrite) => {
    process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`, resolveWrite);
  });
  process.exit(0);
}

const results = [];
for (const check of checks) {
  const response = await fetchStatus(check.url);
  const cookieDomainError = check.expectCookieDomain && response.ok
    ? !cookieDomainMatches(response.cookieDomains ?? [], check.expectCookieDomain)
    : false;
  const locationError = check.expectLocationPrefix && response.ok
    ? !(response.location ?? "").startsWith(check.expectLocationPrefix)
    : false;
  // Verdikt „žije to" má JEDEN domov. Kurátorovaný nárok (`check.expect`) se
  // předává dál — je bohatší než druh služby a nesmí se zahodit. Přibývá k němu
  // to, co seznam kódů říct neumí: že odpověď VŮBEC PŘIŠLA OD SLUŽBY.
  //
  // ⛔ Bez toho projde na hostu se search doménou i mrtvá služba: neznámé jméno
  // se přeloží na síťovou appliance a ta odpoví přesměrováním, které v seznamu
  // očekávaných kódů typicky je.
  let verdikt = { routed: response.ok };
  if (response.ok) {
    const u = new URL(check.url);
    verdikt = judgeResponse(
      { status: response.code, headers: response.headers ?? {}, bodyLen: response.bodyLen ?? null },
      { host: u.host, path: `${u.pathname}${u.search}`, expect: check.expect },
    );
  }
  const pass = response.ok && verdikt.routed && !cookieDomainError && !locationError;
  results.push({ ...check, ...response, cookieDomainError, locationError, pass, duvod: verdikt.reason });
}

// ── Curated instance/federation probes (env-gated, additive) ────────────────
// Extend the status-only checks with header-authenticated + body-asserted
// probes so "green" means the instance is functional end-to-end, not just that
// routes exist. Each is SKIPPED (simply not added) when its gating env is
// absent, so upstream aisha and non-federated forks are unaffected.
const curated = [];

// source-broker liveness (federation opt-in). A curated probe of /healthz keeps
// the broker host out of the generic route-exists coverage (Fastify 404 on `/`
// would otherwise read as a false-red).
if (env.BROKER_DOMAIN && env.SOURCE_API_URL) {
  curated.push({ group: "federation", name: "source-broker healthz", url: httpsUrl(env.BROKER_DOMAIN, "/healthz"), expect: [200] });
}

// Live federated read through gateway → broker → the instance's source plugin. A 200
// here transitively proves the story-binding row (the instance's source-story seed), the
// readonly grant on the source DB, and SOURCE_PG_URL — the whole /source path.
if (env.SOURCE_API_URL && env.INTRANET_API_KEY && env.SOURCE_ADAPTER_STORY_ID) {
  curated.push({
    group: "federation",
    name: "gateway /source kpi",
    url: httpsUrl(env.API_DOMAIN, `/source/${env.SOURCE_ADAPTER_STORY_ID}/kpi`),
    expect: [200],
    headers: { "X-Intranet-Api-Key": env.INTRANET_API_KEY },
  });
}

// Keycloak CLIENT existence (not just realm): the authorize endpoint serves the
// login page (200/302) for a known client, or 400 + "invalid_client" otherwise.
const kcClientId = env.VITE_KC_CLIENT_ID || env.OIDC_APP_CLIENT_ID;
if (env.KEYCLOAK_DOMAIN && env.KEYCLOAK_REALM && kcClientId) {
  const redirect = env.VITE_AUTH_REDIRECT_URI || (env.APP_DOMAIN ? `https://${env.APP_DOMAIN}/` : "https://localhost/");
  const q = `client_id=${encodeURIComponent(kcClientId)}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(redirect)}`;
  curated.push({
    group: "auth",
    name: `KC client ${kcClientId}`,
    url: httpsUrl(env.KEYCLOAK_DOMAIN, `/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/auth?${q}`),
    expect: [200, 302],
    bodyMustNotContain: ["invalid_client", "Client not found"],
  });
}

// Web branding content-assert (opt-in via AISHA_BRAND_MARKER, e.g. the
// Studio") — proves the web build shipped the instance's brand, not a
// generic/placeholder page. Generic: absent marker → skipped.
if (env.AISHA_BRAND_MARKER && env.APP_DOMAIN) {
  curated.push({
    group: "web",
    name: "web branding",
    url: httpsUrl(env.APP_DOMAIN, "/"),
    expect: [200],
    bodyMustContain: [env.AISHA_BRAND_MARKER],
  });
}

// Story-binding row DIRECT SELECT (PostgREST) — proves the private overlay hook
// applied the instance's source-story seed, independently of the broker. The /source
// kpi probe above proves it transitively; this proves the seed even before the
// broker is reachable. Body must echo the story id (empty array = row missing).
if (env.SERVICE_ROLE_KEY && env.API_DOMAIN && env.SOURCE_ADAPTER_STORY_ID) {
  curated.push({
    group: "federation",
    name: "story-binding row",
    url: httpsUrl(env.API_DOMAIN, `/rest/v1/partner_stories?id=eq.${env.SOURCE_ADAPTER_STORY_ID}&select=id`),
    expect: [200],
    headers: { Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, Accept: "application/json" },
    bodyMustContain: [env.SOURCE_ADAPTER_STORY_ID],
  });
}

// Seed sentinel — proves the private web overlay (01_web.sql) applied its
// branding_hostname_mapping for this instance's public TLD (not the committed
// demo seed). Body must echo the TLD.
if (env.SERVICE_ROLE_KEY && env.API_DOMAIN && env.PUBLIC_TLD) {
  curated.push({
    group: "seed",
    name: "branding sentinel",
    url: httpsUrl(env.API_DOMAIN, `/rest/v1/branding_hostname_mapping?hostname=eq.${env.PUBLIC_TLD}&select=hostname`),
    expect: [200],
    headers: { Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, Accept: "application/json" },
    bodyMustContain: [env.PUBLIC_TLD],
  });
}

// Appsmith extranet cockpit — server-root 200/302 (in the canonical checks
// above) only proves Appsmith is UP, not that the audience cockpit was
// provisioned. Operator declares the published cockpit URL in
// AISHA_APPSMITH_COCKPIT_URL once the extranet provisioning workstream lands;
// until then this is skipped (green stays honest — it does not claim a cockpit
// that was never imported).
if (env.AISHA_APPSMITH_COCKPIT_URL) {
  curated.push({
    group: "cockpit",
    name: "appsmith cockpit app",
    url: env.AISHA_APPSMITH_COCKPIT_URL,
    expect: [200],
  });
}

for (const check of curated) {
  const probe = await fetchProbe(check.url, { headers: check.headers });
  const bodyMissing = Array.isArray(check.bodyMustContain)
    ? !check.bodyMustContain.every((needle) => probe.body.includes(needle))
    : false;
  const bodyForbidden = Array.isArray(check.bodyMustNotContain)
    ? check.bodyMustNotContain.some((needle) => probe.body.includes(needle))
    : false;
  const pass = probe.ok && check.expect.includes(probe.code) && !bodyMissing && !bodyForbidden;
  // Persist a SANITIZED result — never the request `headers` (may hold the
  // INTRANET_API_KEY secret) nor the response body.
  results.push({
    group: check.group,
    name: check.name,
    url: check.url,
    expect: check.expect,
    ok: probe.ok,
    code: probe.code,
    bodyMissing,
    bodyForbidden,
    pass,
  });
}

const diagnostics = [];
const matrix = results.find((result) => result.name === "Matrix Synapse");
if (matrix && !matrix.pass) {
  const logUrl = httpsUrl(env.ELEMENT_DOMAIN, "/_synapse/synapse-startup.log");
  const log = await fetchText(logUrl);
  const duplicateTableMatch = log.match(/DuplicateTable: relation "([^"]+)" already exists/);
  if (duplicateTableMatch) {
    diagnostics.push({
      service: "Matrix Synapse",
      finding: `Synapse database is in a partial-init state (DuplicateTable: relation ${duplicateTableMatch[1]} already exists).`,
      remediation: "Redeploy messaging after synapse-db-init can detect and recreate partial Synapse databases.",
    });
  } else if (log) {
    diagnostics.push({
      service: "Matrix Synapse",
      finding: "Synapse debug log is reachable but did not match a known signature.",
      remediation: `Inspect ${logUrl}`,
    });
  }
}

const coolify = await fetchCoolifyApps();

/**
 * Dveře — koherence souboru i aplikace. 403 z generické sondy výš říká jen
 * „routa existuje"; zda za ní stojí dveře, které instance chce, a v jakém stavu,
 * se měří tady (lib/dvere-soulad.mjs, jen čtení).
 */
async function zmerDvere() {
  const sotCesta = resolve(ROOT, ".env.coolify");
  if (!existsSync(sotCesta)) {
    return { nezmereno: [".env.coolify není — deklaraci dveří nejde přečíst"], vady: [], kolize: [], deklarovano: null };
  }
  const sot = ctenarSouboru(sotCesta);
  const operatorCesta = resolve(ROOT, ".env-prod-backup");
  const operator = existsSync(operatorCesta) ? ctenarSouboru(operatorCesta) : undefined;
  const soubor = vadyDveri(sot, { operator });
  const out = {
    deklarovano: soubor.deklarovano,
    vady: soubor.vady.map((v) => `.env.coolify: ${v}`),
    kolize: [],
    nezmereno: [],
    klepani: `NEZMĚŘENO — vyhrazené pověření pro klepání z pracovní stanice není rozhodnuté (EDGE_DOOR_MODE=${sot("EDGE_DOOR_MODE") || "off"})`,
  };
  const token = loadCoolifyToken();
  const baseUrl = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
  if (!token || SKIP_COOLIFY || !baseUrl) {
    out.nezmereno.push("aplikace: bez Coolify (token/URL/--skip-coolify) — profil a hodnoty na aplikaci nezměřeny");
    return out;
  }
  const client = createCoolifyClient({ baseUrl, token });
  const scope = await createProjectScope(client);
  const r = await zmerDvereNaAplikaci({ coolify: client, inProject: scope.inProject, prefix: requirePrefix(), sot, operator });
  out.vady.push(...r.vady);
  out.kolize.push(...r.kolize);
  out.nezmereno.push(...r.nezmereno);
  if (soubor.deklarovano && r.edge) {
    const stav = coolify.apps?.find((app) => app.name === r.edge)?.status;
    if (stav && !jeProkazatelneZdrava(stav)) {
      out.vady.push(`${r.edge}: posluchač dveří neprokázán — aplikace ${stav} (healthcheck svc-knock měří netns a PING mapy)`);
    }
  }
  return out;
}

let dvere;
try {
  dvere = await zmerDvere();
} catch (error) {
  dvere = { deklarovano: null, vady: [], kolize: [], nezmereno: [], chyba: String(error.message).split("\n")[0] };
}
const dvereFailed = Boolean(dvere.chyba) || dvere.vady.length > 0 || dvere.kolize.length > 0;
const { all: expectedApps, required: requiredApps } = expectedAppsFromManifest();
// ── Deklarované držení (2026-10-04) ──────────────────────────────────────────
// Aplikaci, kterou overlay instance drží (nasazeni-drzene.json), studený start
// záměrně nezaložil, nenasadil ani nerestartoval. Že v Coolify není, stojí nebo
// běží na starší revizi, je tedy DEKLAROVANÝ stav, ne nález: verdikt ji vyjmenuje
// a nehodnotí (jinak by běh instance s držením končil červeně napořád a stálá
// červená by schovala skutečné vady). Deklaraci čte týž domov jako každá mutace;
// nečitelná deklarace verdikt SHODÍ — nevíme, co se hodnotit nemá.
let drzene = new Map();
let drzeniChyba = "";
try {
  const { polozky } = drzeniProcesu("cold-start-verify", { envSoubory: CONFIG_ENV_FILES });
  drzene = new Map(polozky.map((polozka) => [`${requirePrefix()}-${polozka.aplikace}`, polozka]));
} catch (error) {
  drzeniChyba = Array.isArray(error?.chyby) ? `${error.titulek}: ${error.chyby.join("; ")}` : String(error?.message ?? error);
}
const missingApps = coolify.apps?.length
  ? expectedApps.filter((name) => !drzene.has(name) && !coolify.apps.some((app) => app.name === name))
  : [];
// A present-but-crashed app used to pass green (only existence was checked).
// Hold the REQUIRED apps (non-experimental) to a running/healthy status; a
// deployed-but-degraded backend/celery/source-broker now counts against the
// verdict. Experimental (ledger/exec) apps are exempt — they may be stopped.
//
// ⛔ NAMĚŘENO 2026-08-17: ten úmysl výše sem byl napsaný správně, ale měřidlo
// pod ním ho rušilo. Vzor `/running|healthy|online/i` propouštěl i
// `exited:unhealthy`, protože slovo `unhealthy` OBSAHUJE `healthy`. Verifier
// proto hlásil „0 unhealthy app(s)" ve chvíli, kdy bylo 18 z 34 aplikací
// nezdravých — včetně `<fork>-edge`, kvůli které vracelo všechno veřejné 503.
// Verdikt teď dává jediný primitiv, který porovnává CELÉ hodnoty.
const unhealthyApps = coolify.apps?.length
  ? coolify.apps
      .filter((app) => requiredApps.includes(app.name) && !drzene.has(app.name) && !jeProkazatelneZdrava(app.status))
      .map((app) => `${app.name}(${app.status} — ${klasifikovatStavAppky(app.status).duvod})`)
  : [];

const failed = results.filter((result) => !result.pass);
// Fail-loud contract: a Coolify API error is a verification FAILURE, not a
// skip — a full Coolify outage must not produce a green verifier. Only the
// explicitly labeled skip paths (no token / --skip-coolify) bypass the
// app-status section.
const coolifyFailed = Boolean(coolify.error);
const payload = {
  ok: failed.length === 0 && missingApps.length === 0 && unhealthyApps.length === 0 && !coolifyFailed && !dvereFailed && !drzeniChyba,
  drzeneAplikace: [...drzene.keys()],
  drzeniChyba,
  results,
  dvere,
  diagnostics,
  coolify,
  missingApps,
  unhealthyApps,
  // Additive (backward-compatible) summary of the topology-derived coverage.
  domainCoverage: {
    skipped: SKIP_DOMAIN_COVERAGE,
    profile: topology.profile,
    resolverError: topology.error,
    apex,
    derivedDomainKeys: Object.keys(topology.domains).length,
    genericProbes: results.filter((result) => result.genericCoverage).length,
  },
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("AISHA cold-start verifier (read-only)\n");
  for (const result of results) {
    const label = result.pass ? "OK  " : "FAIL";
    const code = result.ok ? String(result.code).padEnd(3) : "ERR";
    const cookieInfo = result.expectCookieDomain
      ? ` cookieDomain=${cookieDomainLabel(result.cookieDomains ?? [])} expectedCookie=${result.expectCookieDomain}`
      : "";
    const locationInfo = result.expectLocationPrefix
      ? ` location=${result.location || "none"} expectedLocation=${result.expectLocationPrefix}*`
      : "";
    console.log(`${label} ${result.group.padEnd(13)} ${result.name.padEnd(22)} ${code} expected=${expectedLabel(result.expect).padEnd(7)} ${result.url}${cookieInfo}${locationInfo}`);
  }

  if (coolify.skipped) {
    console.log("\nCoolify: skipped (no token or --skip-coolify)");
  } else if (coolify.error) {
    console.log(`\nFAIL Coolify API: ${coolify.error} (app-status assertions could not run — counts against the verdict)`);
  } else {
    console.log("\nCoolify app status:");
    for (const app of coolify.apps) {
      console.log(`  ${app.name.padEnd(22)} ${app.status}`);
    }
  }

  if (drzeniChyba) {
    console.log(`\nFAIL deklarace držení aplikací: ${drzeniChyba}`);
  } else if (drzene.size > 0) {
    console.log("\nDRŽENÉ aplikace (deklarace v overlayi instance — stav se nehodnotí):");
    for (const [jmeno, polozka] of drzene) {
      const stav = coolify.apps?.find((app) => app.name === jmeno)?.status ?? "v Coolify není";
      console.log(`  DRŽENO: ${polozka.aplikace} — ${polozka.duvod} (${jmeno}: ${stav})`);
    }
  }
  if (missingApps.length > 0) {
    console.log(`\nMissing Coolify apps: ${missingApps.join(", ")}`);
  }
  if (unhealthyApps.length > 0) {
    console.log(`\nUnhealthy Coolify apps (required, not running/healthy): ${unhealthyApps.join(", ")}`);
  }
  if (diagnostics.length > 0) {
    console.log("\nDiagnostics:");
    for (const item of diagnostics) {
      console.log(`  ${item.service}: ${item.finding}`);
      console.log(`    ${item.remediation}`);
    }
  }
  console.log(`\nDveře (${dvere.deklarovano === null ? "deklarace nezměřena" : dvere.deklarovano ? "deklarované" : "nedeklarované"}):`);
  if (dvere.chyba) console.log(`  FAIL měření: ${dvere.chyba}`);
  for (const v of dvere.vady) console.log(`  FAIL ${v}`);
  for (const k of dvere.kolize) console.log(`  FAIL kolize UDP: ${k}`);
  for (const n of dvere.nezmereno) console.log(`  NEZMĚŘENO ${n}`);
  if (dvere.klepani) console.log(`  klepání: ${dvere.klepani}`);
  if (!dvereFailed && !dvere.nezmereno.length) console.log("  OK soulad deklarace, aplikace a portů");
  console.log(`\nSummary: ${payload.ok ? "OK" : "FAIL"} (${failed.length} HTTP failure(s), ${missingApps.length} missing app(s), ${unhealthyApps.length} unhealthy app(s)${coolifyFailed ? ", Coolify API unavailable" : ""}${dvereFailed ? ", dveře v rozporu" : ""})`);
}

process.exit(payload.ok ? 0 : 1);

// =============================================================================
// Local deployment configuration (presets for local "deploy" / warmup)
// =============================================================================
// This file *is* the local equivalent of the production deployment configuration
// (config/domains.env + config/coolify-environments.env + .env-prod-backup +
// operator secrets).
//
// Local development is conceptually a "deploy" of the same production manifests
// and docker-compose.coolify-*.yml files, but targeted at plain Docker Compose
// instead of Coolify:
//
//   - Same manifest (coolify/manifests/aisha.manifest)
//   - Same base compose files
//   - "Story init" + compose transform  → local-compose-gen.mjs + hostPorts
//   - "Env init / deploy-init"          → devEnvDefaults + writeDevEnvFile
//   - "Redeploy / wave orchestration"   → direct `docker compose up` (or
//                                          local-warmup for presets)
//
// The `devEnvDefaults`, `hostPorts`, `presets` and `stackDependencies` here
// are the pre-set "local environment" values — the local counterpart to the
// generated .env.coolify + per-app envs in production.
//
// After running the local deploy (npm run setup or npm run warmup:local),
// all relevant vars are available (in .env, the generated compose, or the
// running containers). Scripts should prefer those over hard-coded fallbacks.
//
// Filozofie: minimalistický dev setup bez Coolify/Traefik. Inter-service traffic
// přes Docker service names; host access přes localhost:port z hostPorts.
// =============================================================================

import { buildTopology, formatShellExports, internalEndpointUrlFor, internalUrlFor, keycloakExtraHostAlias } from "../scripts/lib/derive-domains.mjs";
import { gatewayTrustedProxies, NETBIRD_PEER_CIDR } from "../scripts/lib/derive-subnets.mjs";
import { createHmac } from "node:crypto";
import { createConnection } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Real LLM provider keys for the LOCAL stack ──────────────────────────────
// AISHA's serviceable pool = providers that actually hold a key. For real-conditions
// testing against the dev stack we source the provider keys (operator shell env wins,
// then .env.coolify, then .env-prod-backup), staying empty when none are present
// (cold-start parity — the local stack must still come up without prod secrets).
// Same precedence as scripts/lib/eval-capabilities.mjs (later wins).
const _REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function _readEnvFileSafe(p) {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
const _coolifyEnv = _readEnvFileSafe(join(_REPO_ROOT, ".env.coolify"));
const _prodBackupEnv = _readEnvFileSafe(join(_REPO_ROOT, ".env-prod-backup"));
/** Resolve a provider key: shell env → .env.coolify → .env-prod-backup → "" (empty if none). */
function resolveLlmProviderKey(name) {
  return process.env[name] || _coolifyEnv[name] || _prodBackupEnv[name] || "";
}

// Public/edge domains derive from the SAME source of truth as prod —
// scripts/lib/derive-domains.mjs with the `local-dev` profile, reading
// config/services.json + config/profiles/local-dev.json. Nothing below is a
// hardcoded brand/TLD literal: e.g. n8n and its mcp/dirigent public aliases are
// ONE orchestration service exposed under three faces (services.json
// public_aliases), so they are derived together (n8n.local / mcp.local /
// dirigent.local) rather than written as three independent constants.
let _topoDeriveError = null;
const localTopoEnv = (() => {
  const env = {};
  try {
    for (const line of formatShellExports(buildTopology({ profileId: "local-dev" })).split("\n")) {
      const eq = line.startsWith("#") ? -1 : line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
    }
  } catch (err) {
    // Zapamatovat, ne jen zalogovat: kontroly níž (INSTANCE_PREFIX) musí umět
    // rozlišit „derivace selhala" od „derivace proběhla a hodnota chybí" —
    // jinak by hlásily příčinu, kterou si vymyslely.
    _topoDeriveError = err;
    console.warn(`[local-presets] derive-domains(local-dev) failed; domains underived: ${err.message}`);
  }
  return env;
})();

// ── Local hostnames — ONE rule, ONE place ──────────────────────────────────
// Every compose-label *_DOMAIN below = `<service subdomain>.${LOCAL_TLD}`, where
// LOCAL_TLD is the local-dev profile's TLD (from the resolver, not a literal) and
// the subdomains mirror config/services.json (prod & local agree on the label;
// only the profile's TLD differs). n8n + its mcp/dirigent aliases are ONE
// orchestration service under three faces. Single mechanism — no localhost/.local
// mix, no per-service literals, no duplicate keys.
// IMPORTANT: host ACCESS is a deliberately SEPARATE mechanism (localhost:port via
// hostPorts + getLocal*Url() + the *_PUBLIC / *_DIRECT / VITE_* values + the
// *_TLD zone vars) — those stay localhost-resolvable on purpose and are NOT
// derived here. The two never mix, so there is nothing confusing to reconcile.
const LOCAL_TLD = localTopoEnv.PUBLIC_TLD || "local";
const ld = (sub) => `${sub}.${LOCAL_TLD}`;

// Identita instance — JEDEN domov, žádné dosazení. Do 2026-08-08 se tu na čtyřech
// místech dosazovalo jméno "local"; jmenovalo to sice vlastní vývojářskou
// instanci, ne cizí, ale zůstávalo to výchozí hodnotou — a ta je tichá
// domněnka i tehdy, když je zrovna správná. Na sdíleném Coolify rozhoduje prefix
// o tom, ČÍ aplikaci nástroj najde a co smaže, takže se deklaruje, ne odhaduje.
// Exportovaný: jméno kontejneru se SKLÁDÁ z identity, neopisuje se. Bez tohohle
// exportu si local-compose-gen prefix psal natvrdo (`aisha-db`, `aisha-gateway`,
// …) — dva soubory téhož lokálního stacku, jeden odvozoval a druhý opisoval.
// ⛔ 2026-08-25: JEDEN domov pro lokální realm. Do dneška byl literál `aisha`
// opsaný na DVOU místech (KEYCLOAK_REALM a VITE_KC_AUTHORITY). Změna jednoho
// tiše rozešla druhý — a přesně tahle neshoda vydavatele shodila fázi D
// v produkci: token z jednoho realmu, očekávaný `iss` z druhého, výsledkem
// `no valid authentication provided` na každý token.
export const LOCAL_KC_REALM = "aisha";

export const INSTANCE_PREFIX = (() => {
  const v = (localTopoEnv.APP_NAME_PREFIX ?? "").trim();
  if (!v) {
    // Dvě různé příčiny, dvě různé pravdy — nezaměňovat. Když spadla samotná
    // derivace topologie, profil hodnotu klidně nést může; jen se k ní nikdo
    // nedostal. Obvinit v té chvíli profil = diagnóza odpovídající na jinou
    // otázku, než co se stalo.
    if (_topoDeriveError) {
      throw new Error(
        "APP_NAME_PREFIX nelze odvodit: derive-domains(local-dev) selhal dřív, " +
          `než mohl identitu doručit: ${_topoDeriveError.message}\n` +
          "  Oprav vstupy topologie (config/services.json, config/profiles/local-dev.json, " +
          "coolify/servers.json) — deklarace identity v profilu může být v pořádku.",
      );
    }
    throw new Error(
      "APP_NAME_PREFIX nelze odvodit: profil `local-dev` nenese `app_name_prefix` " +
        "a proměnná APP_NAME_PREFIX ho nepřebíjí.\n" +
        "  Domov hodnoty je config/profiles/local-dev.json — deklaruj ji tam, ne tady.\n" +
        "  (Compose ji čte jako ${APP_NAME_PREFIX:?…}, takže bez ní se stejně nevyrenderuje.)",
    );
  }
  return v;
})();
const localDomains = {
  TURN_DOMAIN: ld("turn"),
  KEYCLOAK_DOMAIN: ld("auth"),
  // Mesh-INDEPENDENT KC host (KC Traefik direct router + edge auth upstream).
  // Local dev has no mesh, so direct == the local KC domain.
  KEYCLOAK_DOMAIN_DIRECT: ld("auth"),
  PKI_DOMAIN: ld("pki"),
  PKI_BRIDGE_DOMAIN: ld("pki-bridge"),
  NETBIRD_DOMAIN: ld("netbird"),
  STUDIO_DOMAIN: ld("db"),
  APP_DOMAIN: ld("web"),
  API_DOMAIN: ld("api"),
  NOCODB_DOMAIN: ld("nocodb"),
  APPSMITH_DOMAIN: ld("appsmith"),
  INTRANET_DOMAIN: ld("intranet"),
  LANGFUSE_DOMAIN: ld("langfuse"),
  LIVEKIT_DOMAIN: ld("livekit"),
  REGISTRY_DOMAIN: ld("cache"),
  DOZZLE_DOMAIN: ld("logs"),
  MATRIX_DOMAIN: ld("matrix"),
  ELEMENT_DOMAIN: ld("element"),
  ELEMENT_CALL_DOMAIN: ld("call"),
  N8N_DOMAIN: ld("n8n"),
  MCP_DOMAIN: ld("mcp"),
  DIRIGENT_DOMAIN: ld("dirigent"),
  AISHA_DOMAIN: ld("aisha"),
  // OpenClaw (agent-mesh executor) — subdomain "companion"; OPENCLAW_DOMAIN is the
  // legacy alias of COMPANION_DOMAIN (both resolve to the same host). The local stack
  // runs openclaw via the optimum-ai/full presets (config/profiles/local-dev include).
  OPENCLAW_DOMAIN: ld("companion"),
  COMPANION_DOMAIN: ld("companion"),
};

export const presets = {
  minimum: {
    description: "DB + Edge + Web app (~11 containers, lehké)",
    apps: ["core"],
    extras: [],
  },
  optimum: {
    description: "+ Keycloak + n8n + Ragnarok RAG (~25 containers)",
    apps: ["core", "keycloak", "ai-chat", "orchestration", "integration"],
    extras: [],
  },
  "optimum-llm": {
    description: "Optimum + lokální Ollama (přes auto-select.sh)",
    apps: ["core", "keycloak", "ai-chat", "orchestration", "integration"],
    extras: ["llm"],
  },
  "optimum-ai": {
    description: "Optimum + svc-ai-chat (:3011) + openclaw executor — real-conditions LLM dispatch + agent-mesh testing",
    apps: ["core", "keycloak", "orchestration", "integration", "ai-chat", "openclaw"],
    extras: [],
  },
  "full-light": {
    description: "Plný stack bez infra-only (pki/exec/ledger/registry) — laptop-friendly",
    apps: [
      "core",
      "keycloak",
      "ai-chat",
      "orchestration",
      "messaging",
      "observability",
      "admin",
      "integration",
      "openclaw",
    ],
    extras: [],
  },
  full: {
    description: "Vše kromě netbird — vč. pki/exec/ledger (~50+ containers, 16+ GB RAM, vyžaduje Kata pro exec)",
    apps: [
      "registry",
      "core",
      "keycloak",
      "ai-chat",
      "pki",
      "orchestration",
      "messaging",
      "observability",
      "admin",
      "integration",
      "ledger",
      "exec",
      "openclaw",
    ],
    extras: [],
  },
};

// =============================================================================
// Cross-stack dependencies — pokud user vybere stack X, tyto must-be-included.
// Generator je auto-přidá s warningem.
// =============================================================================

export const stackDependencies = {
  keycloak: ["core"],          // KC potřebuje aisha-db
  "ai-chat": ["core"],         // svc-ai-chat potřebuje PostgREST + Redis + gateway route target
  orchestration: ["core"],     // n8n potřebuje aisha-db (schema n8n)
  messaging: ["core"],         // Synapse potřebuje aisha-db (DB synapse)
  observability: ["core"],     // Langfuse potřebuje aisha-db (schema langfuse)
  admin: ["core"],             // NocoDB potřebuje aisha-db
  integration: ["core"],       // Ragnarok metadata persistence
  pki: [],                     // Vlastní MariaDB, izolovaný
  ledger: [],                  // Vlastní state, no DB
  exec: ["core"],              // svc-agent-runner volá svc-plugin-system + postgrest
  openclaw: ["core"],          // svc-openclaw: schema-isolated on shared aisha-db (openclaw_app role)
  registry: [],                // Standalone Docker Hub cache
  edge: [],                    // Frontend SPA, env placeholders OK
  netbird: [],                 // Mesh management, separate
};

// =============================================================================
// Host port mappings — MINIMAL host exposure (operator design).
// Klíč: container_name (z docker-compose.coolify-*.yml).
// Format: { containerPort: hostPort } — generator přidá hostPort:containerPort
// do svc.ports. containerPort MUSÍ odpovídat skutečnému `expose:` v compose.
//
// EXPOSURE POLICY (data-driven, NOT an allow-list of names): every entry below
// carries an `exposeToHost` flag. ONLY the host front door publishes a host port:
//   - gateway   (the single API front door the host/browser talks to)
//   - web       (the SPA)
//   - keycloak  (host-facing browser OIDC issuer; the token `iss` host)
// Everything else (postgrest, db, redis, minio, all svc-*, n8n, langfuse, …) is
// INTERNAL-ONLY: in-network services reach it over the docker network by
// container_name, and the host reaches it THROUGH the gateway. No host port =
// no collision with other dev stacks on the machine (the :3000 postgrest clash
// with tenant-platform that broke cold-start). db can be opted IN explicitly via
// LOCAL_EXPOSE_DB=1 for direct psql/pgadmin debugging.
//
// `svc(ports, expose)` records the exposure decision into EXPOSE_TO_HOST while
// returning the bare numeric port map, so existing `hostPorts[x]?.[port]` lookups
// and `Object.entries(portMap)` iteration are unchanged.
// =============================================================================

// Roles whose host port IS published. Data-driven via the per-entry flag below
// (this Set is the resolved result, the single source of truth the generator
// reads). Default = NOT exposed; only gateway/web/keycloak opt in (+ db via env).
export const EXPOSE_TO_HOST = new Set();

const EXPOSE_DB = /^(1|true|yes)$/i.test(String(process.env.LOCAL_EXPOSE_DB || ""));
// svc-ai-chat is internal-only (the gateway reaches it in-network). Opt in with
// LOCAL_EXPOSE_AI_CHAT=1 to publish :3011 on the host for real-conditions
// integration tests that POST /functions/v1/ai-* and assert the resolved model.
const EXPOSE_AI_CHAT = /^(1|true|yes)$/i.test(String(process.env.LOCAL_EXPOSE_AI_CHAT || ""));
// PostgREST is internal-only by default (host reaches it via the gateway). Opt in
// with LOCAL_EXPOSE_POSTGREST=1 for a DUAL-STACK dev setup where a broker in a
// SEPARATE compose network (e.g. tenant-platform's svc-source-broker) must reach
// PostgREST across the host boundary via host.docker.internal:<LOCAL_POSTGREST_PORT>
// — it can't use the aisha in-network DNS name. Set LOCAL_POSTGREST_PORT to pick a
// non-colliding host port (the tenant stack owns :3000).
const EXPOSE_POSTGREST = /^(1|true|yes)$/i.test(String(process.env.LOCAL_EXPOSE_POSTGREST || ""));

function svc(name, ports, exposeToHost = false) {
  if (exposeToHost) EXPOSE_TO_HOST.add(name);
  return [name, ports];
}

export const hostPorts = Object.fromEntries([
  // ── core stack (docker-compose.coolify.yml) ────────────────────────────
  svc("aisha-gateway", { 3001: 3001 }, true),   // ← FRONT DOOR — exposed
  // PG17 — internal by default; opt in with LOCAL_EXPOSE_DB=1 for direct psql/pgadmin.
  svc("aisha-db", { 5432: Number(process.env.LOCAL_DB_PORT || 54322) }, EXPOSE_DB),
  // PostgREST — INTERNAL-ONLY. The host reaches it through the gateway; in-network
  // services use http://aisha-postgrest:3000. Container port stays 3000. (The old
  // host :3000 publish collided with other dev stacks e.g. tenant-platform.)
  svc("aisha-postgrest", { 3000: Number(process.env.LOCAL_POSTGREST_PORT || 3000) }, EXPOSE_POSTGREST),
  svc("aisha-imgproxy", { 8080: 8088 }),
  svc("aisha-minio", { 9000: 9000, 9001: 9001 }),
  svc("aisha-redis", { 6379: 6379 }),
  svc("aisha-web", { 80: 8083 }, true),          // ← SPA — exposed
  svc("aisha-pgadmin", { 80: 8082 }),

  // ── keycloak (KC_HTTP_PORT=80 v compose) ──────────────────────────────
  svc("aisha-keycloak", { 80: 8180, 9000: 9090 }, true), // ← host-facing OIDC issuer — exposed

  // ── orchestration (n8n) ────────────────────────────────────────────────
  svc("frontend--n8n--main", { 5678: 5678 }),
  svc("ragnarok", { 9696: 9696 }),
  svc("maestro", { 8020: 8020 }),
  svc("langfuse", { 3100: 3100 }),
  svc("elasticsearch", { 9200: 9200 }),
  svc("noco", { 8085: 8085 }),
  svc("appsmith", { 8090: 8090 }),
  svc("pgadmin", { 5050: 5050 }),
  svc("keycloak", { 8180: 8180 }),
  svc("frontend--n8n--auth", { 4180: 5681 }),

  // ── integration (Ragnarok RAG + Elasticsearch + RabbitMQ) ──────────────
  svc("backend--integration--elasticsearch", { 9200: 9200 }),
  svc("backend--integration--rabbitmq", { 5672: 5672, 15672: 15672 }),

  // ── ai-chat (svc-ai-chat) — internal-only; opt-in host expose for real tests ──
  svc("aisha-svc-ai-chat", { 3011: Number(process.env.LOCAL_AI_CHAT_PORT || 3011) }, EXPOSE_AI_CHAT),

  // ── messaging (Matrix Synapse + Element) ───────────────────────────────
  svc("aisha-synapse", { 8008: 8008 }),
  svc("aisha-element-web", { 80: 8081 }),

  // ── observability (Langfuse) ───────────────────────────────────────────
  svc("aisha-langfuse-gateway", { 8080: 3030 }),
  svc("aisha-clickhouse", { 8123: 8123 }),

  // ── admin (NocoDB + Appsmith) ──────────────────────────────────────────
  svc("aisha-nocodb", { 8080: 8090 }),
  svc("aisha-nocodb-auth", { 4180: 8094 }),
  svc("aisha-appsmith-gateway", { 80: 8091 }),
  svc("aisha-appsmith-auth", { 4180: 8095 }),

  // ── registry pull-through cache ────────────────────────────────────────
  svc("aisha-registry-cache", { 5000: 5001 }),

  // ── PKI WebUI (přes pki-auth OAuth2 Proxy) ────────────────────────────
  svc("aisha-pki-auth", { 4180: 4180 }),
]);

/**
 * Is this service role published to the host? Data-driven from the per-entry
 * `exposeToHost` flag above (NOT a hardcoded name list). The generator calls this
 * to decide whether to add a host `ports:` publish at all.
 * @param {string} name container_name / role key
 */
export function isExposedToHost(name) {
  return EXPOSE_TO_HOST.has(name);
}

// =============================================================================
// Free-port allocation — for the FEW exposed ports only.
// Pure TCP probe of 127.0.0.1:<port> (no listen/bind side-effect). If the desired
// host port is taken (another dev stack owns it), pick the next free port. The
// LOCAL_*_PORT env overrides stay AUTHORITATIVE (operator pinned it on purpose —
// never silently move a pinned port).
// =============================================================================

/**
 * Probe whether a TCP port on 127.0.0.1 is currently accepting connections.
 * Returns a Promise<boolean> — true == something is LISTENING (port taken).
 * Pure: opens a client socket and immediately destroys it; never binds/listens.
 * @param {number} port
 * @param {number} [timeoutMs=250]
 */
export function isPortInUse(port, timeoutMs = 250) {
  return new Promise((resolveP) => {
    let settled = false;
    const done = (inUse) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* idempotent */ }
      resolveP(inUse);
    };
    const sock = createConnection({ host: "127.0.0.1", port: Number(port) });
    // connect succeeded → something is listening → port is in use.
    sock.once("connect", () => done(true));
    // ECONNREFUSED (nobody listening) → free. Any other error → treat as free
    // too (we only care about "can a client connect right now").
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

/**
 * Return `desired` if free, else the next free port scanning upward. Skips any
 * port in `taken` (ports already allocated to other services in THIS run, so two
 * exposed services don't both land on the same fallback).
 * @param {number} desired
 * @param {Set<number>} [taken]
 * @param {number} [maxScan=200]
 * @returns {Promise<number>}
 */
export async function allocateFreePort(desired, taken = new Set(), maxScan = 200) {
  let port = Number(desired);
  for (let i = 0; i < maxScan; i++, port++) {
    if (taken.has(port)) continue;
    // Sequential probe by design (one open port at a time) — the few exposed
    // ports make this trivially cheap and avoids a burst of parallel sockets.
    if (!(await isPortInUse(port))) {
      taken.add(port);
      return port;
    }
  }
  throw new Error(`allocateFreePort: no free port found in [${desired}, ${desired + maxScan})`);
}

/**
 * Resolve the actually-allocated host ports for the EXPOSED services. For each
 * exposed entry, every containerPort→desiredHostPort is checked for freeness; if
 * taken, the next free port is used. Env-pinned ports (LOCAL_*_PORT, surfaced as
 * `pinnedHostPorts`) are kept authoritative (never moved). Returns a map
 *   { containerName: { containerPort: allocatedHostPort } }
 * for exactly the exposed services, plus is side-effect-free on `hostPorts`.
 * @param {object} [opts]
 * @param {Set<number>} [opts.pinnedHostPorts] host ports the operator pinned (never moved)
 * @returns {Promise<Record<string, Record<number, number>>>}
 */
export async function resolveExposedHostPorts({ pinnedHostPorts = new Set() } = {}) {
  const taken = new Set();
  const out = {};
  for (const name of EXPOSE_TO_HOST) {
    const portMap = hostPorts[name];
    if (!portMap) continue;
    const resolvedMap = {};
    for (const [containerPort, hostPort] of Object.entries(portMap)) {
      const desired = Number(hostPort);
      let allocated;
      if (pinnedHostPorts.has(desired)) {
        // Operator pinned it explicitly — authoritative, do not probe/move.
        allocated = desired;
        taken.add(desired);
      } else {
        allocated = await allocateFreePort(desired, taken);
      }
      resolvedMap[containerPort] = allocated;
    }
    out[name] = resolvedMap;
  }
  return out;
}

// =============================================================================
// Host-facing Keycloak origin (named vars — NO literals buried in code).
// The browser / iOS-Simulator reaches KC here, and it's the host KC stamps into
// the token `iss`. 127.0.0.1 loopback is ATS-safe (mobile Info.plist
// NSAllowsLocalNetworking=true). The PORT comes from hostPorts['aisha-keycloak'].
// Consumed by scripts/lib/kc-host-auth.mjs → kc-endpoint-resolver.
// =============================================================================
export const KC_HOST_FACING_HOST = "127.0.0.1";
export const KC_HOST_FACING_SCHEME = "http";

// =============================================================================
// Domain → host:port mapping pro lokální OAuth2/OIDC redirect URLs.
// Když generator narazí na `https://${X_DOMAIN:-default}/...` v env value,
// přepíše na `http://localhost:<hostPort>/...` (ze záznamu níže).
// =============================================================================

export const domainToHostPort = {
  KEYCLOAK_DOMAIN: { port: 8180, scheme: "http" },
  N8N_DOMAIN: { port: 5678, scheme: "http" },
  PKI_DOMAIN: { port: 4180, scheme: "http" },
  NOCODB_DOMAIN: { port: 8090, scheme: "http" },
  APPSMITH_DOMAIN: { port: 8091, scheme: "http" },
  LANGFUSE_DOMAIN: { port: 3030, scheme: "http" },
  STUDIO_DOMAIN: { port: 8082, scheme: "http" },
  APP_DOMAIN: { port: 8083, scheme: "http" },
  API_DOMAIN: { port: 3001, scheme: "http" },
  REGISTRY_DOMAIN: { port: 5001, scheme: "http" },
  DOZZLE_DOMAIN: { port: 8888, scheme: "http" },
  TURN_DOMAIN: { port: 3478, scheme: "http" },
  LIVEKIT_DOMAIN: { port: 7880, scheme: "http" },
  // NETBIRD_DOMAIN: nelze dobře lokálně, mesh routing je out-of-scope
};

// =============================================================================
// Dev defaults pro `${X:?}` placeholders v Coolify compose souborech.
// Generator vyrobí `.env.local.dev` z těchto hodnot — bezpečné pro dev,
// NIKDY nesmí prosáknout do produkce.
// =============================================================================

// Pomocná konstanta pro 32+ char dev secrets (compose validuje minimální délku)
const D32 = "dev_secret_32chars__padding_padding_pad";
const D64 = "dev_secret_64chars__padding_padding_padding_padding_padding_padding_pad";
// oauth2-proxy cookie secrets must be EXACTLY 16/24/32 bytes (AES key) — D32 above is
// 39 bytes (misnamed), which makes the proxies crash-loop ("cookie_secret must be 16,
// 24, or 32 bytes ... but is 39"). D32C is exactly 32. Used for every *_COOKIE_SECRET.
const D32C = D32.slice(0, 32);

// A REAL service-role JWT (HS256, signed with the dev JWT secret D32). verifyServiceRole in
// the svc-* services HS256-verifies the POSTGREST_SERVICE_TOKEN, so the LOCAL token must be a
// genuine JWT — a placeholder string ("dev-service-role-key") fails jwtVerify (PGRST301 /
// "Service-role required"). No exp ⇒ a stable, never-expiring DEV token; D32 is itself a dev
// default that never leaks to prod (where generate-secrets.mjs emits the real secret + token).
function mintDevServiceJwt(secret) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ role: "service_role", token_use: "dev-local-service" });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}

export const devEnvDefaults = {
  // ── Jména na síti ──
  // Prefix aliasů sdílené infrastruktury (aisha-db, aisha-postgrest, …). Compose
  // ho čte jako ${SERVICE_ALIAS_PREFIX:?…}, takže bez hodnoty se lokální render
  // NEROZBĚHNE — a to je záměr: chybějící jméno má být vidět hned, ne až za běhu.
  // Bere se z DERIVACE, ne jako další natvrdo psaný literál; jeden domov hodnoty
  // je config/services.json a instance ho přebíjí AISHA_SERVICE_ALIAS_PREFIX.
  SERVICE_ALIAS_PREFIX: localTopoEnv.SERVICE_ALIAS_PREFIX,

  // Hostitel sdíleného Redisu. Compose ho čte jako `${SHARED_REDIS_HOST:?…}`,
  // takže bez hodnoty neprojde ani `docker compose config` — lokální render
  // spadl přesně tady, protože prod dráhu (derivace → doctor → sync-envs) má
  // vývojářský stroj nahrazenou tímhle souborem.
  //
  // Ze stejné derivace jako prefix výš, ne opsané: kdyby se tu skládalo jméno
  // ručně, rozešlo by se s aliasem, který si shared-redis compose dává sám.
  SHARED_REDIS_HOST: localTopoEnv.SHARED_REDIS_HOST,

  // Identita ZÁKAZNÍKA (na rozdíl od prefixu výš, který pojmenovává implementaci
  // stacku). Na SDÍLENÉ síti `coolify` jede provoz všech instancí na hostiteli,
  // takže tam alias musí nést tohle jméno — jinak dva zákazníci vystaví týž
  // `<stack>-keycloak` a DNS odpovídá střídavě cizím kontejnerem.
  // Lokální render potřebuje hodnotu ze stejného důvodu jako u prefixu výš:
  // compose ho čte jako `${APP_NAME_PREFIX:?…}`. `local` je jméno TÉHLE
  // vývojářské instance, ne dosazená cizí identita.
  APP_NAME_PREFIX: INSTANCE_PREFIX,
  // Compose je čte jako `${…:?…}`, protože prázdný allowlist neznamená „povol
  // vše", ale „adaptér narazí na blok" — a to má být vidět při renderu, ne až
  // za běhu. V produkci je skládá cold-start (zná prefix instance); tady platí
  // TÁŽ derivace z INSTANCE_PREFIX, ne opsaný literál. Dřív stálo skládání
  // přímo ve compose jako `${SSRF_HOST_ALLOWLIST:-…${APP_NAME_PREFIX}…}`, což
  // Coolify nerozparsuje (vnořená interpolace) a před tím tam byla natvrdo
  // adresa CIZÍ instance.

  // Jméno mesh-DNS sítě — compose ho čte jako `${MESH_DNS_NETWORK:?…}` a JEDEN
  // domov derivace je `<identita>-mesh-dns` (generate-secrets:574 z deployPrefix;
  // cold-start i create-netseg tutéž proměnnou vyžadují). Lokál odvozuje z téže
  // identity, ne literálem — jinak by vznikl čtvrtý domov.
  MESH_DNS_NETWORK: `${INSTANCE_PREFIX}-mesh-dns`,

  // Subnet té sítě. Povinný od 2026-08-10, kdy si mesh-DNS síť začal zakládat
  // COMPOSE (dřív byla `external: true` a subnet určoval ten, kdo ji náhodou
  // vytvořil — na varra ji nevytvořil NIKDO a deploy padal). Compose ho teď čte
  // jako `${MESH_DNS_SUBNET:?…}`, takže bez dev defaultu neprojde ani lokální
  // generátor.
  //
  // Lokál dostává JINÝ rozsah než produkce (10.99.0.0/24 z deriveSubnets):
  // vývojářská instance a produkční mohou běžet na jednom stroji a překryv
  // subnetů by je srazil do jedné sítě. Hodnota se dá přebít z prostředí.
  MESH_DNS_SUBNET: process.env.MESH_DNS_SUBNET || "10.98.0.0/24",

  // Instanční jména služeb na sdílené síti — TÁŽ identita, ne holý alias.
  //
  // PROČ (změřeno 2026-08-10 na produkci): Coolify připojí každý kontejner na
  // sdílenou síť `coolify` a compose k němu přidá alias rovný jménu služby.
  // Dva nájemníci se stejně pojmenovanou službou si tak nárokují TÝŽ alias a
  // Docker DNS mezi nimi střídá — `pki-db` odpovídaly DVĚ databáze, půlka
  // spojení šla k cizímu nájemníkovi. U `clamd` je to nejhorší: protokol nemá
  // žádnou autentizaci, takže `INSTREAM` pošle OBSAH souboru tomu, kdo odpoví.
  //
  // Lokál odvozuje z TÉŽE identity jako produkce, ne literálem — jinak by
  // vznikl další domov jména.
  CLAMD_HOST: `${INSTANCE_PREFIX}-clamav`,
  AI_CHAT_SERVICE_URL: `http://${INSTANCE_PREFIX}-svc-ai-chat:3011`,
  AITG_PROBES_SERVICE_URL: `http://${INSTANCE_PREFIX}-svc-aitg-probes:3041`,

  // ── Vnitřní adresy, které compose čte jako `${VAR:?…}` ──
  // Od 2026-08-05 nemají fallback: dřív se dosazovalo `http://aisha-<služba>`,
  // tedy jméno IMPLEMENTACE stacku, které na sdílené síti nepatří jedné
  // instanci. Lokální render je proto potřebuje mít dodané — jinak `docker
  // compose config` skončí na „required variable X is missing a value".
  //
  // Berou se Z DERIVACE, stejně jako SERVICE_ALIAS_PREFIX výš: jeden domov
  // hodnoty (config/services.json + profil local-dev), ne sedm dalších
  // natvrdo psaných literálů, které by se s produkcí mohly rozejít.
  // KEYCLOAK_INTERNAL_URL a POSTGREST_URL tu NEJSOU schválně — obě už níž
  // v tomhle objektu jsou, uvedené jmenovitě právě s odkazem na to, že se
  // z compose fallbacku stane `:?`. Druhý zápis by ten první tiše přebil
  // (hlídá duplicate-object-keys).
  AISHA_GATEWAY_URL: localTopoEnv.AISHA_GATEWAY_URL,
  MINIO_URL: localTopoEnv.MINIO_URL,
  MINIO_ENDPOINT: localTopoEnv.MINIO_ENDPOINT,
  IMGPROXY_URL: localTopoEnv.IMGPROXY_URL,
  // Storage přes API (storage-auth routes/nahrani.ts): kam klient posílá obsah
  // souboru — lokálně gateway na hostiteli, jako VITE_API_URL níž. Bez nich
  // generátor domain-services padal (naměřeno local-warmupem 2026-09-19).
  STORAGE_PUBLIC_URL: "http://localhost:3001/storage/v1",
  STORAGE_UPLOAD_TOKEN_SECRET: D32,
  // Gateway → storage-auth (fotka z předání, `/functions/v1/upload-entity-evidence-preflight`).
  // Z katalogu (domain-services.internal_endpoints), ne opsaná adresa — viz internalEndpointUrlFor.
  STORAGE_AUTH_URL: internalEndpointUrlFor("domain-services", "STORAGE_AUTH_URL", INSTANCE_PREFIX),
  // Rezidence dat AI z profilu local-dev (`ai.execution_mode`) — TÁŽ derivace
  // jako produkce, žádná druhá dev hodnota. Chybí-li (derivace selhala),
  // ai-chat compose `${AISHA_EXECUTION_MODE:?}` start odmítne nahlas.
  AISHA_EXECUTION_MODE: localTopoEnv.AISHA_EXECUTION_MODE ?? "",
  SVC_MCP_KNOWLEDGE_URL: localTopoEnv.SVC_MCP_KNOWLEDGE_URL,

  // ── Postgres core ──
  POSTGRES_PASSWORD: "dev_postgres_password",
  POSTGRES_DB: "postgres",
  POSTGRES_USER: "postgres",
  JWT_SECRET: D32,
  JWT_EXP: "3600",
  ANON_KEY: "dev-anon-key",
  SERVICE_ROLE_KEY: mintDevServiceJwt(D32),
  VAULT_ENCRYPTION_KEY: D64,
  AISHA_DB_URL: "postgresql://aisha_admin:dev_postgres_password@aisha-db:5432/postgres",
  AISHA_SERVICE_KEY: mintDevServiceJwt(D32),

  // ── App-specific DB passwords ──
  NOCODB_DB_PASSWORD: "dev_nocodb_password",
  LANGFUSE_DB_PASSWORD: "dev_langfuse_password",
  SYNAPSE_DB_PASSWORD: "dev_synapse_password",
  KEYCLOAK_DB_PASSWORD: "dev_keycloak_password",
  N8N_DB_PASSWORD: "dev_n8n_password",
  NETBIRD_DB_PASSWORD: "dev_netbird_password",
  // Heslo role postgres_exporter — core `db` ho vyžaduje `:?` (wrapper ho nastaví při startu).
  POSTGRES_EXPORTER_PASSWORD: "dev_postgres_exporter_password",
  PKI_DB_PASSWORD: "dev_pki_password",
  // Required (:?) by pki-init since cae2a4d6 (#741 — operator password digest);
  // the dev default was missed there, leaving main red on the full local render.
  OPENXPKI_OPERATOR_PASSWORD: "dev_openxpki_operator_password",
  // PKI bootstrap identita: hodnoty jsou KONSTANTY realm exportu
  // (keycloak/aisha-realm.json definuje klienta `aisha-pki-bootstrap`) — realm
  // se importuje stejný lokálně i v produkci, takže tohle NENÍ dosazená cizí
  // identita, ale jméno, které v realmu skutečně existuje. Domov hodnoty je
  // ten export; tady je jen lokální doručení pro `${VAR:?…}` render.
  PKI_BOOTSTRAP_USERNAME: "aisha-pki-bootstrap",
  PKI_BOOTSTRAP_CLIENT_ID: "aisha-pki-bootstrap",
  // Insight → lokální LLM gateway: alias `aisha-llm-gateway` je jméno služby
  // v lokálním composu (SERVICE_ALIAS_PREFIX=aisha z config/services.json).
  INSIGHT_OPENAI_ENDPOINT: `http://${INSTANCE_PREFIX}-llm-gateway:4000/v1`,

  // Realm konstanty (domov: keycloak/aisha-realm.json) + servisní jména —
  // lokální doručení pro `${VAR:?…}`; hodnoty jsou tytéž, které realm import
  // skutečně založí.
  OIDC_APP_CLIENT_ID: "aisha-app",
  // Komu brána věří při výměně KC tokenu za PostgREST JWT. V nasazení to skládá
  // `aisha-env-doctor` z deklarovaných OIDC klientů; lokální preset si deklaruje
  // vlastní, protože brána chybějící hodnotu ZÁMĚRNĚ neodpustí (`requireEnv`).
  KC_ALLOWED_CLIENTS: "aisha-app,aisha-dirigent-device",
  WS_JWT_AUDIENCE: "aisha-app",
  KC_ADMIN_CLIENT_ID: "aisha-user-admin",
  N8N_BOOTSTRAP_OWNER_EMAIL: `n8n-owner@${LOCAL_TLD}`,
  AISHA_DB_IMAGE: "aisha-db-pg18:local",
  POSTGRES_MAJOR: "18",
  // Exec stack: lokální hostitelské cesty, derivované z identity dev instance.
  AGENT_REPO_PATH: `/srv/${INSTANCE_PREFIX}/base-repo`,
  AGENT_RUNS_DIR: `/var/lib/${INSTANCE_PREFIX}/agent-runs`,
  PKI_DB_ROOT_PASSWORD: "dev_pki_root_password",
  // Required (:?) by pki-init since the operator-owns-their-CA work (fork
  // eb5494f4): empty would render `O=` into every certificate profile. In prod
  // generate-secrets emits it from operator identity; locally any non-empty
  // org keeps the render honest.
  AISHA_OPERATOR_ORG: "Dev Local Operator",

  // ── MinIO (S3) ──
  MINIO_ROOT_USER: "minio_admin",
  MINIO_ROOT_PASSWORD: "dev_minio_password",
  // Doprava ingest balíků přes bucket `ingest-drop`: v dev běhu MinIO nestojí,
  // takže hodnoty jsou zástupné. Sidecar se bez nich rovnou ohlásí (stráž
  // v entrypointu), místo aby tiše zrcadlil nikam.
  INGEST_DROP_ACCESS_KEY: "ingest-drop-dev",
  INGEST_DROP_SECRET_KEY: "dev_ingest_drop_secret",
  // S3_* are generate-secrets ALIASES of the MinIO root creds (:?-required in
  // core compose since 2026-06-10) — mirror the alias locally.
  S3_ACCESS_KEY: "minio_admin",
  S3_SECRET_KEY: "dev_minio_password",
  MINIO_ROOT_USER_OLD: "minio_admin",
  MINIO_ROOT_PASSWORD_OLD: "dev_minio_password",

  // ── Redis ──
  REDIS_PASSWORD: "dev_redis_password",
  REDIS_PASSWORD_ADMIN: "dev_redis_admin_password",
  REDIS_PASSWORD_CORE: "dev_redis_core_password",
  REDIS_PASSWORD_LANGFUSE: "dev_redis_langfuse_password",

  // ── Keycloak ──
  KC_BOOTSTRAP_ADMIN_USERNAME: "admin",
  KC_BOOTSTRAP_ADMIN_PASSWORD: "dev_keycloak_admin",
  KEYCLOAK_ADMIN: "admin",
  KEYCLOAK_ADMIN_PASSWORD: "dev_keycloak_admin",
  KEYCLOAK_REALM: LOCAL_KC_REALM,
  // The reachable platform admin rendered into the realm. ${...:?} required —
  // cold-start generates it, so local dev needs its own value or `--preset full`
  // fails to interpolate keycloak's environment.
  PLATFORM_ADMIN_PASSWORD: "dev_platform_admin",
  // (KEYCLOAK_URL lives in the "Common local service URLs" section below —
  // host-facing.)
  //
  // Container-facing Keycloak, i.e. the JWKS hop pki-bridge uses to validate the
  // token that mints the MESH certificate. It must therefore resolve while the mesh
  // does not exist yet, which is why it is NOT ${KEYCLOAK_DOMAIN} — the generic loop
  // mesh-ifies that name. Deployments get it from derive-domains: the shared-network
  // alias when Keycloak and PKI share a node, the direct host when they do not.
  // Local dev is single-node and the container really is named aisha-keycloak
  // (docker-compose.yml:15), so the alias is the correct value here. Stated rather
  // than left to compose's `:-` fallback, which is scheduled to become `:?`.
  KEYCLOAK_INTERNAL_URL: `http://${INSTANCE_PREFIX}-keycloak:80`,
  KC_CLIENT_SECRET: D32,

  // ── LiveKit (real-time media) ──
  LIVEKIT_API_KEY: "devkey_livekit_api",
  LIVEKIT_API_SECRET: D32,
  LIVEKIT_TURN_USER: "livekit_turn",
  LIVEKIT_TURN_PASSWORD: "dev_livekit_turn_password",
  LIVEKIT_LOG_LEVEL: "info",
  LIVEKIT_WEBHOOK_URL: `http://${INSTANCE_PREFIX}-gateway:3001/livekit/webhook`,

  // ── n8n ──
  N8N_ENCRYPTION_KEY: D32,
  N8N_WEBHOOK_AUTH_TOKEN: D32,
  N8N_BOOTSTRAP_OWNER_PASSWORD: D32,

  // ── RabbitMQ ──
  RABBITMQ_DEFAULT_USER: "rabbitmq",
  RABBITMQ_DEFAULT_PASS: "dev_rabbitmq_password",
  RABBITMQ_USER: "rabbitmq",
  RABBITMQ_PASS: "dev_rabbitmq_password",
  RABBITMQ_HOST: "backend--integration--rabbitmq",
  RABBITMQ_PORT: "5672",

  // ── PKI ──
  PKI_SVAULT_KEY: D32,
  PKI_OIDC_SECRET: D32,
  PKI_COOKIE_SECRET: D32C,
  // Pre-generated by cold-start (generate-secrets pg) and consumed by
  // aisha-bootstrap-user-init.sh as the aisha-pki-issuer client_credentials
  // secret; ${...:?} required, so local dev supplies its own.
  AISHA_PKI_ISSUER_CLIENT_SECRET: D32,
  // Servisní účet aisha-user-admin: gateway i Keycloak čtou TUTÉŽ hodnotu,
  // v compose je ${...:?} (generuje ji cold-start), takže lokální render
  // bez dev defaultu tvrdě padne.
  KC_ADMIN_CLIENT_SECRET: D32,
  // Bootstrap dvojice — realm si je při importu PŘEVEZME (2026-09-05).
  // Dřív je vydával Keycloak a init skript si je chodil vyzvednout, což na
  // instanci za NAT znamenalo SSH do hostitele. Compose je předává v HOLÉM
  // tvaru `${VAR}` (viz komentář tamtéž: `:?` by je vtáhl do buildu, `:-` by
  // umlčel varování dockeru), takže lokální mirror pro ně potřebuje default
  // TADY — stejně jako pro KC_ADMIN_CLIENT_SECRET o řádek výš.
  AISHA_BOOTSTRAP_CLIENT_SECRET: D32,
  AISHA_PKI_BOOTSTRAP_CLIENT_SECRET: D32,
  // Hesla TÝCHŽ servisních účtů. Šablona je nedeklaruje hodnotou, jen
  // ukazatelem (`aisha.passwordFrom`), a `realm-sync` je nastavuje přes
  // kcadm — ale compose je předává, takže lokální render je potřebuje mít.
  AISHA_BOOTSTRAP_PASSWORD: D32,
  AISHA_PKI_BOOTSTRAP_PASSWORD: D32,

  // ── OpenClaw (agent-mesh executor) — dev secrets for the optional executor the
  // optimum-ai/full-light/full presets now run. The :?-required compose vars
  // (OPENCLAW_DB_PASSWORD / OPENCLAW_OIDC_SECRET) + bare refs (OPENCLAW_API_KEY /
  // OPENCLAW_SECRET) must be non-empty or `docker compose config` hard-fails. Same
  // OPENCLAW_API_KEY both sides (svc-ai-chat adapter ↔ svc-openclaw) — consistent locally. ──
  OPENCLAW_DB_PASSWORD: D32,
  OPENCLAW_OIDC_SECRET: D32,
  OPENCLAW_COOKIE_SECRET: D32C,
  OPENCLAW_API_KEY: D32,
  OPENCLAW_SECRET: D32,

  // ── Langfuse ──
  LANGFUSE_NEXTAUTH_SECRET: D32,
  LANGFUSE_SALT: "dev_langfuse_salt",
  LANGFUSE_ENCRYPTION_KEY: D64,
  LANGFUSE_PUBLIC_KEY: "pk-lf-dev-public-key-0000000000000000",
  LANGFUSE_SECRET_KEY: "sk-lf-dev-secret-key-0000000000000000",
  LANGFUSE_OIDC_SECRET: D32,
  LANGFUSE_ADMIN_EMAIL: "admin@aisha.guru",
  LANGFUSE_ADMIN_PASSWORD: "dev_langfuse_admin",
  LANGFUSE_HOST: `http://${INSTANCE_PREFIX}-langfuse-gateway:8080`,

  // ── ClickHouse ──
  CLICKHOUSE_USER: "clickhouse",
  CLICKHOUSE_PASSWORD: "dev_clickhouse_password",

  // ── Elasticsearch ──
  ELASTIC_PASSWORD: "dev_elastic_password",

  // ── imgproxy ──
  IMGPROXY_KEY: "0".repeat(64),
  IMGPROXY_SALT: "0".repeat(64),

  // ── Synapse (Matrix) ──
  SYNAPSE_FORM_SECRET: D32,
  SYNAPSE_MACAROON_SECRET: D32,
  SYNAPSE_REGISTRATION_SECRET: D32,
  SYNAPSE_OIDC_CLIENT_SECRET: D32,
  SYNAPSE_SERVER_NAME: "localhost",
  AISHA_AS_TOKEN: D32,
  AISHA_HS_TOKEN: D32,

  // ── Studio (AISHA admin / database UI) ──
  STUDIO_COOKIE_SECRET: D32C,
  STUDIO_OIDC_SECRET: D32,

  // ── NocoDB ──
  NOCODB_JWT_SECRET: D32,
  NOCODB_OIDC_SECRET: D32,

  // ── Extranet (oauth2-proxy před povrchem zákazníka) ──
  // Doplněno 2026-08-30: realm si secrety důvěrných klientů dosazuje sám při
  // startu Keycloaku, takže je compose předává i lokálně. Ostatních osm tu už
  // bylo — chyběl jen tenhle a generátor na něm padal.
  EXTRANET_OIDC_SECRET: D32,

  // ── Appsmith ──
  APPSMITH_ENCRYPTION_PASSWORD: "dev_appsmith_encryption_password",
  APPSMITH_ENCRYPTION_SALT: "dev_appsmith_encryption_salt",
  APPSMITH_OIDC_SECRET: D32,

  // ── Netbird (lokálně mesh nepoužíváme, ale defaults pro compose validation) ──
  NETBIRD_OIDC_CLIENT_ID: "netbird",
  NETBIRD_OIDC_SECRET: D32,
  NETBIRD_MGMT_SECRET: D32,
  NETBIRD_RELAY_SECRET: D32,
  NETBIRD_TURN_USERNAME: "netbird_turn",
  NETBIRD_TURN_PASSWORD: "dev_netbird_turn_password",
  NETBIRD_API_TOKEN: "dev_netbird_api_token",
  NETBIRD_API_URL: `http://${INSTANCE_PREFIX}-netbird-management:443`,
  NETBIRD_AUTH_SCHEME: "Bearer",
  NETBIRD_DNS_IP: "127.0.0.1",
  // Lokální zrcadlo mesh nemá; routa se v edge-proxy staví jen při MESH_ENABLED=true,
  // ale compose hodnotu vyžaduje (:?) — držíme stejný tvar jako produkce.
  NETBIRD_PEER_CIDR,
  // Totéž pro n8n (docker-compose.coolify-n8n.yml, 2026-09-14): mesh vypnutá, takže
  // entrypoint routu nestaví a API volá `https://${API_DOMAIN}`. Lane se lokálně
  // nepoužije, compose ji ale vyžaduje (:?) — tvar jako derivace (http + port).
  MESH_ENABLED: "false",
  API_UPSTREAM_MESH: `http://${ld("api")}:3001`,
  // Seznam našich prvků pro chůzi `x-forwarded-for`. Lokálně mesh není, ale
  // tvar držíme shodný s produkcí — a hlavně se hodnota ODVOZUJE, takže se
  // dev a produkce nemůžou rozejít. (Právě rozchod dvou kódových výchozích
  // hodnot stál 2026-08-31 celý den u `SPA_REDIS_DB`.)
  // Lokální zrcadlo mesh NEMÁ, takže výčet peerů je prázdný — a je to správně:
  // poslední skok před bránou je tu docker adresa, kterou pokrývají RFC1918
  // rozsahy. Prázdno se NEDOPLŇUJE rozsahem; dosadit sem 100.64.0.0/10 by
  // znamenalo důvěřovat operátorskému CGNATu (viz derive-subnets).
  GATEWAY_TRUSTED_PROXIES: gatewayTrustedProxies(""),
  NETBIRD_ENABLED: "false",
  NETBIRD_SANDBOX_GROUP: "aisha-sandbox",
  // (NETBIRD_MGMT_HOST is defined once in the "NetBird mesh hosts" section
  // below — "host-gateway", matching the compose extra_hosts default.)
  NETBIRD_STACK_KEY_FRONTEND: "",
  NETBIRD_STACK_KEY_INTEGRATION: "",
  NETBIRD_STACK_KEY_EXPERIMENTAL: "",
  // Záměrně prázdné i pro BACKEND: v lokálním zrcadle není mesh management,
  // agent s prázdným klíčem stojí v PENDING_BOOTSTRAP a je zdravý by design
  // (viz healthcheck agenta). Klíč přibyl s konverzí backend stacků na mesh
  // (mesh-conformance-apply, 2026-08-21).
  NETBIRD_STACK_KEY_BACKEND: "",

  // ── Cosmos / ledger ──
  COSMOS_SIGNER_MNEMONIC: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
  CHAIN_ID: "aisha-localnet-1",
  MONIKER: "aisha-local-validator",

  // ── PgAdmin ──
  PGADMIN_EMAIL: "admin@aisha.guru",
  PGADMIN_PASSWORD: "dev_pgadmin_password",

  // ── PostgREST ──
  PGRST_DB_POOL: "10",
  PGRST_DB_MAX_ROWS: "1000",
  POSTGREST_URL: `http://${INSTANCE_PREFIX}-postgrest:3000`,
  // ⛔ TÝŽ CÍL, DRUHÉ JMÉNO. `AISHA_POSTGREST_URL` je jméno, kterým na PostgREST
  // míří NASAZOVACÍ cesta (compose ho čte jako `${...:?}`), kdežto `POSTGREST_URL`
  // je jméno, kterým ho volají SLUŽBY. Lokální preset znal jen to druhé.
  //
  // NAMĚŘENO 2026-09-04 při přidání `plugin-publish-init`: `docker compose config`
  // padal na interpolaci a s ním DVĚ brány o generátoru compose
  // (`local-warmup-idempotence`, `local-container-namespacing`) — jenže chyba
  // ukazovala na IDEMPOTENCI, ne na chybějící hodnotu. Rozhodlo až spuštění
  // generátoru NAPŘÍMO, mimo bránu; ten řekl i místo opravy:
  //   „Pravděpodobně chybí dev default v config/local-presets.mjs:devEnvDefaults"
  //
  // ⭐ ODVOZENO, NE LITERÁL — týmž tvarem jako `POSTGREST_URL` o řádek výš.
  // Ručně psaná adresa by byla druhý domov téže hodnoty a dvě jména jednoho
  // cíle se rozejdou přesně ve chvíli, kdy se jedno z nich změní.
  AISHA_POSTGREST_URL: `http://${INSTANCE_PREFIX}-postgrest:3000`,
  POSTGREST_SERVICE_TOKEN: mintDevServiceJwt(D32),

  // ── Plugin system ──
  PLUGIN_SYSTEM_URL: `http://${INSTANCE_PREFIX}-svc-plugin-system:3029`,
  PLUGIN_BROKER_URL: `http://${INSTANCE_PREFIX}-svc-plugin-system:3029`,
  BROKER_TOKEN_SECRET: D32,
  INTERNAL_API_KEY: D32,
  MCP_TOKEN: D32,

  // ── Ragnarok / RAG ──
  RAGNAROK_URL: "http://backend--integration--ragnarok:9696",
  RAGNAROK_API_KEY: "dev_ragnarok_api_key",

  // ── Registry pull-through (anonymous OK lokálně) ──
  REGISTRY_PROXY_USERNAME: "",
  REGISTRY_PROXY_PASSWORD: "",
  NPM_REGISTRY_URL: "https://registry.npmjs.org",

  // ── External LLM keys: sourced (shell env → .env.coolify → .env-prod-backup) so a real
  //    embedding/eval/dispatch run works locally without hand-editing .env.local.dev; empty
  //    if none present. This is what makes the container's serviceable pool REAL. ──
  OPENAI_API_KEY: resolveLlmProviderKey("OPENAI_API_KEY"),
  ANTHROPIC_API_KEY: resolveLlmProviderKey("ANTHROPIC_API_KEY"),
  GOOGLE_AI_API_KEY: resolveLlmProviderKey("GOOGLE_AI_API_KEY"),
  // Deterministic LLM mock toggle for local-dev/e2e — empty = real provider, "1" = mock.
  AISHA_LLM_MOCK: "",
  RESEND_API_KEY: "",

  // ── Sentry (opt-in) ──
  SENTRY_AUTH_TOKEN: "",
  SENTRY_ORG: "",
  SENTRY_PROJECT: "",
  SENTRY_URL: "",

  // ── Telegram bridge (Matrix) ──
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_API_ID: "",
  TELEGRAM_API_HASH: "",

  // ── Webhook URLs / public site ──
  PUBLIC_SITE_URL: "http://localhost:8083",
  MATRIX_WEBHOOK_URL: `http://${INSTANCE_PREFIX}-gateway:3001/matrix/webhook`,
  COOLIFY_BASE_URL: "http://localhost",
  COOLIFY_API_KEY: "",
  // GitHub (dev-patch, n8n self-tooling): local stack has no target repo by
  // default — empty GITHUB_REPOSITORY = the features report "not configured".
  GITHUB_API_URL: process.env.GITHUB_API_URL || "",
  GITHUB_TOKEN: "",
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY || "",
  GIT_BASE_URL: process.env.GIT_BASE_URL || "",
  GIT_TOKEN: "",
  GIT_SHA: "local",

  // ── Exec (svc-agent-runner) ──
  RUNNER_BACKEND: "runc",
  KATA_DEFAULT_RUNTIME: "kata-fc",
  EXEC_CPU_PERIOD: "100000",
  EXEC_CPU_QUOTA: "50000",
  EXEC_MEMORY_LIMIT: "512m",
  // On a developer machine: poller OFF (no unattended drain) and at most ONE
  // agent container at a time (512m × 1) — never let dev testing OOM the laptop.
  CLAUDE_POLL_ENABLED: "false",
  MAX_CONCURRENT_CLAUDE_RUNS: "1",
  AGENT_RUNNER_ENABLED: "true",
  // B6: derived from the catalog (config/services.json exec.internal_url) — ONE source of truth,
  // so a container/port change can't drift this dev fallback (the former hardcoded passthrough).
  AGENT_RUNNER_URL: internalUrlFor("exec"),
  DEFAULT_TIMEOUT_MS: "30000",
  MAX_TIMEOUT_MS: "300000",
  DOCKER_API_VERSION: "1.43",
  AISHA_MIGRATE_DEBUG_HOLD: "false",

  // ── Logging ──
  LOG_LEVEL: "info",

  // ── VITE_* (frontend env, většinou substituovány v build time, ale generator chce hodnotu) ──
  VITE_AISHA_BACKEND_URL: "http://localhost:3001",
  VITE_AISHA_BACKEND_ANON_KEY: "dev-anon-key",
  VITE_AISHA_BACKEND_PUBLISHABLE_KEY: "dev-publishable-key",
  VITE_AISHA_GATEWAY_URL: "http://localhost:3001",
  VITE_AISHA_GATEWAY_KEY: "dev-gateway-key",
  VITE_API_URL: "http://localhost:3001",
  // 127.0.0.1 (NOT localhost) so the host the browser/iOS-sim uses == the host
  // Keycloak stamps into the token `iss` (KC_HOSTNAME → http://127.0.0.1:8180,
  // set by scripts/lib/kc-host-auth.mjs). oidc-client validates the token `iss`
  // against this authority — a mismatch fails login even with a correct gateway.
  // ATS-safe for the iOS Simulator (Info.plist NSAllowsLocalNetworking=true).
  VITE_KC_URL: "http://127.0.0.1:8180",
  VITE_KC_AUTHORITY: `http://127.0.0.1:8180/realms/${LOCAL_KC_REALM}`,
  VITE_KC_CLIENT_ID: "aisha-app",
  VITE_AUTH_REDIRECT_URI: "http://localhost:8083/auth/callback",
  VITE_AUTH_POST_LOGOUT_URI: "http://localhost:8083",
  VITE_PUBLIC_SITE_URL: "http://localhost:8083",
  VITE_REQUIRE_AISHA_BACKEND_ENV: "false",
  VITE_SENTRY_DSN: "",
  VITE_WEB_PUSH_VAPID_PUBLIC_KEY: "",

  // ── Domains — ONE env-driven rule (see localDomains/ld above): every
  //    compose-label hostname = <subdomain>.${LOCAL_TLD}, derived from the same
  //    resolver + catalog prod uses. No localhost/.local mix, no per-service
  //    literals, no duplicate keys.
  ...localDomains,
  // STUDIO_DOMAIN_DIRECT is host-ACCESS (direct pgAdmin on the host), NOT a
  // compose label — stays localhost-resolvable on purpose (separate mechanism).
  STUDIO_DOMAIN_DIRECT: "studio.localhost",
  // Apex redirect router host (docker-compose.coolify-prebuilt.yml labels).
  // Local dev has no dedicated apex → unroutable sentinel (RFC 6761) keeps
  // the static Traefik router registered but never matching.
  EDGE_APEX_DOMAIN: "apex-redirect-disabled.invalid",

  // ── NetBird mesh hosts (placeholder for local dev — mesh not active) ──
  NETBIRD_MESH_HOST: "netbird.mesh.local",
  NETBIRD_MGMT_HOST: "host-gateway",

  // ── OAuth2 proxy cookie/whitelist zones — local single-domain (.localhost) ──
  OAUTH2_COOKIE_DOMAINS: ".localhost",
  OAUTH2_WHITELIST_DOMAINS: ".localhost",

  // ── Image pins (mirror config/image-versions.env; needed because local
  //    warmup doesn't source image-versions.env — local-compose-gen reads
  //    these from devEnvDefaults to populate compose env). ──
  IMAGE_NGINX: "nginx:1.27-alpine",
  IMAGE_NETBIRD: "netbirdio/netbird:0.70.0",
  IMAGE_NETBIRD_MANAGEMENT: "netbirdio/management:0.70.0",
  IMAGE_NETBIRD_SIGNAL: "netbirdio/signal:0.70.0",
  IMAGE_NETBIRD_DASHBOARD: "netbirdio/dashboard:v2.37.1",
  IMAGE_NETBIRD_RELAY: "netbirdio/relay:0.70.0",
  IMAGE_SYNAPSE: "matrixdotorg/synapse:v1.119.0",
  IMAGE_ELEMENT_WEB: "vectorim/element-web:v1.11.86",
  IMAGE_LK_JWT_SERVICE: "ghcr.io/element-hq/lk-jwt-service:0.2.1",
  IMAGE_LIVEKIT: "livekit/livekit-server:v1.7.2",
  IMAGE_COTURN: "coturn/coturn:4.6.2-r10",
  IMAGE_MAUTRIX_TELEGRAM: "dock.mau.dev/mautrix/telegram:v0.2604.0",
  IMAGE_MAUTRIX_WHATSAPP: "dock.mau.dev/mautrix/whatsapp:v0.2604.0",
  IMAGE_MAUTRIX_SIGNAL: "dock.mau.dev/mautrix/signal:v0.2604.0",
  IMAGE_MAUTRIX_DISCORD: "dock.mau.dev/mautrix/discord:v0.7.6",
  IMAGE_MAUTRIX_SLACK: "dock.mau.dev/mautrix/slack:v0.2604.0",
  IMAGE_MAUTRIX_META: "dock.mau.dev/mautrix/meta:v0.2604.0",
  IMAGE_POSTMOOGLE: "registry.gitlab.com/etke.cc/postmoogle:v0.9.7",
  IMAGE_N8N: "n8nio/n8n:1.79.0",
  IMAGE_NOCODB: "nocodb/nocodb:0.260.0",
  IMAGE_APPSMITH: "appsmith/appsmith-ce:v1.71",
  // MinIO (server i `mc`) se staví ze zdroje — docker/minio/Dockerfile, žádný pin.
  // Dopravu balíků (ingest-drop-push/-pull) veze rclone.
  IMAGE_RCLONE: "rclone/rclone:1.68",
  IMAGE_DOZZLE: "amir20/dozzle:v8.7.0",
  IMAGE_PGADMIN: "dpage/pgadmin4:8.13",
  IMAGE_CADDY: "caddy:2-alpine",
  IMAGE_DOCKER_CLI: "docker:27-cli",
  IMAGE_LOKI: "grafana/loki:3.0.0",
  IMAGE_PROMETHEUS: "prom/prometheus:v2.50.1",
  IMAGE_NODE_EXPORTER: "prom/node-exporter:v1.7.0",
  IMAGE_CADVISOR: "gcr.io/cadvisor/cadvisor:v0.49.1",
  IMAGE_POSTGRES_EXPORTER: "prometheuscommunity/postgres-exporter:v0.15.0",
  IMAGE_GRAFANA: "grafana/grafana:11.0.0",
  IMAGE_OAUTH2_PROXY: "quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine",
  IMAGE_LLM_GATEWAY: "ghcr.io/theopenco/llmgateway-gateway:latest",

  // ── Build-time secrets used by Dockerfile ARG ──
  COLUMN_ENCRYPTION_KEY: D64,
  VERDACCIO_TOKEN: "dev-verdaccio-token",
  VERDACCIO_URL: "http://localhost:4873",

  // ── Env-completeness: vars referenced bare (${VAR}) in preset-reachable
  //    compose files but previously ABSENT from devEnvDefaults → silently
  //    substituted as "" by `docker compose config` (the KEYCLOAK_DOMAIN_PUBLIC
  //    bug class). Declared here so the generator's hard-fail stays green and
  //    no malformed config (empty host/secret) reaches the local stack. ──
  // auth.localhost (NOT plain localhost): pki compose declares extra_hosts
  // entries for BOTH ${KEYCLOAK_DOMAIN_PUBLIC} and ${KEYCLOAK_DOMAIN} — if the
  // two interpolate to the SAME value, `docker compose config` fails on the
  // duplicate key ("extra_hosts must be a mapping") and --preset full dies.
  // *.localhost resolves to 127.0.0.1 (RFC 6761) and the KC endpoint resolver
  // overwrites KC_ISSUER/KC_HOSTNAME anyway, so the value only needs to be
  // host-resolvable and DISTINCT from KEYCLOAK_DOMAIN.
  KEYCLOAK_DOMAIN_PUBLIC: "auth.localhost",
  // Bez nasazené PKI se vypíná POŽADAVEK na CA bundle (compose čte
  // `${PKI_BUNDLE_REQUIRED:?…}`; v produkci to odvozuje cold-start z manifestu).
  // Lokální zrcadlo nemá pki-bridge — PKI_BRIDGE_URL tu není a assemble-ca-bundle.sh
  // na prázdnou adresu končí „no mesh trust" exit 0 — takže požadavek je po
  // pravdě `false`, stejně jako NETBIRD_ENABLED výš: lokálně se mesh důvěra nestaví.
  PKI_BUNDLE_REQUIRED: "false",
  // Full-preset-only stacks (pki/exec/cosmos) reference these bare. Distinct
  // *.localhost values per var — same duplicate-key lesson as above.
  INTERNAL_TLD: "internal.localhost",
  MESH_TLD: "mesh.localhost",
  COOLIFY_URL: "http://localhost",       // mirror COOLIFY_BASE_URL
  // n8n app DB connection (n8n role on aisha-db; pairs with N8N_DB_PASSWORD)
  N8N_DB_HOST: "aisha-db",
  N8N_DB_NAME: "postgres",
  N8N_DB_PORT: "5432",
  N8N_DB_USER: "n8n_app",
  N8N_OIDC_SECRET: D32,
  N8N_COOKIE_SECRET: D32C,

  // Local DB coordinates (reference for local deploy; scripts load from
  // generated .env.local.dev or the getter helpers — never hardcoded in logic)
  LOCAL_DB_HOST: "127.0.0.1",
  LOCAL_DB_PORT: "54322",
  LOCAL_DB_USER: "postgres",
  LOCAL_DB_PASSWORD: "dev_postgres_password",

  OAUTH2_PROXY_COOKIE_SECRET: D32C,
  APPSMITH_INTRANET_OIDC_SECRET: D32,
  NB_MANAGEMENT_URL: "https://netbird.mesh.local:33073",  // mesh out-of-scope locally; sensible placeholder
  NOCODB_ADMIN_EMAIL: "admin@aisha.guru",
  NOCODB_ADMIN_PASSWORD: "dev_nocodb_admin",
  // Required since the :? fail-fast conversion of coolify.yml secrets —
  // local-compose-gen runs `docker compose config`, which hard-fails on
  // unset/empty :? vars, so every converted secret needs a non-empty dev value.
  INTRANET_API_KEY: "dev_intranet_api_key",
  // Token dvojice dveře ↔ brána pro roster schválených tabletů (/internal/knock/roster).
  KNOCK_ROSTER_TOKEN: "dev_knock_roster_token",
  APPSMITH_ADMIN_EMAIL: "admin@aisha.guru",
  APPSMITH_ADMIN_PASSWORD: "dev_appsmith_admin",
  KRONOS_API_KEY: "",                    // external; intentionally empty (declared, not silent)
  // insight's shared Config (packages/insight/common/common/config.py) declares
  // MAESTRO_API_KEY + OPENAI_KEY with NO default → ragnarok/maestro pydantic
  // startup hard-fails (and `docker compose config` substitutes bare
  // ${MAESTRO_API_KEY} → "") unless these carry a non-empty dev value. Maestro IS
  // integrated (the multi-turn USP, called from svc-ai-chat); the dev keys just
  // satisfy field-presence locally — the bare-${VAR} env-completeness class above.
  MAESTRO_API_KEY: "dev_maestro_api_key",
  // ragnarok/maestro OPENAI_KEY := ${AISHA_LLM_GATEWAY_KEY:-} (routed through the
  // llm-gateway). Absent from devEnvDefaults it silently baked "" → ragnarok
  // crash-looped on "OPENAI_KEY is required for OpenAI type".
  AISHA_LLM_GATEWAY_KEY: "dev-llm-gateway-key",
  PKI_CLIENT_KEY_B64: "",
  REGISTRY_PROXY: "",                    // local pulls official library/* from Docker Hub
  PKI_DEFAULT_SECRET: D32,               // ${...:?} required → previously errored `--preset full`

  // n8n / orchestration / rabbit env-completeness keys (full-light preset) are
  // covered by the sections above (LANGFUSE_HOST, NPM_REGISTRY_URL, RABBITMQ_*,
  // OAUTH2_*_DOMAINS, AISHA_SERVICE_KEY). This block previously REDEFINED them
  // with placeholders (guest/guest rabbit creds, bare "langfuse" host, …) which
  // — JS duplicate object keys, later wins — silently overrode the real values
  // in the generated .env.local.dev. Locked out by the duplicate-object-keys gate.

  // ── Local/dev build tweaks (passed as Docker build args via the generated
  //    .env.local.dev + compose). These let local Docker builds (web image
  //    etc.) succeed without enforcing full prod i18n/content-seed parity
  //    (demo data / active dev often intentionally differ from the committed
  //    platform seeds). Prod builds (via Coolify/cold-start envs) do not set
  //    these (or set to false) so the strict gates run.
  SKIP_I18N_CHECK: "true",

  // ── Local dev seed profile (for content translations / demo data).
  // For local development we default to "dev" (active dev content, de-facto
  // demo but more lively/editable for development work).
  // Use "demo" for test-like data.
  // "template" (sablona) → clean/minimal content (no heavy demo fixtures).
  AISHA_SEED_PROFILE: "dev",

  // Web sablona / public site design from our committed templates.
  // svc-web-artifact auto-calls its own /seed-default on boot (self-trigger).
  // If AISHA_SEED_DOMAIN names a folder under domains/templates/<name>/ that
  // has index.html, that design (manifest + html/css + i18n) is ingested into
  // web_pages (idempotent; 304 if already present). Empty → domains/default/
  // (neutral skeleton). This is independent of AISHA_SEED_PROFILE (the latter
  // controls DB platform/demo layers via seed compile).
  // To use one of our sablony locally: AISHA_SEED_DOMAIN=cafe-shop (or company-wiki,
  // electrician-trade, garden-blog, farm-shop, legal-advisory, site-supervision).
  // The --seed-profile template path in local-warmup/setup can auto-default this.
  AISHA_SEED_DOMAIN: "",

  // ── Web brand multidomain + instance data/grafika import (env-driven) ──
  // Local mirrors prod's env contract so the same brand routing + seed import
  // can be exercised in local docker. Empty defaults → only the canonical local
  // web host / no overlay. Override via .env.local (e.g.
  // AISHA_WEB_PUBLIC_ALIASES=web,corp) — nic se nehardcoduje.
  AISHA_WEB_PUBLIC_ALIASES: "",          // CSV brand subdomains → <alias>.<tld>
  AISHA_WEB_APEX_MODE: "redirect",       // apex (bare tld): redirect | serve
  AISHA_INSTANCE_DATA_GIT_URL: "",       // private data repo (operators + NN_*.sql)
  AISHA_WEB_DESIGN_GIT_URL: "",          // private web-design repo (optional overlay)

  // ── Common local service URLs (parameterized; prefer getters in scripts)
  // These are the "local deploy" equivalents of prod domains.
  // Scripts doing deploy (setup, warmup, _env-loader, etc.) should use these
  // or the getters below instead of hardcoded localhost:port.
  //
  // NOTE: keys in this object must be UNIQUE (gate: duplicate-object-keys) —
  // a repeated key silently overrides the earlier value in the generated
  // .env.local.dev. RAGNAROK_URL is intentionally NOT here: it is interpolated
  // into container env (docker-compose.coolify.yml → svc-mcp-knowledge/gateway),
  // so it must stay the container-facing URL defined in the Ragnarok section
  // above; host-side callers use getLocalRagnarokUrl() (published host port).
  MAESTRO_URL: "http://localhost:8020",
  KRONOS_SHIM_URL: "http://localhost:9625",
  LANGFUSE_BASEURL: "http://localhost:3100",
  N8N_WEBHOOK_URL: "http://localhost:5678",
  VLLM_EMBEDDING_URL: "http://localhost:8123/v1",
  VLLM_GENERATION_URL: "http://localhost:8100/v1",
  DOCKER_MODEL_RUNNER_URL: "http://localhost:12434/engines/v1",
  OLLAMA_URL: "http://localhost:11434/v1",
  NOCODB_URL: "http://localhost:8085",
  APPSMITH_URL: "http://localhost:8090",
  // KEYCLOAK_URL: host-facing (published :8180). No compose file interpolates
  // ${KEYCLOAK_URL} into a container (containers hardcode http://aisha-keycloak:80),
  // so the host value owns this key.
  KEYCLOAK_URL: "http://localhost:8180",
  PGADMIN_URL: "http://localhost:5050",
  ELASTICSEARCH_URL: "http://localhost:9200",

  // ── Misc placeholders ──
  VAR: "",
};
// Druhé jméno Keycloaku pro `extra_hosts` (pki/llm-gateway/monitoring/openclaw ho
// čtou jako `${KEYCLOAK_EXTRA_HOST_ALIAS:?…}`). TÝŽ výrok jako v produkci
// (derive-domains --shell): kanonická doména, je-li různá od veřejné, jinak
// .invalid sentinel. Počítá se ze SOUSEDNÍCH hodnot výš, ne z opsaných literálů,
// a pravidlo má jeden domov v derive-domains — proto přiřazení až za objektem.
devEnvDefaults.KEYCLOAK_EXTRA_HOST_ALIAS = keycloakExtraHostAlias(
  devEnvDefaults.KEYCLOAK_DOMAIN,
  devEnvDefaults.KEYCLOAK_DOMAIN_PUBLIC,
);

/**
 * Dynamic local config accessors.
 * These prefer process.env (set by warmup/setup or .env) and fall back to
 * the devEnvDefaults / hostPorts defined above. This is the "local deploy config".
 *
 * Scripts should use these instead of hard-coded ports/URLs so that after
 * `npm run warmup:local` or `npm run setup`, everything is driven by the
 * generated local deployment state (analogous to production .env.coolify).
 */
export function getLocalGatewayUrl() {
  return (
    process.env.VITE_AISHA_GATEWAY_URL ||
    process.env.AISHA_POSTGREST_URL ||
    process.env.VITE_API_URL ||
    devEnvDefaults.VITE_AISHA_GATEWAY_URL ||
    "http://127.0.0.1:3001"
  );
}

export function getLocalDbUrl() {
  const host = process.env.LOCAL_DB_HOST || "127.0.0.1";
  const port = process.env.LOCAL_DB_PORT || hostPorts["aisha-db"]?.[5432] || 54322;
  const user = process.env.LOCAL_DB_USER || "postgres";
  const pass = process.env.LOCAL_DB_PASSWORD || "dev_postgres_password";
  return `postgresql://${user}:${pass}@${host}:${port}/postgres`;
}

export function getLocalGatewayPort() {
  // Extract from hostPorts or default
  const mapping = hostPorts["aisha-gateway"];
  if (mapping) {
    const containerPort = Object.keys(mapping)[0];
    return mapping[containerPort];
  }
  return 3001;
}

// Additional parameterized getters for deploy scripts (setup, _env-loader, warmup, etc.).
// Always prefer process.env (from .env.local.dev or override) then devEnvDefaults.
// This ensures "vse naparametrovane" – everything in deploy scripts is dynamic from
// the central local deploy config (analog to prod .env.coolify / domains.env).
export function getLocalRagnarokUrl() {
  const host = process.env.LOCAL_HOST || "localhost";
  // hostPorts maps { containerPort: hostPort } — host-side callers need the
  // PUBLISHED host port. devEnvDefaults.RAGNAROK_URL is deliberately NOT
  // consulted here: that value is the container-facing URL
  // (http://backend--integration--ragnarok:9696) interpolated into compose env,
  // unreachable from the host.
  const p = hostPorts["ragnarok"] || { 9696: 9696 };
  const port = Object.values(p)[0];
  return process.env.RAGNAROK_URL || `http://${host}:${port}`;
}
export function getLocalMaestroUrl() {
  const p = hostPorts["maestro"] || { 8020: 8020 };
  const port = Object.keys(p)[0];
  return process.env.MAESTRO_URL || devEnvDefaults.MAESTRO_URL || `http://localhost:${port}`;
}
export function getLocalKronosShimUrl() {
  return process.env.KRONOS_SHIM_URL || devEnvDefaults.KRONOS_SHIM_URL || "http://localhost:9625";
}
export function getLocalLangfuseUrl() {
  const p = hostPorts["langfuse"] || { 3100: 3100 };
  const port = Object.keys(p)[0];
  return process.env.LANGFUSE_BASEURL || devEnvDefaults.LANGFUSE_BASEURL || `http://localhost:${port}`;
}
export function getLocalN8nUrl() {
  return process.env.N8N_WEBHOOK_URL || devEnvDefaults.N8N_WEBHOOK_URL || "http://localhost:5678";
}
export function getLocalNocoDbUrl() {
  return process.env.NOCODB_URL || devEnvDefaults.NOCODB_URL || "http://localhost:8085";
}
export function getLocalAppsmithUrl() {
  return process.env.APPSMITH_URL || devEnvDefaults.APPSMITH_URL || "http://localhost:8090";
}
export function getLocalKeycloakUrl() {
  return process.env.KEYCLOAK_URL || devEnvDefaults.KEYCLOAK_URL || "http://localhost:8180";
}

export function getLocalVllmEmbedUrl() {
  return process.env.VLLM_EMBEDDING_URL || devEnvDefaults.VLLM_EMBEDDING_URL || "http://localhost:8123/v1";
}
export function getLocalVllmGenUrl() {
  return process.env.VLLM_GENERATION_URL || devEnvDefaults.VLLM_GENERATION_URL || "http://localhost:8100/v1";
}
export function getLocalDmrUrl() {
  return process.env.DOCKER_MODEL_RUNNER_URL || devEnvDefaults.DOCKER_MODEL_RUNNER_URL || "http://localhost:12434/engines/v1";
}
export function getLocalOllamaUrl() {
  return process.env.OLLAMA_URL || devEnvDefaults.OLLAMA_URL || "http://localhost:11434/v1";
}

// The getters above + named exports (devEnvDefaults, hostPorts, presets, stackDependencies)
// serve as the local deployment configuration. Import them or the getters directly.

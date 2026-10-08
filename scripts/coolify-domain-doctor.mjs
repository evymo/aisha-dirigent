#!/usr/bin/env node
/**
 * coolify-domain-doctor.mjs - check or apply Coolify docker_compose_domains.
 *
 * Default mode is read-only. Use --apply to PATCH domains. Use --restart only
 * when you explicitly want to trigger Coolify deploys after patching.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { toStoryApp, stripStoryPrefix, appPrefix } from "./lib/story-app.mjs";
import { buildOwnerIndex, findContractConflicts, findForeignClaimants, isUuidDefaultFqdn, extractHost, replaceOwner } from "./lib/fqdn-owners.mjs";
import { probeRoute, scopeProbable } from "./lib/routing-probe.mjs";
import { isMeshHost, withoutMeshHosts } from "./lib/mesh-host.mjs";
import { EDGE_PROXY_SLUZBA, domenaProCoolify, edgeOwnedSet, isReleaseSentinel } from "./lib/edge-vlastni-jmena.mjs";
import { CONFIG_ENV_FILES } from "./lib/config-env-files.mjs";
import { drzenaPolozka, drzeniProcesu, externiPolozka, mutujAplikaci } from "./lib/coolify-mutace.mjs";
import { hlaskaDrzeno } from "./lib/nasazeni-drzene.mjs";
import { duvodyNeslozeni, rezimApexu, verejneDomenyWebu } from "./lib/domeny-webu.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name, fallback = "") => {
  const match = argv.find((value) => value.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
};

const APPLY = flag("--apply");
const RESTART = flag("--restart");
const JSON_OUTPUT = flag("--json");
// Bez živých sond — JEN s --apply: tam sonda verdikt neovlivňuje (routy se
// změní až nasazením, které teprve přijde — redeploy před první vlnou). Při
// kontrole je sonda hlavní rozhodčí, takže kontrola bez ní by byla tichá
// zelená z neměření — kombinace se odmítá.
const NO_PROBE = flag("--no-probe");
if (NO_PROBE && !APPLY) {
  process.stderr.write("FATAL: --no-probe jen s --apply — kontrola bez živé sondy by nic neověřila\n");
  process.exit(2);
}
// 10s was too tight during cold-start (Coolify API has stretches of
// ~20-30s slowness while creating 13 apps). Bumped to 60s default;
// caller can still override via --timeout-ms.
const TIMEOUT_MS = Number(arg("--timeout-ms", "60000"));
const MAX_RETRIES = Number(arg("--max-retries", "3"));
const ONLY = arg("--only", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

function loadToken() {
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

// Domain values come from config/domains.env (SoT) + process.env overlay.
// Iter 13 dropped the in-script default map per template-only directive
// — operator declares their deployment domains in config/domains.env (or a
// per-env overlay sourced before this script runs).
const env = {
  ...loadEnvFile(resolve(ROOT, "config/domains.env")),
  ...process.env,
};

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function domainHosts(entries) {
  return (entries || [])
    .flatMap((entry) => parseCsv(entry?.domain))
    .map((domain) => extractHost(domain))
    .filter(Boolean);
}

// ⛔ NAMĚŘENO 2026-10-04 (ostrý cold-start forku s víc značkami): tady stála
// vlastní `webPublicDomains()` — APP_DOMAIN + aliasy + apex — a `WEB_FQDNS`
// neznala. Krok 4 cold-startu (`--apply`) tak přepsal `web` na jediné
// APP_DOMAIN, ačkoli deploy-init o krok dřív zapsal všech 13 jmen deklarace.
// Dva výklady téže deklarace; vyhrál poslední zapisovatel. Domény webu teď
// skládá JEDINÝ domov (lib/domeny-webu.mjs), týž, který volá deploy-init.
//
// „Nevím" není „nic": když deklarace instance v prostředí není (doktor puštěný
// bez overlaye — `WEB_FQDNS` pak z domains.env zbyde jako nerozbalená šablona),
// domov nevydá seznam a služba `web` jde níž jako NESLOŽENÁ — nic se pro edge
// nezapíše (užší seznam by smazal routy značek) a řekne se proč.
const DOMENY_WEBU = verejneDomenyWebu(env);
const kontraktWebu = {
  name: "web",
  ...(DOMENY_WEBU.znamo
    ? { domain: DOMENY_WEBU.domeny.join(",") }
    : { domain: "", neslozeno: duvodyNeslozeni(DOMENY_WEBU) }),
};

function edgeProxyDomains() {
  // ⛔ AUTH_DOMAIN_PUBLIC TU DŘÍV NEBYL — a to byla vada (naměřeno 2026-08-28).
  //
  // Stálo tu: „veřejnou tvář auth servíruje Keycloak sám, protože edge ji umí
  // přeložit až přes mesh — a mesh bez Keycloaku nevznikne." Obojí je dnes
  // vyvrácené měřením:
  //   1) do kontraktu Keycloaku se to NIKDY nepropsalo (registroval jen PŘÍMOU
  //      tvář), takže veřejné jméno nemělo router U NIKOHO → Traefik 404;
  //   2) zaregistrovat ho na Keycloaku ANI NELZE: běží v zóně `*.backend`
  //      (jiný uzel), kdežto `auth.<public-tld>` směruje pfSense na uzel s edge.
  //      Router by vznikl tam, kam provoz nedorazí — a pálil by limit ACME;
  //   3) edge auth NEPŘEKLÁDÁ přes mesh, jde na PŘÍMOU tvář. Jeho vlastní log:
  //        [edge-proxy] AUTH_DOMAIN_PUBLIC=auth.<public> → https://<prefix>-auth.backend.<tld>
  //
  // Následek byl tichý: `extra.<public>` správně přesměroval na
  // `auth.<public>/realms/…/auth`, to vrátilo 404 a KAŽDÉ OIDC přihlášení
  // skončilo dřív, než začalo. Musí souhlasit s coolify-deploy-init.sh.
  const domains = [
    `https://${env.API_DOMAIN_PUBLIC}`,
    `https://${env.MCP_DOMAIN}`,
    `https://${env.DIRIGENT_DOMAIN}`,
  ];
  // Optional edge-fronted public faces (tier:optional services). The resolver
  // emits the real hostname when the service is in the profile, or an
  // unroutable `.invalid` sentinel when it is not — only real hostnames join
  // the frontend Traefik contract. This closes the "resolver emits a public
  // face but no routing plane registers it" class (live/gateway/companion
  // were resolver-emitted yet unrouted → public 404, found 2026-07-03).
  for (const key of ["KEYCLOAK_DOMAIN_PUBLIC", "LIVE_DOMAIN_PUBLIC", "GATEWAY_DOMAIN_PUBLIC", "COMPANION_DOMAIN_PUBLIC", "INGEST_DOMAIN_PUBLIC", "POTOK_DOMAIN_PUBLIC", "EXTRANET_DOMAIN_PUBLIC"]) {
    const host = env[key];
    if (host && !host.includes("${") && !host.endsWith(".invalid")) {
      domains.push(`https://${host}`);
    }
  }
  // netbird.<public> — řídicí rovina meshe: edge ji obslouží a pošle na PŘÍMOU
  // tvář (výjimka z „veřejné jde do meshe", majitel 2026-09-16). Jen s přímou
  // tváří — bez ní by edge měl router bez trasy. Musí souhlasit s deploy-initem
  // a s `netbird_block` v edge-proxy. Měření: compose-notes prebuilt.
  const skutecne = (host) => Boolean(host) && !host.includes("${") && !host.endsWith(".invalid");
  // Jedno jméno pro obě tváře (jednouzlová topologie): patří netbird-proxy —
  // dva Host routery pro týž host na jednom Traefiku by byly nejednoznačné.
  if (skutecne(env.NETBIRD_DOMAIN) && skutecne(env.NETBIRD_DOMAIN_DIRECT) && env.NETBIRD_DOMAIN !== env.NETBIRD_DOMAIN_DIRECT) {
    domains.push(`https://${env.NETBIRD_DOMAIN}`);
  }
  // mesh-model.<public> — řídicí rovina MODELOVÉHO meshe (varianta C): týž vzor, jen
  // s lane MODEL_MESH (bez ní topologie jména nevydá). Musí souhlasit s
  // `netbird_model_block` v edge-proxy.
  if (skutecne(env.NETBIRD_MODEL_DOMAIN) && skutecne(env.NETBIRD_MODEL_DOMAIN_DIRECT) && env.NETBIRD_MODEL_DOMAIN !== env.NETBIRD_MODEL_DOMAIN_DIRECT) {
    domains.push(`https://${env.NETBIRD_MODEL_DOMAIN}`);
  }
  // Cizí aplikace přes mesh (EXTERNAL_FACES). Seznam vydává derivace
  // jen pro tváře, které edge opravdu routuje — bez meshe je prázdný.
  // Musí souhlasit s coolify-deploy-init.sh.
  for (const host of parseCsv(env.EDGE_EXTERNAL_FACE_HOSTS)) {
    if (!host.includes("${") && !host.endsWith(".invalid")) domains.push(`https://${host}`);
  }
  // Režim apexu čte TENTÝŽ normalizátor jako derivace i složení webu (lib/domeny-webu.mjs
  // → derive-domains normalizeApexMode). Dřív tu stálo vlastní `toLowerCase() !== "serve"`:
  // surové `web`/`spa` (operátorský trezor, .env.coolify) by dalo apex SOUČASNĚ webu
  // (derivace: serve) i edge-proxy (tady: redirect) — dva routery na jeden host v jedné app.
  const apexMode = rezimApexu(env);
  if (
    apexMode !== "serve"
    && env.PUBLIC_TLD
    && !env.PUBLIC_TLD.includes("${")
    && env.PUBLIC_TLD !== env.APP_DOMAIN
  ) {
    domains.push(`https://${env.PUBLIC_TLD}`);
  }
  return domains.join(",");
}

// Veřejná jména, která na svém uzlu vlastní EDGE — rozhodla derivace
// (EDGE_OWNED_HOSTS, viz edgeOwnedHosts v derive-domains.mjs). Backend na témž
// uzlu je neregistruje: dva routery pro týž host na jednom Traefiku jsou
// FQDN_CONFLICT (naměřeno 2026-09-27). Uplatňuje se na KAŽDÝ kontrakt níž;
// výjimkou je jen edge-proxy, který jména vlastní. Musí souhlasit se
// `set_coolify_domains` v coolify-deploy-init.sh (brána edge-vlastni-jmena-na-svem-uzlu).
const EDGE_VLASTNI = edgeOwnedSet(env.EDGE_OWNED_HOSTS);

const expected = [
  { app: "aisha-registry", domains: [{ name: "registry-cache", domain: `https://${env.REGISTRY_DOMAIN}:5000` }] },
  { app: "aisha-edge", domains: [
    kontraktWebu,
    // edge-proxy: the Caddy listener (port 80). It reverse-proxies the public
    // *.${PUBLIC_TLD} hostnames (auth/api/mcp/dirigent) to their
    // *.backend.${INTERNAL_TLD} upstreams. ALL public hostnames are
    // registered as ONE comma-separated docker_compose_domains entry —
    // Coolify auto-gen then emits one Traefik router per host PLUS the
    // matching loadbalancer service (port 80, auto-detected from EXPOSE).
    // Verified in production 2026-06-09: auth.aisha.guru → HTTP 200.
    //
    // This is the production routing source of truth. The static Traefik
    // labels in docker-compose.coolify-prebuilt.yml carry ${VAR} placeholders
    // (correct for local `docker compose up`) but Coolify escapes $ → $$ at
    // deploy time, so they never match on Coolify and are local-dev-only.
    {
      name: "edge-proxy",
      domain: edgeProxyDomains(),
    },
    // mesh-router: SENTINEL. This container has NO public listener (only
    // edge-proxy reaches it via Docker DNS on coolify network). Without
    // a docker_compose_domains entry, Coolify's Traefik provider would
    // try to register a router and fail (no EXPOSE port). Sentinel keeps
    // Coolify happy without exposing anything externally.
    // Prefix-unique per instance: the sentinel is an unroutable placeholder (RFC 2606
    // .invalid — mesh-router has no public listener), but Coolify enforces domain
    // uniqueness ACROSS projects, so a SHARED literal 409s against every co-tenant's edge
    // on the same host (observed: tenant-studio-edge). isSentinelDomain still filters it
    // out of the PATCH; keeping it unique is belt-and-suspenders + the correct shape.
    { name: "mesh-router", domain: `http://mesh-router-${appPrefix()}-disabled.invalid:80` },
  ] },
  { app: "aisha-core", domains: [
    { name: "gateway", domain: `https://${env.API_DOMAIN}:3001` },
  ] },
  // pgAdmin was extracted from core into its own Coolify app. Keep its admin-
  // only direct route on that app; assigning the service name to aisha-core is
  // invalid and produced permanent doctor drift after the extraction.
  { app: "aisha-pgadmin", domains: env.STUDIO_DOMAIN_DIRECT
    ? [{ name: "pgadmin-auth", domain: `https://${env.STUDIO_DOMAIN_DIRECT}:4180` }] : [] },
  // aisha-keycloak: ONLY the internal direct host (auth.backend.${INTERNAL_TLD}).
  // KC runs on Backend; the public auth.${PUBLIC_TLD} hostname is served by
  // edge-proxy (Frontend) which reverse-proxies here. Routing goes through
  // docker_compose_domains (NOT compose Traefik labels) because Coolify
  // escapes $ → $$ in label values at deploy time, leaving ${KEYCLOAK_DOMAIN}
  // a literal string that Traefik never matches. The :80 suffix targets
  // KC_HTTP_PORT=80. See feedback_coolify_label_dollar_escape.md.
  // KEYCLOAK_DOMAIN_DIRECT = the mesh-INDEPENDENT backend host (auth.backend.<tld>).
  // Under MESH_ENABLED=true, KEYCLOAK_DOMAIN itself is mesh-overlaid
  // (auth.mesh.<tld>), so registering that here gave KC a Traefik router ONLY for
  // the mesh host → auth.backend.<tld> (edge upstream) + auth.<public> (edge face)
  // both 404, Phase B KC bootstrap could never reach KC (incident 2026-07-16).
  // The direct host is what this comment always intended; make the code match.
  { app: "aisha-keycloak", domains: [{ name: "keycloak", domain: `https://${env.KEYCLOAK_DOMAIN_DIRECT || env.KEYCLOAK_DOMAIN}:80` }] },
  // aisha-observability (langfuse): same $ → $$ rationale as keycloak.
  { app: "aisha-observability", domains: [{ name: "langfuse-gateway", domain: `https://${env.LANGFUSE_DOMAIN}:8080` }] },
  // aisha-admin: nocodb + appsmith-auth + intranet-auth, all internal
  // *.backend.${INTERNAL_TLD}. Same $ → $$ rationale as keycloak.
  { app: "aisha-admin", domains: [
    { name: "nocodb", domain: `https://${env.NOCODB_DOMAIN}:8080` },
    { name: "appsmith-auth", domain: `https://${env.APPSMITH_DOMAIN}:4180` },
    { name: "intranet-auth", domain: `https://${env.INTRANET_DOMAIN}:4180` },
  ] },
  // Orchestration runs on Backend; docker_compose_domains drives Backend
  // Traefik routing for n8n.backend.${INTERNAL_TLD}. The PUBLIC aliases
  // (mcp/dirigent.${PUBLIC_TLD}) are ALSO registered here — not because
  // clients reach Backend directly (DNS points them at the Frontend edge),
  // but because the edge Caddy forwards the BROWSER Host on those routes so
  // oauth2-proxy scopes its session cookie + redirect_uri to the public
  // zone (backend Traefik rewrites untrusted X-Forwarded-Host, verified
  // 2026-07-03 — cookie Domain came back in the internal zone and browser
  // login on the public alias looped). Backend Traefik therefore needs
  // Host routers for the public aliases → this comma-separated entry.
  // NOTE: backend Traefik may log failed ACME attempts for the alias hosts
  // (their DNS points at Frontend) — harmless; TLS on the edge→backend hop
  // uses the internal-host SNI from the upstream URL.
  { app: "aisha-orchestration", domains: [{ name: "n8n-auth", domain: [
    `https://${env.N8N_DOMAIN}:4180`,
    ...(env.MCP_DOMAIN ? [`https://${env.MCP_DOMAIN}:4180`] : []),
    ...(env.DIRIGENT_DOMAIN ? [`https://${env.DIRIGENT_DOMAIN}:4180`] : []),
  ].join(",") }] },
  // aisha-messaging: synapse + element-web + element-call, all internal
  // *.backend.${INTERNAL_TLD}. Same $ → $$ rationale as keycloak.
  { app: "aisha-messaging", domains: [
    { name: "synapse", domain: `https://${env.MATRIX_DOMAIN}:8008` },
    { name: "element-web", domain: `https://${env.ELEMENT_DOMAIN}:80` },
    { name: "element-call", domain: `https://${env.ELEMENT_CALL_DOMAIN}:8080` },
  ] },
  { app: "aisha-pki", domains: [
    { name: "pki-auth", domain: `https://${env.PKI_DOMAIN}:4180` },
    { name: "pki-bridge", domain: `https://${env.PKI_BRIDGE_DOMAIN}:3040` },
  ] },
  // Derived-domain apps — GRAFANA_DOMAIN / GATEWAY_DOMAIN are computed by
  // scripts/lib/derive-domains.mjs from config/services.json and exported into
  // the environment by cold-start before this script runs. Each entry is
  // GUARDED on its env var so a standalone run (without the cold-start exports)
  // reports [] instead of PATCHing a bogus `https://undefined` host. Both sit
  // behind an OAuth2-Proxy (Keycloak OIDC) listener; ports match the compose
  // loadbalancer.server.port (4181 grafana-auth, 4000 llm-gateway).
  // NOTE: docker-compose.coolify-monitoring.yml (Dozzle) is NOT in
  // coolify/manifests/aisha.manifest — it's not a deployed app, so it has no
  // domain-doctor entry. Wire it into the manifest first if it's ever needed.
  { app: "aisha-observability-stack", domains: env.GRAFANA_DOMAIN
    ? [{ name: "grafana-auth", domain: `https://${env.GRAFANA_DOMAIN}:4181` }] : [] },
  { app: "aisha-llm-gateway", domains: env.GATEWAY_DOMAIN
    ? [{ name: "llm-gateway", domain: `https://${env.GATEWAY_DOMAIN}:4000` }] : [] },
  // aisha-openclaw (advisory companion) is public:true in config/services.json
  // (subdomain "companion") and derive-domains emits COMPANION_DOMAIN. Its public
  // face is fronted by the openclaw-auth OAuth2 proxy (Keycloak login) that ships in
  // the SAME Coolify app (docker-compose.coolify-openclaw.yml), so the companion
  // route points at the PROXY port 4180 (openclaw-auth-svc loadbalancer.server.port),
  // NOT the daemon's 5210 — exactly like n8n is fronted by n8n-auth. The openclaw
  // daemon carries no public Traefik router, so nothing reaches it bypassing the OAuth
  // gate. app stays "aisha-openclaw" (the Coolify app whose compose exposes 4180).
  // Guarded on the env var like grafana/gateway so a standalone run reports []
  // instead of PATCHing https://undefined.
  // name MUST be the compose SERVICE that exposes the port (Coolify matches the
  // docker_compose_domains name to a service) → "openclaw-auth" (exposes 4180), not
  // the "openclaw" daemon service (5210). Mirrors n8n → name "n8n-auth".
  { app: "aisha-openclaw", domains: env.COMPANION_DOMAIN
    ? [{ name: "openclaw-auth", domain: `https://${env.COMPANION_DOMAIN}:4180` }] : [] },
  { app: "aisha-monitoring", domains: env.DOZZLE_DOMAIN
    ? [{ name: "dozzle-auth", domain: `https://${env.DOZZLE_DOMAIN}:4181` }] : [] },
  { app: "aisha-source-broker", domains: env.BROKER_DOMAIN
    ? [{ name: "svc-source-broker", domain: `https://${env.BROKER_DOMAIN}:8090` }] : [] },
  { app: "aisha-livekit", domains: env.LIVEKIT_DOMAIN
    ? [{ name: "livekit", domain: `https://${env.LIVEKIT_DOMAIN}:7880` }] : [] },
  // Extranet owns only its canonical internal host. Its public alias is owned
  // by edge-proxy (and optionally gated there by oauth2-proxy), so the two apps
  // never compete for one public hostname.
  { app: "aisha-extranet", domains: env.EXTRANET_DOMAIN && !env.EXTRANET_DOMAIN.endsWith(".invalid")
    ? [{ name: "extranet", domain: `https://${env.EXTRANET_DOMAIN}:8080` }] : [] },
  // aisha-realtime (ws-gateway): canonical internal host live.backend.* →
  // ws-gateway:3002 via backend Traefik (the compose's Host(`${LIVE_DOMAIN}`)
  // labels are $-escaped by Coolify and never match — docker_compose_domains
  // is the production routing SoT, same as keycloak/langfuse). The public
  // live.${PUBLIC_TLD} face is fronted by edge-proxy (edgeProxyDomains above).
  // Guarded on the env var like grafana/gateway. Port = ws-gateway
  // loadbalancer.server.port (3002); manual priority-200 router in the
  // compose satisfies the caddy-template-upstreams non-standard-port rule.
  { app: "aisha-realtime", domains: env.LIVE_DOMAIN && !env.LIVE_DOMAIN.endsWith(".invalid")
    ? [{ name: "ws-gateway", domain: `https://${env.LIVE_DOMAIN}:3002` }] : [] },
  // NOTE: aisha-ledger is public:true in config/services.json (subdomain
  // "cosmos") but docker-compose.coolify-cosmos.yml documents the node as "NOT
  // a public chain — not exposed to internet" and exposes only internal RPC
  // (26657) + API (1317). That contradiction must be resolved by the owner
  // (flip services.json to public:false, OR add a deliberate public explorer/
  // API listener) before a cosmos.${PUBLIC_TLD} entry is added here — we do NOT
  // register a public domain for a component the compose marks internal.
  // aisha-netbird: HTTP i gRPC povrch NetBirdu (dashboard, /api, /relay,
  // management + signal) demuxuje Caddy v netbird-proxy za JEDNÍM Host routerem
  // generovaným z této položky (port 80 z EXPOSE). Host-less router by na
  // sdíleném ingressu chytil každého nájemníka.
  //
  // ⛔ JEN PŘÍMÁ TVÁŘ (naměřeno 2026-09-16). Veřejné `netbird.${PUBLIC_TLD}` tu
  // bylo taky — a byl to router tam, kam provoz nedorazí: pfSense posílá veřejnou
  // zónu na uzel s edge, takže veřejně 404 (/, /api, /relay i gRPC) a tamní
  // Traefik servíroval „TRAEFIK DEFAULT CERT", protože ACME výzva přistála
  // jinde (a pálila limit účtu). Týž případ jako veřejné jméno Keycloaku výš.
  // Veřejnou tvář teď obsluhuje edge → přímá tvář (edgeProxyDomains).
  //
  // `NETBIRD_DOMAIN_DIRECT` leží v zóně, kterou edge směruje na uzel služby:
  // na ni míří edge i operátorské nástroje (discovery, doktor). Agenti meshe
  // chodí přes `netbird.<mesh>:33073`, ne sem.
  // Guarded jako grafana/gateway: samostatný běh bez env dá [] místo PATCH
  // na https://undefined.
  { app: "aisha-netbird", domains: env.NETBIRD_DOMAIN_DIRECT
    ? [{ name: "netbird-proxy", domain: `https://${env.NETBIRD_DOMAIN_DIRECT}` }]
    : [] },
  // aisha-netbird-model: řídicí rovina MODELOVÉHO meshe (varianta C) — týž tvar jako
  // aisha-netbird: Caddy v netbird-model-proxy demuxuje HTTP i gRPC za JEDNÍM Host
  // routerem PŘÍMÉ tváře; veřejnou obsluhuje edge (netbird_model_block). Bez lane
  // MODEL_MESH topologie jméno nevydá → [] (aplikace v Coolify ani není).
  { app: "aisha-netbird-model", domains: env.NETBIRD_MODEL_DOMAIN_DIRECT
    ? [{ name: "netbird-model-proxy", domain: `https://${env.NETBIRD_MODEL_DOMAIN_DIRECT}` }]
    : [] },
  // Prefix-generic: rewrite each contract's Coolify APP name (aisha-<role>) to
  // THIS deploy's prefix (APP_NAME_PREFIX, e.g. tenant-<role>) via the shared
  // story-app abstraction. Domain/service NAMES inside `domains` are compose
  // service names — prefix-independent — so they are deliberately NOT remapped.
  // Default "aisha" = identity, so the upstream stack contract is unchanged.
].map((c) => ({
  ...c,
  app: toStoryApp(c.app),
  domains: c.domains.map((entry) => ({
    ...entry,
    // Mesh jména i jména ve vlastnictví edge vyřadí JEDEN domov (domenaProCoolify);
    // když nezbude nic, jde uvolňovací sentinel — jinak by starý router zůstal.
    domain: domenaProCoolify(entry.name, entry.domain, EDGE_VLASTNI, appPrefix()),
  })),
}));

function selected(contract) {
  if (ONLY.length === 0) return true;
  const short = stripStoryPrefix(contract.app);
  return ONLY.includes(contract.app) || ONLY.includes(short);
}

function normalizeName(name) {
  return String(name).replace(/_/g, "-");
}

function parseStoredDomains(raw) {
  if (!raw) return new Map();
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return new Map(); }
  }
  const map = new Map();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry?.name) map.set(normalizeName(entry.name), entry.domain || "");
    }
  } else if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const name = entry?.name || key;
      map.set(normalizeName(name), entry?.domain || "");
    }
  }
  return map;
}

const token = loadToken();
if (!token) {
  console.error("COOLIFY_API_TOKEN not found in env or .env-prod-backup");
  process.exit(2);
}

const base = (() => {
  const v = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_URL (or COOLIFY_BASE_URL) required\n"); process.exit(2); }
  return v.replace(/\/$/, "");
})();

// Shared retry/timeout client (scripts/lib/coolify-http.mjs) — the same
// behavior cold-start-verify.mjs uses, so the two tools can never diverge
// on Coolify API resilience again (the verifier's old 10s single-shot
// fetch aborted while this doctor succeeded on the same instance).
const coolify = createCoolifyClient({
  baseUrl: base,
  token,
  timeoutMs: TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
});

const apps = await coolify("/applications");
// Confine to OUR project's environments — the shared Coolify host carries
// other tenants' same-named <prefix>-* apps; a global name filter would PATCH
// their domains. Fail-loud without COOLIFY_PROJECT_UUID (no global fallback).
// Name filter is prefix-generic (APP_NAME_PREFIX): the contract apps are
// toStoryApp'd to the same prefix, so aisha default is unchanged.
const scope = await createProjectScope(coolify);
const APP_PREFIX_DASH = `${appPrefix()}-`;
const appByName = new Map(
  apps
    .filter((app) => scope.inProject(app) && app.name?.startsWith(APP_PREFIX_DASH))
    .map((app) => [app.name, app]),
);
// FQDN ownership index — PROJECT-SCOPED. domain-doctor never ACTS across the project
// boundary. This index only catches two of OUR OWN apps colliding on one host. A squatter
// in ANOTHER project is that project's own doctor's cleanup (its contract shows the foreign
// host as an `extra` and drops it, scoped to that project) — here it is only READ, so that
// apply knows when to stop instead of forcing (findForeignClaimants below).
const ownerIndex = buildOwnerIndex(apps.filter((app) => scope.inProject(app)));

// ⛔ VYNUCENÍ DOMÉNY JEN VÝSLOVNĚ (2026-09-13), sjednoceno s coolify-deploy-init.sh.
// `force_domain_override` doménu přebije, ale předchozímu vlastníkovi ji NEODEBERE —
// vzniknou dva routery na jeden host (incident 2026-07-09 tenantcache). Do teď ho doktor
// posílal od druhého pokusu SÁM, s odůvodněním „bezpečné, konflikty v projektu jsou
// prázdné" — jenže konflikty se počítaly jen UVNITŘ projektu a cizího držitele nikdo
// neviděl. Naměřeno na nasazené instanci: registry cache měla drift na host, který na
// témž serveru drží aplikace JINÉHO projektu — krok 4 cold-startu by pokusem 2 vynutil
// dvojí vazbu. Vynucuje se proto JEN s ALLOW_DOMAIN_FORCE_OVERRIDE=1 (sankcionovaná
// migrace forku), stejně jako v deploy-init. Kdo host vlastní, tenhle nástroj NEROZHODUJE.
const POVOLIT_VYNUCENI = process.env.ALLOW_DOMAIN_FORCE_OVERRIDE === "1";

// Jméno projektu k environment_id — jen pro HLÁŠENÍ cizího držitele, jen když nějaký je.
// /applications jméno projektu nenese (naměřeno: pole environment_id, destination.server_id)
// a /environments neexistuje (404), takže se projde /projects → /projects/{uuid}
// a skončí se, jakmile jsou hledaná prostředí pojmenovaná. Výsledek se drží pro celý běh.
const projektProstredi = new Map();
async function pojmenujProstredi(envIds) {
  const zbyva = new Set(envIds.filter((id) => id != null && !projektProstredi.has(id)));
  if (zbyva.size === 0) return;
  try {
    const projekty = await coolify("/projects");
    for (const projekt of Array.isArray(projekty) ? projekty : []) {
      if (zbyva.size === 0) break;
      const detail = await coolify(`/projects/${projekt.uuid}`);
      for (const prostredi of detail?.environments || []) {
        if (zbyva.has(prostredi.id)) {
          projektProstredi.set(prostredi.id, projekt.name);
          zbyva.delete(prostredi.id);
        }
      }
    }
    for (const id of zbyva) projektProstredi.set(id, `NEZMĚŘENO (environment_id=${id} není v žádném projektu)`);
  } catch (err) {
    for (const id of zbyva) projektProstredi.set(id, `NEZMĚŘENO (environment_id=${id}: ${String(err?.message || err).slice(0, 120)})`);
  }
}
// `.invalid` is the RFC 2606 reserved TLD our topology resolver emits to mean "this service
// has no public domain". It is a LOCAL marker only — Coolify would index it as a real host
// (and every fork emits the same string, so they collide). Never let one reach the API.
const isSentinelDomain = (domain) => /\.invalid(?::\d+)?(?:\/.*)?$/i.test(String(domain || ""));
// A contract entry whose `${VAR}` never expanded — the caller ran without that
// service's env in scope. The shell leaves the literal in place, so the contract
// yields hosts like `https://${NOCODB_DOMAIN:-}:8080`. Coolify accepts such a
// string as a REAL domain and Traefik then routes a host nobody can resolve, so
// the service looks deployed and is unreachable — and one bad entry drops the
// WHOLE payload (see the sentinel note below for that failure mode in prod).
// Measured 2026-08-08: running the doctor with only one app's env exported
// reported exactly this shape as `desired` for six other apps.
const isUnresolvedDomain = (domain) => String(domain || "").includes("${");
// Záznam, jehož domény domov odmítl složit (lib/domeny-webu.mjs: deklarace v prostředí
// není, nebo je neplatná). Zachází se s ním PŘESNĚ jako s nerozbaleným `${VAR}`: jméno
// se nárokuje (uložená hodnota není „extra"), nic se pro aplikaci nezapíše a hlásí se.
const isNeslozeny = (entry) => Array.isArray(entry.neslozeno);
// A mesh name — `*.internal` — is never a Coolify domain. Same rule as
// set_coolify_domains in coolify-deploy-init.sh (2026-08-27): Coolify turns every
// domain into a Traefik router with `certresolver=letsencrypt`, and LE can NEVER
// issue for `.internal`, so each router retries forever and burns the ACME
// account's failure budget until LE refuses LEGITIMATE hosts of the same account
// (429). Mesh traffic goes over WireGuard to the stack's own mesh-ingress with an
// AISHA PKI certificate, not through the public Traefik.
// Measured 2026-09-13 on a fork whose deploy-init already skipped them: this
// doctor had re-registered 16 mesh domains on 12 apps, and one node's Traefik
// logged 18 274 failed ACME attempts in 24 h, 60 % of them for `.internal` hosts.
// An entry may list several hosts separated by commas, so filtering is per host.
// Probe kind inferred from the service/host name (registry cache, oauth2 front, or plain http).
const probeKind = (nameOrHost) =>
  /registr|cache/i.test(nameOrHost) ? "registry"
  : /auth|oauth|keycloak|login/i.test(nameOrHost) ? "oauth2"
  : "http";
const reports = [];
// ── Deklarované držení (2026-10-04) ──────────────────────────────────────────
// Aplikace, kterou overlay instance drží (nasazeni-drzene.json), je zmrazená CELÁ:
// doktor jí domény nepřepisuje (zápis definice by se projevil při příštím
// nasazení, tedy mimo vědomé rozhodnutí), s --restart ji nenasadí a její drift ani
// nepřítomnost v Coolify NEJSOU nález — vypíšou se jako DRŽENO. Deklaraci čte týž
// domov jako každá mutace (lib/coolify-mutace.mjs → lib/nasazeni-drzene.mjs);
// nečitelná deklarace = konec (kód 2) dřív, než se cokoli zapíše.
const MUTACE = { kdo: "coolify-domain-doctor", volej: (cesta, volby) => coolify(cesta, volby), envSoubory: CONFIG_ENV_FILES };
try {
  drzeniProcesu(MUTACE.kdo, { envSoubory: MUTACE.envSoubory });
} catch (e) {
  if (!Array.isArray(e?.chyby)) throw e;
  for (const c of e.chyby) console.error(`${e.titulek}: ${c}`);
  process.exit(2);
}
const drzeniAplikace = (jmeno) => drzenaPolozka({ jmeno, prefix: appPrefix() }, MUTACE);
// EXTERNÍ služba (profil prostředí: external_domain — domov vlastnictví přes domov
// mutace): v tomhle prostředí není naše. Její doména patří vlastníkovi, aplikace v našem
// projektu být nemá — nepřítomnost NENÍ nález a nic se nezapisuje ani nenasazuje.
let profilNezmeren = "";
MUTACE.priNezmereno = (duvod) => { profilNezmeren = duvod; };
let externiAplikace;
try {
  externiAplikace = (jmeno) => externiPolozka({ jmeno, prefix: appPrefix() }, MUTACE);
  externiAplikace(`${appPrefix()}-keycloak`); // načte profil teď: nečitelný = konec dřív, než se cokoli zapíše
} catch (e) {
  console.error(`vlastnictví aplikací: ${e.message}`);
  process.exit(2);
}
if (profilNezmeren) console.error(`::warning title=vlastnictví aplikací::coolify-domain-doctor: ${profilNezmeren} — chybějící aplikace externí služby by se hlásila jako nález`);
// Optional/profile-gated services emit no domain contract when absent. Do not
// turn that legitimate topology into "missing app"; only active routes are
// reconciled and probed.
const vlastniJmena = (contract) => contract.domains.some((entry) => entry.name === EDGE_PROXY_SLUZBA);
// Uvolnění PŘED převzetím. Index vlastníků je snímek z doby před zápisem, takže
// edge zpracovaný dřív než backend, který jméno teprve uvolňuje, by narazil na
// jeho starý router a apply by se zablokoval — konvergovalo by se až druhým
// během. S jmény ve vlastnictví edge proto edge jde až po ostatních a každý
// potvrzený zápis se do indexu promítne (replaceOwner níž).
const activeContracts = (() => {
  const aktivni = expected.filter(selected).filter((contract) => contract.domains.length > 0);
  if (EDGE_VLASTNI.size === 0) return aktivni;
  return [...aktivni.filter((c) => !vlastniJmena(c)), ...aktivni.filter(vlastniJmena)];
})();

for (const contract of activeContracts) {
  const app = appByName.get(contract.app);
  const cizi = externiAplikace(contract.app);
  if (cizi) {
    reports.push({ app: contract.app, ok: true, externi: cizi.hlaska, status: app?.status ?? "v Coolify není", drift: [] });
    continue;
  }
  const drzena = drzeniAplikace(contract.app);
  if (drzena) {
    // Ani čtení driftu, ani zápis: co je drženo, to se nesrovnává — a řekne se to.
    reports.push({ app: contract.app, ok: true, drzeno: hlaskaDrzeno(drzena), status: app?.status ?? "v Coolify není", drift: [] });
    continue;
  }
  if (!app) {
    reports.push({ app: contract.app, ok: false, missingApp: true, drift: contract.domains });
    continue;
  }
  const stored = parseStoredDomains(app.docker_compose_domains);
  // Sentinel entries — an unroutable `.invalid` host standing in for "this service has NO
  // public domain" (e.g. mesh-router when the mesh overlay is off) — must NEVER be sent to
  // Coolify. Coolify indexes every docker_compose_domains value as a REAL, globally-unique
  // domain, and each fork ships the IDENTICAL sentinel string, so they collide across
  // tenants: the API answers `Domain conflicts detected` naming another project's app
  // (observed: tenant-studio-edge claiming mesh-router-disabled.invalid:80) and then drops
  // the ENTIRE payload — every real host along with it. Proved in prod 2026-07-17:
  // aisha-edge's 3-entry payload was rejected wholesale so the app kept ZERO routes
  // (auth.<public> 404 → NetBird could not reach its AUTH_AUTHORITY → Phase D and every
  // downstream wave stalled); the same payload minus the sentinel persisted first try.
  // Filter sentinels out of BOTH the drift verdict and the payload, so one can neither
  // poison the PATCH nor register perpetual drift.
  // Unexpanded `${VAR}` entries are dropped for the same reason as sentinels, but
  // they are a CALLER fault, not a topology state — so they are also surfaced on
  // the report instead of vanishing, and they hold back --apply for this app: a
  // partial payload would delete the routes whose vars did resolve.
  const unresolved = contract.domains.filter((entry) => isUnresolvedDomain(entry.domain) || isNeslozeny(entry));
  // Mesh hosts are stripped before anything is compared or sent: an entry that
  // listed only `.internal` hosts disappears from the contract entirely.
  const meshStripped = contract.domains.filter((entry) => withoutMeshHosts(entry.domain) !== entry.domain);
  // Uvolňovací sentinel (backend přenechal všechna jména edge) se ODESÍLÁ — na
  // rozdíl od sentinelu „služba nemá doménu" je to záměrný zápis: bez něj by
  // v Coolify zůstal starý router a edge by jméno nikdy nezískal. Je jedinečný
  // prefixem instance, takže netrpí kolizí společného sentinelu (viz výš).
  const routable = contract.domains.filter(
    (entry) => (!isSentinelDomain(entry.domain) || isReleaseSentinel(entry.domain)) && !isUnresolvedDomain(entry.domain) && !isNeslozeny(entry) && withoutMeshHosts(entry.domain),
  ).map((entry) => ({ ...entry, domain: withoutMeshHosts(entry.domain) }));
  const expectedNames = new Set(routable.map((entry) => normalizeName(entry.name)));
  const missing = routable.filter((entry) => stored.get(normalizeName(entry.name)) !== entry.domain);
  // An unresolved entry says nothing about what that service SHOULD route, so the
  // value already stored for it is not an extra — reporting it as one would read as
  // "delete this", when the stored value is typically the correct one written by an
  // earlier fully-resolved run. Claim the name so it is left alone either way.
  const unresolvedNames = new Set(unresolved.map((entry) => normalizeName(entry.name)));
  const extras = [...stored.entries()]
    .filter(([name]) => !expectedNames.has(name) && !unresolvedNames.has(name))
    .map(([name, domain]) => ({ name, domain }));
  const drift = [...missing, ...extras];
  // Cross-app conflict: does another live app squat on any host we are contracted to own?
  const contractHosts = domainHosts(routable);
  const fqdnConflicts = findContractConflicts(ownerIndex, contractHosts, app);
  // Cizí držitel hostu — ČTENÍ nad globálním výpisem, který doktor už má (žádné další
  // volání API); jméno projektu se dohledá jen tehdy, když nějaký cizí držitel je.
  const fqdnConflictsForeign = findForeignClaimants(apps, (candidate) => scope.inProject(candidate), contractHosts, app);
  if (fqdnConflictsForeign.length > 0) {
    await pojmenujProstredi(fqdnConflictsForeign.flatMap((c) => c.owners.map((o) => o.environmentId)));
    for (const c of fqdnConflictsForeign) {
      for (const o of c.owners) o.project = projektProstredi.get(o.environmentId) ?? `NEZMĚŘENO (environment_id=${o.environmentId})`;
    }
  }
  // Stale app-level fqdn: a dockercompose app should route via docker_compose_domains, not
  // a Coolify UUID-default fqdn (the working canonical aisha apps have fqdn=null).
  const fqdnDrift = app.build_pack === "dockercompose" && isUuidDefaultFqdn(app.fqdn, app.uuid);
  // NOTE: the docker_compose_domains KEY shape (registry_cache vs registry-cache) is
  // INFO-ONLY — Coolify re-snakes keys on ingest and many healthy aisha services run snake
  // keys, so it must NOT gate the verdict (would churn the working stack). normalizeName
  // already tolerates it in `drift`. The verdict gates on drift + cross-app conflict; the
  // live routing probe (below) is the final arbiter.
  // Host držený i cizím projektem na témž serveru = dva routery na jednom hostu; to není
  // „v pořádku", ani když náš záznam sedí na kontrakt.
  const ok = drift.length === 0 && fqdnConflicts.length === 0 && fqdnConflictsForeign.length === 0 && unresolved.length === 0;
  const report = { app: contract.app, uuid: app.uuid, ok, drift, fqdnConflicts, fqdnConflictsForeign, fqdnDrift, status: app.status };
  if (unresolved.length > 0) report.unresolved = unresolved;
  // Mesh routes already stored in Coolify — the ones an earlier run registered.
  const storedMesh = [...stored.entries()]
    .filter(([, domain]) => String(domain || "").split(",").some((host) => isMeshHost(host)))
    .map(([name, domain]) => ({ name, domain }));
  if (meshStripped.length > 0) report.meshNotRegistered = meshStripped.map((entry) => entry.name);
  if (storedMesh.length > 0) report.storedMeshRoutes = storedMesh;

  if (APPLY && unresolved.length > 0) {
    // Writing now would send only the entries that expanded, and Coolify treats
    // docker_compose_domains as the complete set — so the unexpanded ones would be
    // DELETED from the app's routing rather than left alone. Re-run with that
    // service's env in scope (cold-start sources the resolver output for all of
    // them; a scoped manual run must export the same vars).
    report.applyBlocked = unresolved.some((entry) => entry.neslozeno)
      ? `NEVÍM — domény ${unresolved.filter((entry) => entry.neslozeno).map((entry) => entry.name).join(", ")} nejdou složit z deklarace ` +
        `instance (výpis výše); užší seznam by smazal routy, proto se pro tuhle aplikaci nezapisuje nic`
      : `unresolved \${VAR} in ${unresolved.length} contract domain(s) — re-run with that service's env in scope`;
  } else if (APPLY && fqdnConflicts.length > 0) {
    // Two of THIS PROJECT'S OWN apps collide on one host — a bug we must not paper over by
    // blindly re-binding one of them. Fail loud (project-scoped); the operator decides which
    // app owns it. (A foreign-project squatter is never seen here and never touched.)
    report.applyBlocked = "intra-project fqdn collision — two of this project's apps claim the host; pick the owner first";
  } else if (APPLY && fqdnConflictsForeign.length > 0 && !POVOLIT_VYNUCENI) {
    // Host drží CIZÍ projekt. Běžný PATCH Coolify odmítne („Domain conflicts detected")
    // a vynucený by nechal dvojí vazbu — takže se nepíše nic a končí se nenulou (cold-start
    // to zapíše jako nedokončené). Platí i BEZ driftu: náš záznam sedí na kontrakt, ale
    // tentýž host na témž serveru drží i cizí aplikace, takže dvojí vazba už stojí.
    // Tentýž výsledek jako deploy-init bez ALLOW_DOMAIN_FORCE_OVERRIDE=1.
    const drzitele = fqdnConflictsForeign
      .map((c) => `${c.host} drží ${c.owners.map((o) => `${o.name} (projekt ${o.project}, uuid ${o.uuid})`).join(", ")}`)
      .join("; ");
    report.applyBlocked =
      `FQDN_CONFLICT_FOREIGN — ${drzitele}. NEvynucuji: force_domain_override doménu přebije, ale cizímu ` +
      `vlastníkovi ji neodebere (dva routery na jeden host). Kdo host vlastní, rozhoduje obsluha: ` +
      `uvolni ho v projektu vlastníka, nebo vědomou migraci pusť s ALLOW_DOMAIN_FORCE_OVERRIDE=1`;
  } else if (APPLY && drift.length > 0) {
    // No force_domain_override: only (re)assert OUR canonical shape (docker_compose_domains)
    // once the host is conflict-free. NEVER send an `fqdn` key in this PATCH — the Coolify
    // applications endpoint rejects the fqdn field outright with HTTP 422 (validation:
    // "This field is not allowed"), even when its value is a null. A stale UUID-default fqdn
    // is only a redundant extra router on a *.<tld> host nobody routes through; it does not
    // shadow the canonical docker_compose_domains routers (verified 2026-07-17: every healthy
    // aisha app carries a UUID-default fqdn and still routes correctly via
    // docker_compose_domains). The earlier fqdn-nulling PATCH threw mid-batch and — because
    // the loop had no per-app isolation — stranded every app iterated after it (keycloak
    // included) with ZERO domains, collapsing Phase B OIDC into a routing-404 cascade.
    // fqdnDrift stays in the report as diagnostics but no longer drives a PATCH (it is
    // uncorrectable via this endpoint and harmless).
    try {
      // CRITICAL Coolify v4 quirk (memory: feedback_coolify_api_quirks.md): the PATCH
      // may return 200 while SILENTLY NOT persisting docker_compose_domains — a later
      // GET shows the value absent. A single fire-and-forget PATCH therefore reports
      // success over an app that has NO Traefik routes at all. Proved in prod
      // 2026-07-17: aisha-edge's PATCH returned 200, its docker_compose_domains stayed
      // empty, the doctor announced "domains in sync", and auth.<public> 404'd — which
      // stalled NetBird (its AUTH_AUTHORITY) and every downstream wave behind it.
      // deploy-init's set_coolify_domains has always handled this with retry +
      // post-PATCH verify (+ force_domain_override when a legacy/orphan app still
      // claims the FQDN). The doctor — the recovery pass of last resort — must apply
      // the same proven loop, and FAIL LOUD when the value refuses to stick.
      if (routable.length === 0) {
        // Nothing routable to assert. Never PATCH an empty array — Coolify silently
        // ignores it (feedback_coolify_silent_ignore_empty_domains), so it would be a
        // no-op we'd wrongly report as applied.
        report.ok = false;
        report.applyError = storedMesh.length > 0
          ? "mesh-only app: every contract host is `.internal`, so nothing is sent — its stored mesh routes " +
            "(storedMeshRoutes) stay until they are cleared in Coolify; an empty PATCH would be ignored"
          : "contract has no routable domains (all entries are .invalid sentinels)";
        reports.push(report);
        continue;
      }
      let persisted = false;
      let storedAfter = null;
      for (let attempt = 1; attempt <= 3 && !persisted; attempt += 1) {
        const body = { docker_compose_domains: routable };
        // Vynucení od 2. pokusu JEN s ALLOW_DOMAIN_FORCE_OVERRIDE=1 (viz POVOLIT_VYNUCENI).
        // Dřív tu stálo bezpodmínečné `if (attempt > 1)` s tvrzením „safe — fqdnConflicts
        // is empty"; ta prázdnota ale platila jen pro NÁŠ projekt. Bez vynucení opakování
        // dál řeší tichý zahozený zápis (silent-drop), jen nepřebíjí cizí vazbu.
        if (attempt > 1 && POVOLIT_VYNUCENI) body.force_domain_override = true;
        await coolify(`/applications/${app.uuid}`, { method: "PATCH", body: JSON.stringify(body) });
        // VERIFY: re-read and confirm the value actually stuck. Never trust the 200.
        const fresh = await coolify(`/applications/${app.uuid}`);
        storedAfter = fresh?.docker_compose_domains ?? null;
        const storedNow = parseStoredDomains(storedAfter);
        persisted = routable.every(
          (entry) => storedNow.get(normalizeName(entry.name)) === entry.domain,
        );
      }
      if (!persisted) {
        report.ok = false;
        report.applyError =
          `Coolify returned 200 but did not persist docker_compose_domains after 3 attempts ` +
          `(silent-drop quirk); stored=${JSON.stringify(storedAfter)?.slice(0, 160)}`;
        reports.push(report);
        continue;
      }
      report.applied = true;
      // Potvrzený zápis do indexu vlastníků: aplikace zpracované po téhle už
      // vidí uvolněná jména jako volná (edge po backendu — viz activeContracts).
      replaceOwner(ownerIndex, { ...app, docker_compose_domains: storedAfter });
      if (RESTART) {
        // Nasazení odesílá jediný domov mutace (před voláním se ptá na držení).
        const m = await mutujAplikaci({ akce: "deploy", jmeno: app.name, prefix: appPrefix(), uuid: app.uuid, force: true }, MUTACE);
        const deployment = m.odpoved;
        report.restartTriggered = m.drzeno ? false : deployment?.deployment_uuid || deployment?.deployments?.[0]?.deployment_uuid || true;
        if (m.drzeno) report.drzeno = m.hlaska;
      }
    } catch (err) {
      // Per-app isolation: one app's PATCH failure must never abort the batch and strand the
      // rest (that is exactly how the fqdn-422 incident cascaded). Fail LOUD per app — mark
      // the report not-ok so the residual-drift summary and the live routing probe below both
      // surface it — but keep asserting the remaining apps' domains.
      report.ok = false;
      report.applyError = String(err?.message || err);
    }
  }

  reports.push(report);
}

// PRIMARY ARBITER: live routing probe. DB reconciliation is necessary but NOT sufficient —
// only a live signal proves a host actually routes (2026-07-09: dcd looked fine, host 404'd).
// Scoped to externally-reachable hosts; internal *.backend.<tld> and unresolvable = skip.
const internalTld = env.INTERNAL_TLD;
for (const report of NO_PROBE ? [] : reports) {
  // Držená aplikace se neměří ani sondou: může být vědomě zastavená a „nerouruje“ u ní není nález.
  if (report.missingApp || report.drzeno || report.externi) continue;
  const contract = activeContracts.find((entry) => entry.app === report.app);
  const hosts = scopeProbable(domainHosts(contract?.domains), { internalTld });
  report.probes = [];
  for (const host of hosts) report.probes.push(await probeRoute(host, probeKind(host)));
  const broken = report.probes.filter((probe) => probe.routed === false && !probe.skipped && probe.traefikDefault404);
  if (broken.length) {
    report.ok = false;
    report.routingBroken = broken.map((probe) => probe.host);
  }
}

const hasMissingApp = reports.some((report) => report.missingApp);
const hasDrift = reports.some((report) => !report.ok || report.missingApp);
// ⛔ V --apply se dřív počítal jen chybějící app: zablokované nebo nezapsané domény
// (applyBlocked / applyError) končily kódem 0, takže větev cold-startu „domain-doctor
// --apply nechal zbytkový drift" (krok 4) byla NEDOSAŽITELNÁ. Drift, který apply
// nezapsal, je nedokončený — nenulový kód. Cizí držitel hostu taky: ani vědomé vynucení
// (ALLOW_DOMAIN_FORCE_OVERRIDE=1) cizí vazbu neodebere, takže dokud ji vlastník neuvolní,
// stav není hotový. (Rozbité routování se v apply nepočítá: v kroku 4 aplikace ještě
// nejsou nasazené, takže 404 je očekávaný stav vlny.)
const hasApplyFailure = APPLY && reports.some(
  (report) => report.applyBlocked || report.applyError || (report.fqdnConflictsForeign || []).length > 0,
);
const hasUnresolved = hasMissingApp || (!APPLY && hasDrift) || hasApplyFailure;

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ ok: !hasUnresolved, applied: APPLY, restart: RESTART, reports }, null, 2));
} else {
  console.log(`Coolify domain doctor (${APPLY ? "apply" : "check"}${RESTART ? "+restart" : ""})\n`);
  for (const report of reports) {
    if (report.missingApp) {
      console.log(`FAIL ${report.app}: missing app`);
      continue;
    }
    if (report.externi) {
      console.log(`EXT  ${report.app.padEnd(22)} ${report.externi}. Domény se NESROVNÁVAJÍ ani nezapisují.`);
      continue;
    }
    if (report.drzeno) {
      console.log(`DRŽ  ${report.app.padEnd(22)} ${report.drzeno}. Domény se NESROVNÁVAJÍ ani nezapisují.`);
      continue;
    }
    if (report.ok) {
      console.log(`OK   ${report.app.padEnd(22)} ${report.status}`);
      continue;
    }
    console.log(`${APPLY ? "FIX " : "FAIL"} ${report.app.padEnd(22)} ${report.status}`);
    for (const entry of report.unresolved || []) {
      if (entry.neslozeno) {
        for (const duvod of entry.neslozeno) console.log(`     ${duvod.replace(/^(NEVÍM|NEPLATNÉ): /, `$1 ${entry.name}: `)}`);
        continue;
      }
      console.log(`     UNRESOLVED \${VAR}: ${entry.name} -> ${entry.domain}`);
    }
    if ((report.unresolved || []).some((entry) => entry.neslozeno)) {
      console.log(`     → domény webu skládá jediný domov (scripts/lib/domeny-webu.mjs) a z téhle deklarace je`);
      console.log(`       složit neumí (důvody výše). Pro aplikaci se NEZAPISUJE nic: užší seznam by smazal routy`);
      console.log(`       značek. Chybí-li WEB_FQDNS: \`node scripts/aisha-env-doctor.mjs\` ho odvodí z doménového`);
      console.log(`       overlaye do .env.coolify (prázdný = jedna značka; cold-start i redeploy to dělají samy);`);
      console.log(`       neplatnou deklaraci oprav v overlayi.`);
    }
    if ((report.unresolved || []).some((entry) => !entry.neslozeno)) {
      console.log(`     → that service's env was not in scope, so the contract kept the literal. Nothing was`);
      console.log(`       written for it. Export the missing vars (cold-start does this via the resolver) and re-run.`);
    }
    for (const entry of report.drift) console.log(`     domain drift: ${entry.name} -> ${entry.domain}`);
    if (report.fqdnDrift) console.log(`     stale UUID-default fqdn -> should be null (route via docker_compose_domains)`);
    if (report.storedMeshRoutes) {
      for (const entry of report.storedMeshRoutes) console.log(`     stored mesh route ${entry.name}=${entry.domain} -> must not be a Coolify domain (ACME can never issue .internal)`);
    }
    for (const conflict of report.fqdnConflicts || []) {
      console.log(`     FQDN_CONFLICT ${conflict.host} claimed by ${conflict.claimants.length} apps:`);
      for (const claimant of conflict.claimants) {
        console.log(`        - ${claimant.name} uuid=${claimant.uuid} env=${claimant.envId} repo=${claimant.gitRepo} uuidFqdn=${claimant.fqdnIsUuidDefault} ${claimant.status}`);
      }
    }
    for (const conflict of report.fqdnConflictsForeign || []) {
      console.log(`     FQDN_CONFLICT_FOREIGN ${conflict.host} drží aplikace CIZÍHO projektu (na témž serveru):`);
      for (const owner of conflict.owners) {
        console.log(`        - ${owner.name} projekt=${owner.project} uuid=${owner.uuid} env=${owner.environmentId} server=${owner.serverId} ${owner.status}`);
      }
    }
    for (const host of report.routingBroken || []) {
      console.log(`     ROUTING BROKEN (Traefik no-router default-404): ${host}`);
    }
    if ((report.routingBroken || []).length && report.drift.length === 0 && (report.fqdnConflicts || []).length === 0) {
      console.log(`     → this project's config is canonical; the routing failure is EXTERNAL (another project`);
      console.log(`       squatting the host) or infra. Resolve it in the OWNING project — its own domain-doctor`);
      console.log(`       drops the foreign host as an extra. This tool only READS across the project boundary.`);
    }
    if (report.applyBlocked) console.log(`     APPLY BLOCKED: ${report.applyBlocked}`);
  }
  if (!APPLY && hasDrift) {
    console.log("\nRun with --apply to PATCH docker_compose_domains. Add --restart only when you explicitly want a Coolify deploy trigger.");
  }
}

process.exit(hasUnresolved ? 1 : 0);

#!/usr/bin/env node
/**
 * netbird-dns-provision — populate the NetBird embedded DNS so that the mesh
 * service names consumers ALREADY use (`<svc>.mesh.<tld>`) resolve to the right
 * in-cluster target, instead of falling through to the environment wildcard.
 *
 * WHY (measured 2026-07-22, see memory tenant-jednoucelove-dns-navrh):
 *   - Consumers address `auth.mesh.tenant.internal`, `api.mesh.tenant.internal`, … but
 *     the NetBird resolver serves ONLY peer names, so those names NXDOMAIN and
 *     (with `search bezd.me` + `ndots:0`) resolve to the public edge IP.
 *   - NetBird 0.70 `zones`/`records` hold arbitrary A records for non-peer names
 *     and serve them to plain bridge containers. A per-name zone
 *     (`<svc>.mesh.<tld>`) coexists with peer resolution; the peer-domain apex
 *     (`mesh.<tld>`) itself is reserved and must NOT be claimed.
 *   - A container pointed at the resolver via compose `dns:` still resolves its
 *     Docker aliases locally (Docker forwards only what it can't answer), so NO
 *     consumer URL changes — this tool is purely additive.
 *   - A `primary` nameserver group forwards everything else to the host resolver,
 *     so public names keep working once the resolver becomes a container's DNS.
 *
 * This tool reconciles (idempotent): for every service with an internal mesh URL
 * it ensures a zone + apex A record → the service's live bridge IP, and ensures
 * the public forwarder nameserver group. Zones the tool owns but the topology
 * no longer declares are removed; ownership is the marker in the zone `name`
 * (`tenant-dns-provision:<key>` — NetBird zones have no `description`), and
 * unmarked zones are never deleted, only listed. See lib/netbird-dns-zony.mjs.
 *
 * Target address model (single-host tenant): the bridge IP the service's container
 * alias resolves to on the shared `coolify` network. Cross-host would use the
 * mesh IP; not needed while the instance is single-node.
 *
 * Run ON the host (Docker reachable) or pass --alias-ip-map for a dry run from a
 * workstation. DRY-RUN by default; --apply performs writes.
 *
 * @module
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { nejlepsiPeerPodleJmena } from "./lib/mesh-peers.mjs";
import { meshUserToken, meshAuthFromEnv, tvarKteraObsluhuje } from "./lib/netbird-auth.mjs";
import { fileURLToPath } from "node:url";
import { buildTopology, containerNameFrom, domovVHlavnimMeshi } from "./lib/derive-domains.mjs";
import { overForwarder } from "./lib/dns-forwarder.mjs";
import { ZNACKA, planZon, reconcileZony } from "./lib/netbird-dns-zony.mjs";

const APP_NAME_PREFIX = (process.env.APP_NAME_PREFIX || "").trim();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI ────────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes("--apply");
const argVal = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ALIAS_IP_MAP_FILE = argVal("--alias-ip-map");

// ─── env (.env.coolify wins, then process.env) ───────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  const f = join(ROOT, ".env.coolify");
  if (existsSync(f)) {
    for (const line of readFileSync(f, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in env) || env[k] === "") env[k] = v;
    }
  }
  return env;
}
const env = loadEnv();

const MESH_TLD = env.MESH_TLD || "mesh.tenant.internal";
// ⛔ NENÍ const (naměřeno 2026-09-07): `NETBIRD_API_URL` se skládá z VEŘEJNÉHO
// jména, jenže veřejnou zónu posílá edge na uzel EDGE a netbird bydlí u pki.
// `/api/peers` proto vracelo 404 a tenhle nástroj NEZAPSAL ANI JEDEN z 58
// mesh záznamů. Tvář se volí až při použití, a OVĚŘENÝM dotazem — viz
// tvarKteraObsluhuje() a bránu mesh-api-se-vola-tvari-ktera-obsluhuje.
let NETBIRD_API_URL = (env.NETBIRD_API_URL || "").replace(/\/$/, "");
const KC_REALM = env.KEYCLOAK_REALM || "aisha";
const KC_TOKEN_URL =
  env.KEYCLOAK_TOKEN_URL ||
  (env.PUBLIC_TLD ? `https://auth.${env.PUBLIC_TLD}/realms/${KC_REALM}/protocol/openid-connect/token` : "");
const NETBIRD_MGMT_SECRET = env.NETBIRD_MGMT_SECRET || "";
// Forwarder = resolver SÍTĚ SERVERŮ, deklarace instance (viz lib/dns-forwarder.mjs).
// Ne resolver stroje, odkud se nasazuje, a žádný druhý klíč jako náhrada.
const FORWARDER = overForwarder(env.NETBIRD_DNS_FORWARD_IP);
const HOST_RESOLVER_IP = FORWARDER.ok ? FORWARDER.ip : "";

/**
 * Mesh subdomain → the container ALIAS whose live bridge IP the name should
 * resolve to. Subdomain ≠ alias (auth→keycloak, api→gateway), so this cannot be
 * guessed from the name; each entry is a measured fact. This belongs in
 * config/services.json `internal_url.container` long-term — kept here first so
 * the mapping is reviewable in one place before it is distributed into the SoT.
 * Multiple candidate aliases per subdomain: first that resolves live wins.
 */
const SUBDOMAIN_ALIASES = {
  auth: ["aisha-keycloak", "keycloak"],
  api: ["aisha-gateway", "gateway"],
  gateway: ["llm-gateway"],
  matrix: ["synapse", "aisha-svc-matrix", "svc-matrix"],
  n8n: ["n8n"],
  langfuse: ["langfuse-gateway", "langfuse"],
  nocodb: ["nocodb-auth", "nocodb"],
  web: ["web", "aisha-web"],
  netbird: ["netbird-management"],
  cache: ["registry-cache", "aisha-registry"],
  logs: ["dozzle"],
  companion: ["aisha-openclaw", "openclaw"],
  live: ["svc-livekit"],
  pki: ["pki-auth", "pki-webui", "pki-server"],
};

// ─── alias → live bridge IP ──────────────────────────────────────────────────
function loadAliasIpMap() {
  const map = new Map();
  if (ALIAS_IP_MAP_FILE) {
    // Lines: "<ip>|<alias> <alias> ..." (as emitted by docker inspect one-liner)
    for (const line of readFileSync(ALIAS_IP_MAP_FILE, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || !t.includes("|")) continue;
      const [ip, aliases] = t.split("|");
      for (const a of aliases.trim().split(/\s+/)) if (a) map.set(a, ip.trim());
    }
    return map;
  }
  // Live from Docker on the coolify network (host context).
  const out = execFileSync(
    "docker",
    ["ps", "-q"],
    { encoding: "utf-8" },
  ).trim().split("\n").filter(Boolean);
  for (const id of out) {
    try {
      const proj = execFileSync("docker", ["inspect", id, "--format", '{{index .Config.Labels "coolify.projectName"}}'], { encoding: "utf-8" }).trim();
      if (proj !== (env.APP_NAME_PREFIX || "tenant")) continue;
      // ⛔ DŘÍV SE ČETLA JEN SÍŤ `coolify`. Naměřeno 2026-08-21: služby téhle
      // instance na sdílené síti VŮBEC NEJSOU — žijí na vlastních sítích
      // (`<prefix>-mesh-dns`, `<prefix>-shared-net`) a právě tam nesou i
      // prefixovaný alias (`<fork>-openclaw`, `<fork>-svc-potok`). Pro nástroj byly
      // proto neviditelné a jejich jména zůstala bez záznamu.
      //
      // Čtou se tedy VŠECHNY sítě kontejneru. Filtr podle projektu je o řádek
      // výš a drží identitu; sdílená síť není víc než ostatní.
      const raw = execFileSync("docker", ["inspect", id, "--format",
        '{{range $k,$v := .NetworkSettings.Networks}}{{$v.IPAddress}}|{{range $v.Aliases}}{{.}} {{end}}~{{end}}'],
        { encoding: "utf-8" }).trim();
      for (const usek of raw.split("~")) {
        if (!usek.includes("|")) continue;
        const [ip, aliases] = usek.split("|");
        if (!ip.trim()) continue;
        // První zápis vyhrává: kontejner má na víc sítích víc adres a přepisování
        // by dělalo výsledek závislý na pořadí, které nikdo neřídí.
        for (const a of aliases.trim().split(/\s+/)) if (a && !map.has(a)) map.set(a, ip.trim());
      }
    } catch (e) {
      // A container that vanished mid-inspect is fine to skip, but say which and
      // why — a swallowed error here would hide a name that never gets a record.
      console.warn(`  ! skip container ${String(id).slice(0, 12)}: ${e.message}`);
    }
  }
  return map;
}

// ─── NetBird API ─────────────────────────────────────────────────────────────
// ⛔ ZDE BÝVAL `client_credentials` SERVISNÍHO ÚČTU. NAMĚŘENO 2026-08-21:
// ta cesta nemohla uspět NIKDY. Keycloak servisní účty do výpisu uživatelů
// nedává, takže je mesh management hlásí jako `not found in IDP` a na každý
// dotaz odpovídá 403 `user is pending approval`.
//
// Projevilo se to ale JINDE: bez záznamů v mesh DNS propadla vnitřní jména na
// wildcard vyhledávací domény, tedy na cizí stroj, a čtyři veřejné trasy
// vracely 502 s certifikátem cizí instance. Nikdo to nespojoval s DNS.
//
// Token se teď vydává za SKUTEČNÉHO uživatele přes lib/netbird-auth.mjs —
// jediné místo, kde tahle identita v repu vzniká.
async function netbirdToken() {
  return meshUserToken(meshAuthFromEnv(env));
}
function api(token) {
  return async (method, path, payload) => {
    const r = await fetch(`${NETBIRD_API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
    return json;
  };
}

// ─── plan ────────────────────────────────────────────────────────────────────
/**
 * Peer jméno → mesh IP. Zdroj je NetBird management, tedy tentýž registr, ze
 * kterého peer svou adresu dostal — ne odhad z běžících kontejnerů.
 *
 * Soubor (`--peer-ip-map`, řádky `jméno|ip`) má přednost, aby šlo běžet mimo
 * host; jinak se čte z netbird-db lokálním dockerem, stejně jako alias mapa.
 */
async function loadPeerIpMap() {
  const map = new Map();
  const file = argVal("--peer-ip-map");
  const ingest = (text) => {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || !t.includes("|")) continue;
      const [name, ip] = t.split("|");
      const clean = ip.replace(/["\s]/g, "");
      if (name && clean) map.set(name.trim(), clean);
    }
  };
  if (file) { ingest(readFileSync(file, "utf-8")); return map; }
  try {
    // ⛔ DŘÍV SE ČETLO `docker exec <netbird-db> psql ... select name, ip from peers`.
    // Naměřeno 2026-08-21: ta cesta vrátila jen ČÁST peerů — `backend-potok` ani
    // `experimental-local-ingest` v mapě nebyly, přestože je management API hlásí
    // jako `connected`. Jejich mesh jména proto zůstala bez záznamu a propadla
    // na wildcard, tedy na cizí stroj.
    //
    // Autorita nad tím, kdo je peer, je MANAGEMENT, ne jeho úložiště: čte se
    // stejným kanálem a stejnou identitou jako všechno ostatní. Odpadá tím taky
    // `docker exec` do cizí databáze — nástroj běží kdekoli, kde je API.
    const token = await meshUserToken(meshAuthFromEnv(env));
    const r = await fetch(`${NETBIRD_API_URL}/api/peers`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`GET /api/peers → ${r.status} ${(await r.text()).slice(0, 160)}`);
    const peers = await r.json();
    if (!Array.isArray(peers)) throw new Error("/api/peers nevrátilo pole");
    // ⛔ Po re-enrollmentu drží management víc záznamů téhož jména. `map.set`
    // v pořadí API tu nechával POSLEDNÍ — mesh jméno pak mířilo na odpojeného
    // peera („dial 100.112.246.17:3002: no route to host" byl mrtvý realtime,
    // naměřeno 2026-09-15). Volba má jeden domov: lib/mesh-peers.mjs.
    // Klíčem zůstává `name` jako dosud (tak se páruje s NB_HOSTNAME v compose).
    for (const [jmeno, p] of nejlepsiPeerPodleJmena(peers.map((x) => ({ ...x, hostname: x?.name })))) {
      map.set(jmeno, String(p.ip).trim());
    }
  } catch (e) {
    // NE tiché spolknutí: bez peer mapy se cíl spadne na docker alias, tedy na
    // PLOCHOU síť — a to je přesně stav, který se tímhle skriptem odstraňuje.
    // Musí být vidět, proč se tak stalo.
    console.error(`  ! peer mapa nedostupná (${e.message.split("\n")[0]}) — cíle spadnou na docker alias, tedy na plochou síť`);
  }
  return map;
}

/**
 * Peer IP stacku, ve kterém služba bydlí — cíl mesh jména.
 *
 * PROČ NE DOCKER ALIAS (změřeno 2026-07-29): první verze mapovala mesh jméno na
 * první nalezenou alias IP, což je `coolify` bridge 172.18.x — tedy PLOCHÁ síť.
 * Jméno bylo mesh, cesta plochá, izolace nezískala nic.
 *
 * Mesh je JEDNA síť napříč uzly; adresu na ní má PEER (jedna na stack), ne
 * jednotlivá služba. Cíl je proto peer IP a rozlišuje se PORTEM, který rozvede
 * mesh-ingress běžící v netns agenta.
 *
 * Peer jméno se bere z compose (`NB_HOSTNAME`) té služby — deklarace, ne odhad.
 */
function peerIpByCompose(peerIp) {
  const byCompose = new Map();
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
    const m = readFileSync(resolve(ROOT, f), "utf-8").match(/^\s*NB_HOSTNAME:\s*([^\s#$]+)\s*$/m);
    if (m && peerIp.has(m[1])) byCompose.set(f, { peer: m[1], ip: peerIp.get(m[1]) });
  }
  return byCompose;
}

function buildPlan(aliasIp, peerIp) {
  // buildTopology čte prostředí z `process.env` — zrcadlí se tedy CELÉ načtené
  // nasazovací prostředí, ne vybraných pár klíčů.
  //
  // ⛔ NAMĚŘENO 2026-08-26: stál tu ruční seznam
  //     ["PUBLIC_TLD","MESH_TLD","INTERNAL_TLD","AISHA_PROFILE","APP_NAME_PREFIX"]
  // a tím z topologie TIŠE vypadla každá OPT-IN služba, protože její spínač
  // (`POTOK_ENABLED`, `INGEST_BUNDLE_GIT_URL`, …) se do `process.env` nedostal.
  // Služba pak nemá mesh URL, `buildPlan` ji přeskočí — a zóna nevznikne.
  // Následek: `potok.<doména>` i `ingest.<doména>` vracely 503, ačkoli obě
  // aplikace byly ZDRAVÉ a jejich peery v meshi existovaly. Po doplnění těch
  // dvou proměnných se obě zóny vydaly na první pokus.
  //
  // Univerzum měřidla, které mine část světa, vydá STEJNÝ výstup jako měřidlo,
  // které nic nenašlo — proto se sem nesmí psát seznam.
  //
  // Explicitní `process.env` má přednost: co operátor vyexportoval, přebíjí
  // soubor (týž směr jako všude jinde v řetězu).
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === "") continue;
    if (process.env[k] !== undefined && process.env[k] !== "") continue;
    process.env[k] = v;
  }
  process.env.MESH_ENABLED = "true";
  const topo = buildTopology({});
  const plan = [];
  const unresolved = [];
  for (const [key, svc] of Object.entries(topo.services || {})) {
    const meshUrls = (svc.urls?.internal || []).filter((u) => u.url && u.url.endsWith(MESH_TLD));
    if (!meshUrls.length) continue;
    const sub = meshUrls[0].subdomain;
    // Cíl = PEER IP stacku (mesh), ne docker alias. Alias zůstává jen jako
    // záchrana pro služby, jejichž stack nemá netbird agenta — ty na mesh
    // adresu nedosáhnou a jméno by jinak zůstalo bez záznamu.
    // Domov v hlavním meshi — u modelu na slotu modelového meshe MOST (C4): záznam
    // musí mířit tam, kam vede trasa ingressu (týž zdroj `domovVHlavnimMeshi`), a NIKDY
    // na kontejner CPU modelu, který by mohl na sdílené síti ještě viset (MM8).
    const domov = domovVHlavnimMeshi(topo, key);
    const home = domov.compose ? peerIp.get(domov.compose) : null;
    // Jméno kontejneru se skládá z identity zákazníka — katalog na compose
    // službu jen ukazuje. Bez identity se nesloží a kandidát prostě odpadne;
    // dosadit ji nesmíme, alias bez identity patří komukoli na sdílené síti.
    const declaredName = domov.sluzba
      ? containerNameFrom(domov.compose, domov.sluzba, APP_NAME_PREFIX)
      : null;
    const declared = declaredName ? [declaredName] : [];
    const candidates = [...declared, ...(SUBDOMAIN_ALIASES[sub] || [])];
    let ip = home?.ip ?? null, matched = home ? `peer:${home.peer}` : null;
    if (!ip) for (const c of candidates) { if (aliasIp.has(c)) { ip = aliasIp.get(c); matched = c; break; } }
    const domain = meshUrls[0].url; // <svc>.mesh.<tld>
    if (ip) plan.push({ key, sub, domain, alias: matched, ip });
    else unresolved.push({ key, sub, domain, candidates });

    // DALŠÍ endpointy téže služby (`internal_endpoints`). Bez nich zůstanou
    // jména jako `postgrest.mesh.<tld>` mrtvá: derivace je vydá konzumentům,
    // ale v zóně pro ně není žádný záznam, takže NXDOMAIN.
    //
    // Cíl se bere z DEKLARACE endpointu (`container`), ne z natvrdo psané mapy
    // SUBDOMAIN_ALIASES — ta je udržovaná ručně a nese cizí prefixy.
    // ⛔ NAMĚŘENO 2026-08-25: tady stálo `domain.slice(sub.length + 1)`, což
    // předpokládá, že `domain` ZAČÍNÁ na `sub`. Nezačíná — resolver do jména
    // vkládá identitu instance, kdežto `subdomain` je holé:
    //     domain = "<pfx>-integration.mesh.<tld>"   sub = "integration"
    //     slice(11+1) → "ion.mesh.<tld>"
    // Vznikaly tak adresy `maestro.ion.mesh.<tld>`, `cosmos-rest.ger.…`,
    // `svc-matrix.ing.…` — jména useknutá o délku prefixu. Zapsala by se do
    // zóny a nikdo by je nikdy nezavolal, protože konzumenti používají tvar
    // s identitou. Zóna i identita se proto berou ze SKLADBY jména, ne z délky.
    const teckaZa = domain.indexOf(".");
    const zone = domain.slice(teckaZa + 1);
    const identita = domain.slice(0, Math.max(0, teckaZa - sub.length));
    for (const ep of svc.internal_endpoints || []) {
      if (!ep.subdomain || ep.subdomain === sub) continue;   // primární už výš
      const epDomain = `${identita}${ep.subdomain}.${zone}`;
      const epCands = [ep.container, ...(SUBDOMAIN_ALIASES[ep.subdomain] || [])].filter(Boolean);
      let epIp = home?.ip ?? null, epMatched = home ? `peer:${home.peer}` : null;
      if (!epIp) for (const c of epCands) { if (aliasIp.has(c)) { epIp = aliasIp.get(c); epMatched = c; break; } }
      if (epIp) plan.push({ key, sub: ep.subdomain, domain: epDomain, alias: epMatched, ip: epIp });
      else unresolved.push({ key, sub: ep.subdomain, domain: epDomain, candidates: epCands });
    }
  }
  // Cizí aplikace (EXTERNAL_FACES): mesh jméno → peer stacku `via`,
  // jehož mesh-ingress ji rozvede. BEZ záchrany docker aliasem — cizí kontejner
  // na meshi není, alias by byl přesně ta boční cesta, kterou tvář obchází.
  for (const f of topo.external_faces || []) {
    if (!f.mesh_host) continue;
    const home = peerIp.get(f.via_compose);
    const key = `external_faces.${f.id}`;
    if (home) plan.push({ key, sub: f.subdomain, domain: f.mesh_host, alias: `peer:${home.peer}`, ip: home.ip });
    else unresolved.push({ key, sub: f.subdomain, domain: f.mesh_host, candidates: [`peer of ${f.via_compose}`] });
  }
  return { plan, unresolved };
}

// ─── reconcile ───────────────────────────────────────────────────────────────
// Zóny: značka vlastníka, plán a srovnání bydlí v lib/netbird-dns-zony.mjs
// (proč značka v `name`, ne v `description`, viz tamní hlavička).
const TAG = ZNACKA; // značka u skupiny nameserverů (ta pole `description` MÁ)

async function ensureForwarder(call) {
  if (!FORWARDER.ok) throw new Error(`forwarder: ${FORWARDER.duvod}`);
  const groups = await call("GET", "/api/groups");
  const allGroup = (groups.find((g) => g.name === "All") || groups[0])?.id;
  const nss = await call("GET", "/api/dns/nameservers");
  const mine = nss.find((n) => n.name === "tenant-public-forward");
  const spec = {
    name: "tenant-public-forward",
    description: TAG,
    nameservers: [{ ip: HOST_RESOLVER_IP, ns_type: "udp", port: 53 }],
    enabled: true, groups: [allGroup], primary: true, domains: [], search_domains_enabled: false,
  };
  if (!mine) { await call("POST", "/api/dns/nameservers", spec); console.log(`  + forwarder → ${HOST_RESOLVER_IP}`); }
  else if (mine.nameservers?.[0]?.ip !== HOST_RESOLVER_IP) { await call("PUT", `/api/dns/nameservers/${mine.id}`, spec); console.log(`  ~ forwarder → ${HOST_RESOLVER_IP}`); }
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  // Tvář se ověří DŘÍV, než na API kdokoli sáhne: první dotaz je peer mapa a
  // její selhání se dřív spolklo propadem na docker alias, tedy na plochou síť.
  NETBIRD_API_URL = await tvarKteraObsluhuje(
    NETBIRD_API_URL,
    env.NETBIRD_DOMAIN_DIRECT,
    "/api/peers",
    "NetBird",
    "netbird-dns-provision",
  );
  const aliasIp = loadAliasIpMap();
  const { plan, unresolved } = buildPlan(aliasIp, peerIpByCompose(await loadPeerIpMap()));

  console.log(`\nnetbird-dns-provision — MESH_TLD=${MESH_TLD}  mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  console.log(`PLÁN (${plan.length} jmen):`);
  for (const p of plan) console.log(`  ${p.domain.padEnd(34)} → ${p.ip.padEnd(14)} (${p.alias})`);
  if (unresolved.length) {
    console.log(`\nNEVYŘEŠENO (${unresolved.length}) — žádný kandidát-alias nemá živou IP; nebude zapsáno:`);
    for (const u of unresolved) console.log(`  ${u.domain.padEnd(34)} kandidáti: ${u.candidates.join(", ") || "(žádní)"}`);
  }
  console.log(`\nforwarder → ${FORWARDER.ok ? FORWARDER.ip : `NEPLATNÝ: ${FORWARDER.duvod}`}`);

  if (!APPLY) {
    // Suchý běh ukáže i ZÓNY — hlavně co by --apply SMAZAL. Dřív tu nebylo vidět
    // nic, takže prořezávání (které navíc nefungovalo) se nedalo zkontrolovat.
    try {
      const zony = planZon(await api(await netbirdToken())("GET", "/api/dns/zones"), plan);
      console.log(`\nZÓNY: založit ${zony.zalozit.length}, převzít ${zony.prevzit.length}, SMAZAT ${zony.smazat.length}, cizí mimo plán ${zony.cizi.length}`);
      for (const z of zony.smazat) console.log(`  - ${z.domain}`);
      for (const z of zony.cizi) console.log(`  · ${z.domain} (bez značky — nesmaže se)`);
    } catch (e) {
      console.log(`\nZÓNY: nezměřeno (${String(e.message).split("\n")[0]})`);
    }
    console.log("\n(DRY-RUN — nic nezapsáno; přidej --apply)");
    return;
  }
  // Bez platného forwarderu se NEZAPISUJE nic: zóna s mesh jmény a bez cesty ven
  // by kontejnerům ukázaným na resolver sebrala všechna veřejná jména.
  if (!FORWARDER.ok) {
    console.error(`\n⛔ forwarder: ${FORWARDER.duvod}`);
    process.exit(2);
  }

  // ⛔ PRÁZDNÝ PLÁN NENÍ ÚSPĚCH. Do 2026-08-25 tenhle nástroj v takovém případě
  // vypsal „PLÁN (0 jmen)" a skončil NULOU — cold-start to odhlásil jako
  // hotovou fázi a mesh DNS zůstalo prázdné, aniž by to kdokoli poznal.
  // Táž třída jako „měřidlo, které nic nenašlo, vypadá jako měřidlo, které
  // nic nenašlo protože nic není". Rozdíl mezi „není co zapsat" a „nevidím na
  // svět" musí být slyšet.
  if (plan.length === 0) {
    console.error(
      `\nSTOP: nemám co zapsat (0 jmen v plánu, ${unresolved.length} nevyřešených).\n` +
      `  Nezapisuju prázdno a NEHLÁSÍM úspěch — zóna by zůstala prázdná a vypadalo by to hotově.\n` +
      `  Nejčastější důvod: mesh ještě nemá zapsané peery (agenti bez wt0), takže\n` +
      `  cíle nemají živou IP. Ověř: netbird peery + 'ip -o addr show wt0' v agentech.`,
    );
    process.exit(1);
  }

  const token = await netbirdToken();
  const call = api(token);
  console.log("\nRECONCILE:");
  await reconcileZony(call, plan);
  await ensureForwarder(call);
  console.log("\nhotovo.");
})().catch((e) => { console.error("CHYBA:", e.message); process.exit(1); });

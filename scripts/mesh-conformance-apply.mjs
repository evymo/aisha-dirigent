#!/usr/bin/env node
/**
 * mesh-conformance-apply — převede backend stack na cílový tvar mesh.
 *
 * CÍLOVÝ TVAR (majitel 2026-07-30, potvrzeno 2026-08-21): „dovnitř jen přes
 * edge, vnitřně VŠE v mesh, izolovaně, pojmenované po instanci, pevně řízené."
 * Měří ho `scripts/lib/mesh-conformance.mjs` (jediný vlastník verdiktu) a
 * brána `mesh-inside-edge-outside` s ráčnou. Tenhle skript tu ráčnu POSOUVÁ —
 * ne ručně, ale ze stejných zdrojů, ze kterých se měří.
 *
 * CO STACK POTŘEBUJE, ABY BYL KONFORMNÍ (z `nonMeshStacks()`):
 *   1. službu `netbird-agent` (peer instance v mesh, vlastní netns),
 *   2. službu v JEHO netns (`network_mode: service:netbird-agent`) — mesh-ingress,
 *      který příchozí mesh provoz rozvede podle `<ID>_MESH_INGRESS_ROUTES`
 *      (tabulku vydává derivace z katalogu, ne ruka).
 *
 * JEDEN ZDROJ TVARU. Bloky se NEKOPÍRUJÍ do tohoto souboru — čtou se za běhu
 * z kanonického compose (`docker-compose.coolify-model.yml`, routes-driven
 * varianta, tedy ta, kterou brána `mesh-ingress-one-generator` porovnává se
 * `scripts/gen-mesh-ingress.mjs`). Kdyby tu ležela kopie, rozešla by se; takhle
 * se změna kanonického tvaru propíše do každé další konverze sama.
 *
 * CO SE PARAMETRIZUJE (a nic jiného):
 *   · jméno stacku (z názvu compose souboru — stejná konvence jako existující),
 *   · placement → setup key (`NETBIRD_STACK_KEY_<PLACEMENT>`) a `NB_HOSTNAME`,
 *   · porty (z katalogu: `internal_url.port` + `internal_endpoints[].port`),
 *   · sítě agenta (sítě CÍLOVÝCH služeb v tomtéž compose; `coolify` se vynechá —
 *     sdílená síť není místo pro mesh peera),
 *   · jméno proměnné s tabulkou (`<ID>_MESH_INGRESS_ROUTES`).
 *
 * VÝJIMKY SE DEKLARUJÍ V KATALOGU, NE TADY. `mesh_bootstrap_dependency: true`
 * říká „tahle služba je předpokladem enrollmentu do mesh, takže na mesh stát
 * nesmí" (Keycloak: chicken-and-egg 2026-07-16, majitel 2026-08-19). Skript ji
 * přeskočí a hlásí proč; `nonMeshStacks()` ji ze stejného důvodu nepočítá.
 *
 * CO SKRIPT NEUMÍ A ŘÍKÁ TO NAHLAS: služba bez HTTP portu (clamd 3310) dostane
 * agenta i ingress, ale ingress nemá co rozvádět — příchozí TCP přes mesh
 * potřebuje jiný proxy než Caddy HTTP. Hlásí se jako MEZERA, ne jako hotovo.
 *
 * Read-only bez `--write`. Idempotentní: konformní stack se nedotkne.
 *
 * Usage:
 *   node scripts/mesh-conformance-apply.mjs                 # plán
 *   node scripts/mesh-conformance-apply.mjs --write         # aplikovat
 *   node scripts/mesh-conformance-apply.mjs --only=n8n      # jeden stack
 *   Potom: bash scripts/preflight-compose.sh
 *          node scripts/gen-mesh-conformance-baseline.mjs --write
 *          npm run test:gates
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { meshServices, nonMeshStacks } from "./lib/mesh-conformance.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
/**
 * ⛔ NAMĚŘENO 2026-08-31: model je kanonický JEN V OKAMŽIKU PŘEVODU. Jakmile je
 * stack konformní, jeho kopie ingress bloku ZMRZNE a nic ji už s modelem
 * nesrovnává — změna v `docker-compose.coolify-model.yml` se do 18 stacků
 * nedostane a VŠECHNY brány zůstanou zelené. Zjištěno tak, že do modelu
 * přibylo `trusted_proxies` a `apply` hlásil „k zápisu 0".
 *
 * `--resync` je ta chybějící půlka: u KONFORMNÍCH stacků přerenderuje ingress
 * blok z modelu. Nekopíruje se text z tohoto souboru — bere se táž šablona,
 * kterou používá převod, takže existuje jeden tvar, ne dva.
 */
const RESYNC = argv.includes("--resync");
const ONLY = (argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length);

/** Kanonický zdroj tvaru — routes-driven varianta, kterou porovnává brána. */
const CANON = "docker-compose.coolify-model.yml";
const CANON_STACK = "model";
const CANON_PLACEMENT = "experimental";

const read = (p) => readFileSync(join(ROOT, p), "utf-8");
const catalog = JSON.parse(read("config/services.json"));

// ── pomocníci nad textem compose ─────────────────────────────────────────────

/** Blok služby `  <key>:` až po další službu / top-level klíč (bez nich). */
function serviceBlock(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${key}:`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (/^  [A-Za-z][A-Za-z0-9_-]*:$/.test(l) || /^[A-Za-z]/.test(l)) break;
    end += 1;
  }
  // uříznout koncové prázdné řádky
  while (end > start + 1 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

/** Jména služeb v compose (2 mezery odsazení pod `services:`). */
function serviceKeys(text) {
  const out = [];
  let inServices = false;
  for (const l of text.split("\n")) {
    if (/^services:/.test(l)) { inServices = true; continue; }
    if (/^[A-Za-z]/.test(l)) inServices = false;
    const m = inServices && l.match(/^  ([A-Za-z][A-Za-z0-9_-]*):$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Sítě, ke kterým se služba hlásí (obě formy: `- x` i `x:`). */
function serviceNetworks(text, key) {
  const block = serviceBlock(text, key);
  if (!block) return [];
  const out = [];
  let inNet = false;
  for (const l of block.split("\n")) {
    if (/^    networks:/.test(l)) { inNet = true; continue; }
    if (inNet && /^    [A-Za-z]/.test(l)) inNet = false;
    if (!inNet) continue;
    let m = l.match(/^      - ([A-Za-z][A-Za-z0-9_-]*)$/);
    if (m) { out.push(m[1]); continue; }
    m = l.match(/^      ([A-Za-z][A-Za-z0-9_-]*):/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Klíče pod top-level sekcí (`networks:` / `volumes:`) až po další top-level
 * klíč nebo konec souboru. Parsuje se po řádcích, ne regexem se zpětným
 * pohledem — první verze měla `\Z`, což v JS není konec textu, a sekce
 * `networks:` bývá v souboru POSLEDNÍ, takže vracela prázdno pro každý stack
 * a plán hlásil „agent by neměl kam" u všech šestnácti.
 */
function topLevelKeys(text, section) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `${section}:`);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^[A-Za-z]/.test(l)) break;
    const m = l.match(/^  ([A-Za-z][A-Za-z0-9_-]*):/);
    if (m) out.push(m[1]);
  }
  return out;
}
const declaredNetworks = (text) => topLevelKeys(text, "networks");
const declaredVolumes = (text) => topLevelKeys(text, "volumes");

const stackShort = (compose) =>
  compose === "docker-compose.coolify.yml"
    ? "core"
    : compose.replace(/^docker-compose\.coolify-/, "").replace(/\.ya?ml$/, "");

// ── kanonické šablony (čtené, ne opisované) ──────────────────────────────────

const canonText = read(CANON);
// Kanonickým zdrojem TCP rozvaděče je clamav — první stack, který ho dostal
// (2026-08-22). Bloky se ČTOU, neopisují: kdyby tu ležela kopie, rozešla by se.
const CANON_TCP = "docker-compose.coolify-clamav.yml";
const canonTcpText = read(CANON_TCP);
const TPL = {
  agent: serviceBlock(canonText, "netbird-agent"),
  ingress: serviceBlock(canonText, `${CANON_STACK}-mesh-ingress`),
  pkiInit: serviceBlock(canonText, "pki-init"),
  tcp: serviceBlock(canonTcpText, "clamav-mesh-tcp"),
};
for (const [k, v] of Object.entries(TPL)) {
  if (!v) {
    console.error(`FATAL: kanonický blok '${k}' v ${CANON} nenalezen — není z čeho generovat.`);
    process.exit(2);
  }
}
// Sonda musí umět říct „ne": kanonický tvar se pozná vlastnostmi, ne vírou.
if (!/network_mode:\s*"?service:netbird-agent"?/.test(TPL.ingress) || !/_MESH_INGRESS_ROUTES/.test(TPL.ingress)) {
  console.error(`FATAL: ${CANON} ingress není routes-driven v netns agenta — kanonický zdroj se změnil, zastavuji.`);
  process.exit(2);
}
if (!/network_mode:\s*"?service:netbird-agent"?/.test(TPL.tcp) || !/_MESH_TCP_ROUTES/.test(TPL.tcp)) {
  console.error(`FATAL: ${CANON_TCP} TCP rozvaděč není routes-driven v netns agenta — kanonický zdroj se změnil, zastavuji.`);
  process.exit(2);
}

// ── parametrizace ────────────────────────────────────────────────────────────

function renderAgent({ stack, placement, ports, networks }) {
  let t = TPL.agent;
  t = t.replaceAll(`${CANON_PLACEMENT}--${CANON_STACK}--netbird`, `${placement}--${stack}--netbird`);
  t = t.replaceAll(`netbird-${CANON_STACK}-data-v3`, `netbird-${stack}-data-v3`);
  t = t.replace(/NB_SETUP_KEY: \$\{NETBIRD_STACK_KEY_[A-Z]+\}/, `NB_SETUP_KEY: \${NETBIRD_STACK_KEY_${placement.toUpperCase()}}`);
  t = t.replace(/NB_HOSTNAME: .*/, `NB_HOSTNAME: ${placement}-${stack}`);
  t = t.replace(new RegExp(`— ${CANON_STACK} receives`), `— ${stack} receives`);
  // expose: nahradit celý seznam portů
  t = t.replace(/(\n    expose:\n)(?:      - "\d+"\n?)+/, (_, head) =>
    head + ports.map((p) => `      - "${p}"`).join("\n") + "\n");
  // networks: nahradit seznam
  t = t.replace(/(\n    networks:\n)(?:      - [A-Za-z0-9_-]+\n?)+/, (_, head) =>
    head + networks.map((n) => `      - ${n}`).join("\n") + "\n");
  return t.replace(/\n+$/, "");
}

function renderIngress({ stack, placement, idUpper, healthPort }) {
  let t = TPL.ingress;
  t = t.replace(new RegExp(`^  ${CANON_STACK}-mesh-ingress:`, "m"), `  ${stack}-mesh-ingress:`);
  t = t.replaceAll(`${CANON_PLACEMENT}--${CANON_STACK}--mesh-ingress`, `${placement}--${stack}--mesh-ingress`);
  t = t.replaceAll(`${CANON_STACK.toUpperCase()}_MESH_INGRESS_ROUTES`, `${idUpper}_MESH_INGRESS_ROUTES`);
  t = t.replace(/http:\/\/127\.0\.0\.1:\d+\/__mesh_health/, `http://127.0.0.1:${healthPort}/__mesh_health`);
  // ⛔ A TÝŽ PORT I V DEGRADOVANÉ VĚTVI. Když je tabulka tras prázdná, Caddy
  // schválně poslouchá jen na health a vrací "no-routes" 503 — aby bylo VIDĚT,
  // že tabulka chybí. Bez téhle náhrady zůstane nouzový poslech na portu
  // kanonického vzoru (:8000), zatímco healthcheck výš se ptá jinam → místo
  // navrženého 503 přijde "connection refused". Diagnostika tak mlčí právě
  // ve chvíli, kdy má mluvit.
  //
  // Naměřeno 2026-08-31: neshoda v 15 z 16 stacků. Jediný, kde porty seděly,
  // byl kanonický `model` — jeho vlastní port JE 8000, takže se vzor trefil
  // sám sebou a vada byla ze zdroje neviditelná.
  t = t.replace(/printf ':\d+ \{/, `printf ':${healthPort} {`);
  return t.replace(/\n+$/, "");
}

function renderTcp({ stack, placement, idUpper }) {
  let t = TPL.tcp;
  t = t.replace(/^  clamav-mesh-tcp:/m, `  ${stack}-mesh-tcp:`);
  t = t.replaceAll("backend--clamav--mesh-tcp", `${placement}--${stack}--mesh-tcp`);
  t = t.replaceAll("CLAMAV_MESH_TCP_ROUTES", `${idUpper}_MESH_TCP_ROUTES`);
  return t.replace(/\n+$/, "");
}

function renderPkiInit({ stack, placement, network }) {
  let t = TPL.pkiInit;
  t = t.replaceAll(`${CANON_PLACEMENT}--${CANON_STACK}--pki-init`, `${placement}--${stack}--pki-init`);
  t = t.replace(/(\n    networks:\n)(?:      - [A-Za-z0-9_-]+\n?)+/, (_, head) => head + `      - ${network}\n`);
  return t.replace(/\n+$/, "");
}

// ── plán pro jeden stack ─────────────────────────────────────────────────────

// ⛔ NAMĚŘENO 2026-08-22: tahle funkce brala JEDNU službu, jenže compose bývá
// SDÍLENÝ (cosmos = ledger + svc-blockchain, netinit = 3×). Plány se počítaly
// všechny z téhož textu na disku, takže obě služby naplánovaly ingress a druhá
// o té první nevěděla — do souboru se zapsal DVAKRÁT klíč `<stack>-mesh-ingress`
// a YAML se rozsypal. Chytil to až `preflight-compose`, tedy PŘED nasazením.
//
// Idempotence proto nesmí stát na verdiktu konformity, ale na PŘÍTOMNOSTI KLÍČE:
// verdikt platí pro službu, kdežto blok se zapisuje do souboru.
//
// A protože služby sdílející compose sdílejí i netns a mesh IP, jsou to dvě
// jména JEDNOHO peeru — dostanou tedy jeden agent, jeden ingress a jednu
// směrovací tabulku, pojmenovanou po peeru (derivace ji tak už vydává).
function planFor({ compose, ids }) {
  const svcs = ids.map((i) => catalog.services[i]).filter(Boolean);
  const svc = svcs[0];
  const id = ids.join("+");
  const text = read(compose);
  const stack = stackShort(compose);
  const placement = svc.placement;
  const idUpper = stack.toUpperCase().replace(/-/g, "_");
  const keys = serviceKeys(text);
  const declNets = declaredNetworks(text);
  const declVols = declaredVolumes(text);

  if (svcs.some((s) => s.mesh_bootstrap_dependency === true)) {
    return { id, compose, stack, skip: `mesh_bootstrap_dependency — předpoklad enrollmentu, na mesh nestojí (${svc._comment_mesh ?? "viz katalog"})` };
  }

  // Verdikt „je mimo mesh" má JEDNOHO vlastníka (mesh-conformance.mjs) — včetně
  // výjimek (hostitelský provisioner na docker.sock, předpoklad enrollmentu).
  // Kdyby se tu rozhodovalo podruhé, rozešlo by se to s bránou, a rozdíl by
  // vypadal jako pokrok migrace.
  if (!ids.some((i) => offenders.has(i))) {
    if (!RESYNC) return { id, compose, stack, skip: "konformní, nebo výjimka podle mesh-conformance.mjs" };
    // Konformní stack: ingress existuje, jen se mohl rozejít s modelem.
    const stary = serviceBlock(text, `${stack}-mesh-ingress`);
    if (!stary) return { id, compose, stack, skip: "konformní bez ingressu (mesh-tcp nebo výjimka)" };
    // ⛔ Přesyn smí srovnávat jen stacky, které UŽ JSOU v tomtéž tvaru. Část
    // ingressů je na starší, statické variantě (Caddyfile heredocem, bez
    // tabulky tras) — přerenderovat je z modelu znamená převést je naslepo na
    // routes-driven, a kdyby se tabulka nedoručila, ingress naběhne s 503 a
    // vstup do stacku zmizí. Převod je práce pro převod, ne pro srovnání.
    if (!stary.includes(`${idUpper}_MESH_INGRESS_ROUTES`)) {
      return { id, compose, stack, skip: `STARŠÍ TVAR ingressu (bez ${idUpper}_MESH_INGRESS_ROUTES) — přesyn by ho převedl naslepo, nesahám` };
    }
    const health = Number((stary.match(/http:\/\/127\.0\.0\.1:(\d+)\/__mesh_health/) || [])[1]);
    if (!health) return { id, compose, stack, skip: "ingress bez health portu — NEZMĚŘENO, nesahám" };
    const novy = renderIngress({ stack, placement, idUpper, healthPort: health });
    if (novy === stary) return { id, compose, stack, skip: "shoduje se s modelem" };
    return { id, compose, stack, resync: { stary, novy } };
  }
  const hasAgent = keys.includes("netbird-agent");
  // Klíč, ne verdikt: blok se zapisuje do SOUBORU, takže se ptáme souboru.
  const hasIngressKey = keys.includes(`${stack}-mesh-ingress`);
  const hasConsumer = hasIngressKey || /network_mode:\s*"?service:netbird-agent"?/.test(text);

  // cílové služby = internal_url + internal_endpoints
  const targets = [];
  for (const s of svcs) {
    if (s.internal_url?.service && s.internal_url?.port) targets.push(s.internal_url);
    for (const ep of s.internal_endpoints ?? []) if (ep.service && ep.port) targets.push(ep);
  }
  const missingTargets = targets.filter((t) => !keys.includes(t.service)).map((t) => t.service);
  // TCP cíle — sjednocení přes služby skupiny.
  const tcpTargets = [];
  for (const s of svcs) for (const ep of s.internal_tcp_endpoints ?? []) if (ep.service && ep.port) tcpTargets.push(ep);
  const hasTcpKey = keys.includes(`${stack}-mesh-tcp`);

  // Agent vystavuje porty OBOU druhů: peer musí přijmout i TCP, jinak by
  // rozvaděč poslouchal na portu, který mesh do netns nepustí.
  const ports = [...new Set([...targets, ...tcpTargets].map((t) => Number(t.port)))].sort((a, b) => a - b);

  // sítě agenta: sítě cílů ∩ deklarované, bez sdílené `coolify`
  let nets = [...new Set([...targets, ...tcpTargets].flatMap((t) => serviceNetworks(text, t.service)))]
    .filter((n) => n !== "coolify" && declNets.includes(n));
  if (nets.length === 0) {
    if (declNets.includes("internal")) nets = ["internal"];
    else nets = declNets.filter((n) => n !== "coolify").slice(0, 1);
  }

  const gaps = [];
  // Mezera je JEN tehdy, když stack nemá ČÍM být v mesh — ani HTTP, ani TCP.
  // Do 2026-08-22 se hlásila i u čistě TCP služeb (clamd), protože rozvaděč
  // pro ně neexistoval; teď existuje, takže mlčet o něm by bylo nepravdivé.
  if (targets.length === 0 && tcpTargets.length === 0) gaps.push("katalog nedeklaruje žádný endpoint (internal_url/internal_endpoints/internal_tcp_endpoints) — nebude co rozvádět");
  if (missingTargets.length) gaps.push(`katalog odkazuje na služby, které v compose nejsou: ${missingTargets.join(", ")}`);
  if (nets.length === 0) gaps.push("compose nedeklaruje žádnou nesdílenou síť — agent by neměl kam");

  const healthPort = ports[0] ?? 8080;
  const exposePorts = ports.length ? ports : [8080];
  const needPkiInit = !keys.includes("pki-init");
  const needPkiVol = !declVols.includes("pki-certs");
  // Existující agent už svůj svazek má (třeba pod jiným jménem) — druhý by byl
  // sirotek, který nikdo nepřipojí.
  const needAgentVol = !hasAgent && !declVols.includes(`netbird-${stack}-data-v3`);
  const needVolumesSection = !/^volumes:/m.test(text);

  return {
    id, compose, stack, placement, idUpper, ports, exposePorts, healthPort, nets, gaps,
    addAgent: !hasAgent,
    addIngress: !hasConsumer && targets.length > 0,
    addTcp: !hasTcpKey && tcpTargets.length > 0,
    tcpTargets: [...new Set(tcpTargets.map((t) => `${t.service}:${t.port}`))],
    needPkiInit, needPkiVol, needAgentVol, needVolumesSection,
    targets: [...new Set(targets.map((t) => `${t.service}:${t.port}`))],
  };
}

// ── aplikace plánu ───────────────────────────────────────────────────────────

function apply(plan) {
  let text = read(plan.compose);
  const blocks = [];
  if (plan.needPkiInit) blocks.push(renderPkiInit({ stack: plan.stack, placement: plan.placement, network: plan.nets[0] }));
  if (plan.addAgent) blocks.push(renderAgent({ stack: plan.stack, placement: plan.placement, ports: plan.exposePorts, networks: plan.nets }));
  if (plan.addIngress) blocks.push(renderIngress({ stack: plan.stack, placement: plan.placement, idUpper: plan.idUpper, healthPort: plan.healthPort }));
  if (plan.addTcp) blocks.push(renderTcp({ stack: plan.stack, placement: plan.placement, idUpper: plan.idUpper }));

  // vložit před top-level `volumes:` (nebo `networks:`), s jedním prázdným řádkem
  const anchor = /^volumes:/m.test(text) ? /^volumes:/m : /^networks:/m;
  const idx = text.search(anchor);
  if (idx < 0) throw new Error(`${plan.compose}: nenalezen top-level volumes:/networks: — není kam vložit`);
  const before = text.slice(0, idx).replace(/\n+$/, "\n");
  const after = text.slice(idx);
  text = before + "\n" + blocks.join("\n\n") + "\n\n" + after;

  // volumes
  const volLines = [];
  if (plan.needPkiVol) volLines.push(`  pki-certs:\n    name: \${APP_NAME_PREFIX:?}_${plan.stack}-pki-certs`);
  if (plan.needAgentVol) volLines.push(`  netbird-${plan.stack}-data-v3:\n    name: \${APP_NAME_PREFIX:?}_netbird-${plan.stack}-data`);
  if (volLines.length) {
    if (plan.needVolumesSection) {
      text = text.replace(/^networks:/m, `volumes:\n${volLines.join("\n")}\nnetworks:`);
    } else {
      text = text.replace(/^volumes:\n/m, `volumes:\n${volLines.join("\n")}\n`);
    }
  }
  writeFileSync(join(ROOT, plan.compose), text);
}

/** Přesyn: ingress blok se NAHRADÍ tím, co vydá model. Nic jiného se nedotýká. */
function zapisPresyn(plan) {
  const text = read(plan.compose);
  if (!text.includes(plan.resync.stary)) {
    throw new Error(`${plan.compose}: starý ingress blok se nenašel doslovně — nesahám`);
  }
  // ⛔ Náhrada MUSÍ být FUNKCE. `String.replace` s řetězcovou náhradou vykládá
  // `$$` jako escape pro jeden `$` — a compose má `$$` úplně všude (escape na
  // literální `$` pro shell v kontejneru). Řetězcová varianta tiše srazila
  // `$${VAR}` na `${VAR}`, čímž z BĚHOVÝCH proměnných udělala compose-time
  // dosazení a ingress by se rozbil. `preflight-compose.sh` to nechytí:
  // syntakticky je obojí platné, liší se AŽ VÝZNAM.
  writeFileSync(join(ROOT, plan.compose), text.replace(plan.resync.stary, () => plan.resync.novy));
}

// ── běh ──────────────────────────────────────────────────────────────────────

const universe = meshServices().filter((s) => !ONLY || s.id === ONLY);
const offenders = new Set(nonMeshStacks());
// Seskupení podle COMPOSE, ne podle služby: artefakt je soubor a peer je stack.
const poCompose = new Map();
for (const s of universe) poCompose.set(s.compose, [...(poCompose.get(s.compose) ?? []), s.id]);
const plans = [...poCompose.entries()].map(([compose, ids]) => planFor({ compose, ids }));

console.log(`mesh-conformance-apply — ${WRITE ? "ZÁPIS" : "PLÁN"}  (univerzum: ${universe.length}, nekonformních: ${offenders.size})\n`);
let applied = 0, skipped = 0, gapsTotal = 0;
for (const p of plans) {
  if (p.skip) {
    console.log(`  · ${p.id.padEnd(16)} ${p.skip}`);
    skipped += 1;
    continue;
  }
  if (p.resync) {
    // Ukazuje se ROZDÍL, ne jen „změněno": kdo to čte, musí vidět, co se hne.
    const a = p.resync.stary.split("\n"), b = p.resync.novy.split("\n");
    const pridano = b.filter((l) => !a.includes(l)).length;
    const ubylo = a.filter((l) => !b.includes(l)).length;
    console.log(`  ${WRITE ? "✎" : "→"} ${p.id.padEnd(16)} přesyn ingressu z modelu (+${pridano}/-${ubylo} řádků)`);
    if (WRITE) { zapisPresyn(p); applied += 1; }
    continue;
  }
  const what = [
    p.needPkiInit && "pki-init",
    p.addAgent && `agent(${p.placement}-${p.stack}; expose ${p.exposePorts.join(",")}; sítě ${p.nets.join(",")})`,
    p.addIngress && `ingress(${p.idUpper}_MESH_INGRESS_ROUTES; health :${p.healthPort})`,
    p.addTcp && `tcp(${p.idUpper}_MESH_TCP_ROUTES)`,
    (p.needPkiVol || p.needAgentVol) && `volumes(${[p.needPkiVol && "pki-certs", p.needAgentVol && "netbird-data"].filter(Boolean).join(",")})`,
  ].filter(Boolean).join(" + ");
  console.log(`  ${WRITE ? "✎" : "→"} ${p.id.padEnd(16)} ${what}`);
  if (p.targets.length) console.log(`      cíle: ${p.targets.join(", ")}`);
  if (p.tcpTargets?.length) console.log(`      cíle TCP: ${p.tcpTargets.join(", ")}`);
  for (const g of p.gaps) { console.log(`      ⚠ ${g}`); gapsTotal += 1; }
  if (WRITE) {
    try { apply(p); applied += 1; }
    catch (e) { console.error(`      ✗ ${e.message}`); process.exitCode = 1; }
  }
}
console.log(`\nhotovo: ${WRITE ? `zapsáno ${applied}` : `k zápisu ${plans.filter((p) => !p.skip).length}`}, přeskočeno ${skipped}, mezer ${gapsTotal}`);
if (!WRITE) console.log("(bez --write se nic nezapisuje)");
else console.log("DALŠÍ KROK: bash scripts/preflight-compose.sh && node scripts/gen-mesh-conformance-baseline.mjs --write && npm run test:gates");

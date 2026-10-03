#!/usr/bin/env node
/**
 * network-policy-report.mjs — čtyři nezávislé zdroje téhož vztahu, a jejich rozpory.
 *
 * WHY
 * ---
 * Měřeno 2026-07-29 na živé instanci: 76 kontejnerů sdílí jednu docker síť
 * `coolify`, takže ze `svc-mcp-knowledge` je přímo dosažitelné `aisha-db:5432`,
 * `aisha-postgrest:3000`, `aisha-keycloak:80` i `pki-bridge:3040`. Docker network
 * segmentaci nedělá — je to plochý segment.
 *
 * Mesh tuhle díru NEZAVÍRÁ: přidává šifrovanou cestu MEZI UZLY, ale plochá cesta
 * uvnitř hostu zůstává otevřená vedle něj. Izolace začne platit, teprve když plochá
 * cesta PŘESTANE existovat.
 *
 * ČTYŘI ZDROJE — všechny UŽ EXISTUJÍ, žádné nové pole se nezavádí
 * ---------------------------------------------------------------
 *   A) services.json depends_on     STARTOVACÍ pořadí (co musí běžet dřív)
 *   B) aisha-redeploy.mjs WAVES     STARTOVACÍ pořadí, udržované NEZÁVISLE
 *   C) URL odkazy v compose         GRAF VOLÁNÍ (kdo koho fakticky volá)
 *   D) sdílená docker síť           DOSAH (co síť dnes povolí)
 *
 * A a B popisují TOTÉŽ a jsou udržované ručně zvlášť → jejich rozpor je nález
 * (třída „brána zdědí díry svého vstupního seznamu"). C je jiná relace: startovací
 * DAG MUSÍ být acyklický, kdežto volání cyklus legitimně má — core volá keycloak za
 * běhu a keycloak potřebuje core při startu. Politiku proto NELZE postavit na A;
 * postaví se na C. D je to, co je dnes otevřené navíc.
 *
 * CO TENHLE SKRIPT NEDĚLÁ
 * -----------------------
 * Nic nemění. Je to měřidlo, ne zásah — a schválně vzniklo dřív než zásah, protože
 * odebrat službě síť znamená, že nenaběhne.
 *
 * Použití:
 *   node scripts/network-policy-report.mjs            # tabulka + rozpory
 *   node scripts/network-policy-report.mjs --json     # strojově
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * Jména, na která se dá v docker síti připojit.
 *
 * TŘI zdroje, ne dva — a ten třetí se sem dostal až po ověření nálezu:
 *   container_name       · network aliasy · COMPOSE SERVICE NAME
 *
 * `pki-bridge` vycházel jako služba, kterou nikdo nevolá, přestože
 * `PKI_BRIDGE_URL=http://pki-bridge:3040` čte deset stacků. Jméno totiž není
 * ani container_name (ten je `aisha-pki-bridge`), ani deklarovaný alias (ten je
 * `pki-bridge.backend.${INTERNAL_TLD}`) — je to compose service name. A ten
 * docker přidává jako alias na KAŽDOU připojenou síť; protože `internal` je
 * u 27 z 31 compose `external: true, name: coolify`, je to jméno platné napříč
 * celou instalací, ne jen uvnitř projektu.
 *
 * Důsledek, který z toho plyne a který report hlásí zvlášť: stejné service name
 * ve dvou compose je TÁŽ kolize jako duplicitní alias.
 *
 * Komentáře se přeskakují. Původní regex vyžadoval položky hned za `aliases:`,
 * takže blok s vysvětlením mezi tím celý seznam zahodil — a přesně tak je
 * psaný pki-bridge.
 */
function endpointsOf(composePath) {
  const names = new Set();
  if (!composePath || !existsSync(composePath)) return names;
  const text = readFileSync(composePath, "utf8");
  const lines = text.split("\n");
  for (const m of text.matchAll(/^\s*container_name:\s*([^\s#]+)/gm)) names.add(m[1]);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*aliases:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*#/.test(lines[j]) || /^\s*$/.test(lines[j])) continue; // komentář uvnitř seznamu
      const item = lines[j].match(/^\s*-\s+(.+?)\s*$/);
      if (!item) break;
      const a = item[1].replace(/^["']|["']$/g, "");
      if (/^[A-Za-z0-9._${}:?\s-]+$/.test(a)) names.add(a);
    }
  }
  for (const m of text.matchAll(/aliases:\s*\[([^\]]+)\]/g)) {
    for (const a of m[1].split(",")) names.add(a.trim().replace(/^["']|["']$/g, ""));
  }
  for (const n of localServiceNames(composePath)) names.add(n);
  return names;
}

/**
 * Compose SERVICE NAMES — rozlišitelné JEN uvnitř téhož projektu.
 *
 * Do globální mapy nepatří: `db`, `web`, `pki-init` nebo `netbird-agent` jsou
 * v mnoha compose zároveň, takže by z nich vznikly falešné kolize a falešné
 * hrany (změřeno: 15 kolizí typu `core × pki`, všechny umělé). Odkaz na service
 * name je proto vždy odkaz NA SEBE a do grafu volání se nezapočítává.
 */
function localServiceNames(composePath) {
  const names = new Set();
  if (!composePath || !existsSync(composePath)) return names;
  const text = readFileSync(composePath, "utf8");
  // Řádkově, ne regexem přes celý soubor: `\Z` v JS neexistuje (je to písmeno Z),
  // takže lookahead končil dřív, blok vyšel prázdný a `minio` v core se tvářilo
  // jako neznámé jméno. Měřeno 2026-07-29 — 12 „vadných fallbacků", z nichž
  // většina byla falešná.
  let inServices = false;
  for (const line of text.split("\n")) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-zA-Z]/.test(line)) break;   // další klíč nejvyšší úrovně
    const m = inServices && line.match(/^  ([a-z0-9][a-z0-9._-]*):\s*$/);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Vlny z aisha-redeploy.mjs — druhý, nezávisle udržovaný zdroj pořadí. */
function wavesFromRedeploy() {
  const src = resolve(ROOT, "scripts/aisha-redeploy.mjs");
  if (!existsSync(src)) return null;
  const text = readFileSync(src, "utf8");
  const block = text.match(/const WAVES\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) return null;
  const waves = new Map(); // service id (bez prefixu) → číslo vlny
  let num = null;
  for (const line of block[1].split("\n")) {
    const n = line.match(/num:\s*(\d+)/);
    if (n) num = Number(n[1]);
    const apps = line.match(/apps:\s*\[([^\]]*)\]/);
    if (apps && num !== null) {
      for (const a of apps[1].split(",")) {
        const id = a.trim().replace(/^["']|["']$/g, "").replace(/^aisha-/, "");
        if (id) waves.set(id, num);
      }
    }
  }
  return waves.size ? waves : null;
}

/** Hodnoty pro rozklad ${VAR} v compose. Chybí-li soubor, rozklad prostě neproběhne. */
function loadEnv() {
  const f = resolve(ROOT, process.env.ENV_FILE || ".env.coolify");
  const out = {};
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const ENV = loadEnv();

/**
 * Doménová jména vlastněná službou — mesh (`api.mesh.<tld>`), direct i veřejná.
 *
 * Bez nich graf volání MINE právě ty hopy, které jsou udělané správně: openclaw
 * odkazuje `backend.mesh.riq.internal`, `api.mesh.riq.internal` a `matrix.mesh…`,
 * a report u něj hlásil „volá: nic", protože katalog mapuje jen container:port.
 * Sonda by tak odměňovala holá service names a trestala plné adresy — přesný
 * opak toho, co má měřit.
 */
async function domainOwners() {
  const owners = new Map();
  try {
    const m = await import("./lib/derive-domains.mjs");
    for (const mesh of [true, false]) {
      const topo = m.buildTopology({ meshEnabled: mesh });
      for (const [id, svc] of Object.entries(topo.services ?? {})) {
        for (const scope of ["internal", "direct", "public"]) {
          for (const e of svc.urls?.[scope] ?? []) if (e?.url) owners.set(e.url, id);
        }
      }
    }
  } catch (e) {
    process.stderr.write(`  (domény z derivace nedostupné: ${e.message.split("\n")[0]})\n`);
  }
  return owners;
}

/**
 * Který compose staví kterou složku ve `services/` — a tedy které KATALOGOVÉ
 * službě ten zdrojový kód patří.
 *
 * Vazba už v repu je (`dockerfile: services/<jméno>/Dockerfile`), jen ji nikdo
 * nečetl. Bez ní nelze zdrojový kód přiřadit ke službě a lane E by neměla o čem
 * mluvit.
 */
function sourceDirOwners(catalog) {
  const owner = new Map(); // "storage-auth" → "domain-services"
  for (const [id, svc] of Object.entries(catalog)) {
    const p = svc.compose ? resolve(ROOT, svc.compose) : null;
    if (!p || !existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/dockerfile:\s*services\/([a-z0-9._-]+)\//gi)) {
      if (!owner.has(m[1])) owner.set(m[1], id);
    }
  }
  return owner;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|mjs|js)$/.test(e) && !/\.(test|spec)\./.test(e)) acc.push(full);
  }
  return acc;
}

/**
 * E) graf volání ze ZDROJOVÉHO KÓDU.
 *
 * PROČ (2026-07-29): lane C četla jen `http(s)://` v compose, takže míjela dvě
 * celé třídy hopů — a s nimi i vadu, kvůli které to vzniklo.
 *
 *   1. NE-HTTP volání. `clamav` vycházel jako „nikdo ho nevolá", přestože
 *      `services/storage-auth` na něj streamuje KAŽDÝ upload protokolem
 *      INSTREAM přes TCP 3310 a rozhoduje FAIL-CLOSED. Sonda, která zná jen
 *      `http://`, tvrdila o ochranném prvku, že je nepoužitý.
 *   2. Hopy deklarované v kódu, ne v compose. `process.env.CLAMD_HOST ?? 'clamd'`
 *      je holé jméno bez schématu — regex na URL ho nevidí.
 *
 * Hledají se proto obě formy: adresa se schématem i holý alias v `*_HOST`
 * proměnné. Cíl se překládá týmiž vlastníky jmen jako lane C, takže se lane
 * liší VSTUPEM, ne slovníkem.
 */
function callsFromSource(catalog, ownerOf, byDomain) {
  const dirOwner = sourceDirOwners(catalog);
  const calls = new Map(); // id → Set(id)
  const evidence = new Map(); // "od→do" → ukázka
  for (const [dir, from] of dirOwner) {
    for (const file of walk(resolve(ROOT, "services", dir))) {
      const text = readFileSync(file, "utf8");
      const hits = [
        ...[...text.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)(?::\d+)?/g)].map((m) => m[1]),
        // holý alias v *_HOST proměnné — tudy chodí TCP služby (clamd, redis…)
        ...[...text.matchAll(
          /process\.env\.[A-Z_][A-Z0-9_]*_HOST\s*(?:\?\?|\|\|)\s*["'`]([a-zA-Z0-9._-]+)["'`]/g,
        )].map((m) => m[1]),
      ];
      for (const host of hits) {
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") continue;
        const to = ownerOf.get(host) ?? byDomain.get(host);
        if (!to || to === from) continue;
        if (!calls.has(from)) calls.set(from, new Set());
        calls.get(from).add(to);
        const key = `${from}→${to}`;
        if (!evidence.has(key)) evidence.set(key, `${file.replace(`${ROOT}/`, "")} (${host})`);
      }
    }
  }
  return { calls, evidence };
}

async function main() {
  const catalog = JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8")).services;
  const ids = Object.keys(catalog);
  const byDomain = await domainOwners();

  // vlastník jména → služba (pro překlad URL odkazů na graf volání)
  const exposed = {};
  const ownerOf = new Map();
  const collisions = [];
  for (const [id, svc] of Object.entries(catalog)) {
    exposed[id] = endpointsOf(svc.compose ? resolve(ROOT, svc.compose) : null);
    for (const n of exposed[id]) {
      if (ownerOf.has(n) && ownerOf.get(n) !== id) collisions.push([n, ownerOf.get(n), id]);
      else ownerOf.set(n, id);
    }
  }

  // C) graf volání z URL odkazů v compose
  const calls = {};
  for (const [id, svc] of Object.entries(catalog)) {
    const out = new Set();
    const p = svc.compose ? resolve(ROOT, svc.compose) : null;
    if (p && existsSync(p)) {
      // ${VAR} se rozloží podle .env.coolify. Bez toho sonda vidí jen literály a
      // minula by KAŽDÝ hop, který jsme dnes správně převedli na proměnnou
      // (POSTGREST_URL, KEYCLOAK_INTERNAL_URL, PKI_BRIDGE_URL) — tedy právě ty,
      // které nás zajímají nejvíc.
      let t = readFileSync(p, "utf8");
      t = t.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g, (_, k, d) => ENV[k] || d || "");
      const local = localServiceNames(p);
      for (const m of t.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)(?::\d+)?/g)) {
        if (local.has(m[1])) continue;           // odkaz na sebe uvnitř projektu
        const o = ownerOf.get(m[1]) ?? byDomain.get(m[1]);
        if (o && o !== id) out.add(o);
      }
    }
    calls[id] = out;
  }

  // E) graf volání ze zdrojového kódu — doplní hopy, které compose nezná
  const fromSource = callsFromSource(catalog, ownerOf, byDomain);
  for (const [from, targets] of fromSource.calls) {
    if (!calls[from]) calls[from] = new Set();
    for (const t of targets) calls[from].add(t);
  }

  // ── Kdo NIKOHO nezajímá: služba bez jediného příchozího volání ─────────────
  //
  // Pravidlo majitele: všechno se má volat; když ne, je někde chyba. A není to
  // teoretické — `clamav` sem spadl, přestože je to fail-closed ochrana KAŽDÉHO
  // uploadu. Nález tedy může znamenat trojí a rozlišit to musí člověk:
  //   mrtvá služba · chybějící zapojení · díra v měřidle (jako u clamav)
  //
  // Veřejné služby se nevyjímají, jen se u nich vypíše scope: `edge` volá
  // prohlížeč, ne jiná služba, takže nulový vnitřní příchozí stupeň je u nich
  // očekávaný — ale říct to má report, ne výjimka schovaná v kódu.
  const inbound = new Map(ids.map((id) => [id, new Set()]));
  for (const [from, targets] of Object.entries(calls)) {
    for (const to of targets) inbound.get(to)?.add(from);
  }
  const neverCalled = ids
    .filter((id) => inbound.get(id).size === 0)
    .map((id) => ({ service: id, scope: catalog[id].canonical_scope ?? "internal", public: !!catalog[id].public }));

  const waves = wavesFromRedeploy();

  // ── Rozpor A × B: dvě ručně udržovaná pořadí ───────────────────────────────
  const orderConflicts = [];
  if (waves) {
    for (const [id, svc] of Object.entries(catalog)) {
      const mine = waves.get(id);
      if (mine === undefined) continue;
      for (const dep of svc.depends_on ?? []) {
        const theirs = waves.get(dep);
        if (theirs !== undefined && theirs > mine) {
          orderConflicts.push({ service: id, dep, serviceWave: mine, depWave: theirs });
        }
      }
    }
  }

  // ── Rozpor A × C: volá, ale nedeklaruje závislost ──────────────────────────
  const undeclaredCalls = [];
  for (const id of ids) {
    const dec = new Set(catalog[id].depends_on ?? []);
    const missing = [...calls[id]].filter((x) => !dec.has(x));
    if (missing.length) undeclaredCalls.push({ service: id, missing: missing.sort() });
  }

  // ── Rozdíl C × D: co je otevřené navíc oproti skutečnému volání ────────────
  const rows = ids.map((id) => {
    const callable = calls[id];
    const excess = ids.filter((o) => o !== id && !callable.has(o) && exposed[o].size > 0);
    return {
      service: id,
      calls: [...callable].sort(),
      declared: (catalog[id].depends_on ?? []).slice().sort(),
      wave: waves?.get(id) ?? null,
      exposes: exposed[id].size,
      excessReach: excess.sort(),
    };
  });

  if (JSON_OUT) {
    console.log(JSON.stringify({ collisions, orderConflicts, undeclaredCalls, neverCalled, services: rows }, null, 2));
    return;
  }

  console.log(C.bold("\nSíťová politika — pět nezávislých zdrojů téhož vztahu\n"));
  console.log(C.dim("  A depends_on · B vlny redeploye · C volání z compose · D dosah na síti · E volání ze zdrojáku\n"));

  const w = Math.max(...rows.map((r) => r.service.length));
  for (const r of rows.sort((a, b) => b.excessReach.length - a.excessReach.length)) {
    const n = r.excessReach.length;
    const tag = n === 0 ? C.green("0") : n > 15 ? C.red(String(n)) : C.yellow(String(n));
    console.log(
      `  ${r.service.padEnd(w)}  vlna ${String(r.wave ?? "-").padStart(2)}` +
      `  · A:${String(r.declared.length).padStart(2)}` +
      `  C:${String(r.calls.length).padStart(2)}` +
      `  · navíc dosáhne: ${tag}`,
    );
  }

  const totalExcess = rows.reduce((a, r) => a + r.excessReach.length, 0);
  const totalCalls = rows.reduce((a, r) => a + r.calls.length, 0);
  console.log(
    `\n  ${C.bold("Celkem")}: skutečných volání ${totalCalls}, ` +
    `navíc dosažitelných ${C.red(String(totalExcess))} ` +
    C.dim(`(${(totalExcess / Math.max(totalCalls, 1)).toFixed(1)}× víc, než se používá)`),
  );

  if (orderConflicts.length) {
    console.log(`\n  ${C.red("ROZPOR A × B")} — depends_on říká „dřív", vlny „později":`);
    for (const c of orderConflicts) {
      console.log(`    ${c.service} (vlna ${c.serviceWave}) závisí na ${c.dep} (vlna ${c.depWave})`);
    }
  } else if (waves) {
    console.log(`\n  ${C.green("A × B souhlasí")} — žádná závislost nestartuje po svém závislém.`);
  }

  if (undeclaredCalls.length) {
    console.log(`\n  ${C.yellow("ROZPOR A × C")} — volá, ale nedeklaruje ${C.dim("(u cyklů je to legitimní)")}:`);
    for (const u of undeclaredCalls) console.log(`    ${u.service.padEnd(w)} → ${u.missing.join(", ")}`);
  }

  if (neverCalled.length) {
    // Pravidlo majitele: všechno se má volat. Když ne, je někde chyba — a jsou
    // tři různé, které se odsud nerozliší: mrtvá služba, chybějící zapojení,
    // nebo díra v tomhle měřidle. Poslední možnost není teoretická: `clamav`
    // i `pki` sem spadly a obojí byla vada sondy, ne stacku.
    console.log(`\n  ${C.yellow("Nikdo je nevolá")} — nulový příchozí stupeň v grafu volání:`);
    for (const n of neverCalled) {
      const note = n.scope === "public" || n.public
        ? C.dim("  (veřejná — volá ji klient, ne jiná služba)")
        : C.red("  ← vnitřní, a přesto bez volajícího");
      console.log(`    ${n.service.padEnd(w)}${note}`);
    }
  }

  if (collisions.length) {
    // Jméno vlastní dvě služby. Na sdílené externí síti (`internal` = coolify,
    // 27 z 31 compose) to platí i pro compose SERVICE NAMES, ne jen aliasy —
    // docker je přidává jako alias na každou připojenou síť. DNS pak odpovídá
    // střídavě a volající o tom nemá jak vědět.
    console.log(`\n  ${C.yellow("Kolize jmen")} — jedno jméno, dva vlastníci:`);
    const byName = new Map();
    for (const [name, a, b] of collisions) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(a); byName.get(name).add(b);
    }
    for (const [name, owners] of [...byName].sort()) {
      console.log(`    ${name.padEnd(w)} ${[...owners].sort().join(" × ")}`);
    }
  }

  const noEndpoints = rows.filter((r) => r.exposes === 0).map((r) => r.service);
  if (noEndpoints.length) {
    console.log(`\n  ${C.dim("Bez rozpoznaného endpointu:")} ${noEndpoints.join(", ")}`);
  }
  console.log();
}

await main();

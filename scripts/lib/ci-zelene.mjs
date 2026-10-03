/**
 * Cache zelených stromů pro pre-push — opakované měření nad TÝMŽ vstupem se přeskočí.
 *
 * ⛔ NAMĚŘENO 2026-09-25: tentýž commit pushnutý do forku a do upstreamu = 2× celá
 * offline sada (~40 min pod zátěží, každá drží těžký slot); opakovaný push po pádu
 * sítě nebo flaky timeoutu = zase celá sada. Úlohy o délce 2–7 min čekaly za tím
 * 99–147 min. Opakovat měření nad stejným vstupem nic nového nezjistí — ale JEN
 * když je vstup opravdu stejný. Proto je klíč ÚPLNÝ, ne jen strom:
 *
 *   strom       HEAD^{tree}; ŠPINAVÝ pracovní strom = žádná cache (hook testuje
 *               soubory na disku, ne HEAD — nepoužije se ani nezapíše)
 *   node        process.version + arch (týž node, který pustí sadu)
 *   deps        otisk NAINSTALOVANÝCH závislostí: node_modules/.package-lock.json
 *               v kořeni i ve vnořených balíčcích — lockfile ve stromu nestačí,
 *               node_modules mezi worktree driftuje
 *   dist        otisk sestavených packages/*\/dist (testy je používají)
 *   env soubory otisk .env* v kořeni worktree (odkaz na trezor mění výsledek bran)
 *   proměnné    PROMENNE_SADY — jediný seznam; brána hlídá, že v něm je každý
 *               přepínač sady, který kód testů čte
 *   schopnosti  zda běží to, na čem testy volí spustit/přeskočit (PostgREST, Postgres,
 *               MLX) — levná sonda portu; odlišnost = MISS (konzervativně)
 *
 * Pravidla: zapisuje se JEN celá zelená sada (NEZMĚŘENO ani červená nikdy) a jen když
 * se klíč během běhu nezměnil; úložiště mimo repo (~/.aisha-work/ci-zelene, 0700);
 * platnost 24 h; AISHA_CI_ZNOVU=1 vynutí běh. Serverová CI se tím NEMĚNÍ a zůstává
 * rozhodující — tohle šetří jen lokální stroj.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { porovnej } from "./razeni.mjs";

export const VERZE_KLICE = 1;
export const TTL_MS = 24 * 3600 * 1000;

/**
 * Proměnné, které mění ROZSAH sady (co se měří), ne jen rychlost. Jediný domov —
 * brána ci-zelene-stromy ověřuje, že v něm je každý přepínač přeskočení, který čte
 * stack-smoke, run-vitest, sonda prostředí testů i sám hook.
 * (VITEST_MAX_WORKERS a AISHA_SMOKE_TIMEOUT_MS mění jen rychlost/stropy → nepatří sem.)
 */
export const PROMENNE_SADY = [
  "AISHA_SMOKE_SKIP_WARMUP",
  "AISHA_SMOKE_SKIP_BUILD",
  "AISHA_SMOKE_SKIP_PREFLIGHT",
  "AISHA_SMOKE_SKIP_OFFLINE",
  "AISHA_SMOKE_SKIP_SERVICES",
  "AISHA_SMOKE_SKIP_UNIT",
  "AISHA_SKIP_ONLINE",
  "AISHA_SKIP_DB_TESTS",
  "AISHA_SKIP_AI_TESTS",
  "AISHA_LLM_MOCK",
  // adresy, na které míří sondy schopností testů (src/tests/db/test-env-probe.ts)
  "AISHA_POSTGREST_URL",
  "POSTGREST_URL",
  "AISHA_DB_HOST",
  "PGHOST",
  "AISHA_DB_PORT",
  "PGPORT",
];

/** Adresa PostgRESTu, jak ji vidí sonda testů — TOTÉŽ pořadí a výchozí hodnota jako
 *  src/tests/db/test-env-probe.ts (hlídá brána). Záměrně NE scripts/lib/env.mjs: ten při
 *  importu načte .env-prod-backup do process.env a bez COOLIFY_URL vyhodí výjimku — v pre-push
 *  by shodil čerstvý worktree a změnil právě proměnné, které tahle keš měří. */
export const postgrestUrl = (env) =>
  env.AISHA_POSTGREST_URL || env.POSTGREST_URL ||
  "http://localhost:3000";
export const VYCHOZI_PG_HOST = "127.0.0.1";
export const VYCHOZI_PG_PORT = "54322";

const ENV_SOUBORY = [".env", ".env.local", ".env.test", ".env.coolify", ".env-prod-backup"];

export function vychoziUloziste(env = process.env) {
  return env.AISHA_CI_ZELENE_DIR || join(homedir(), ".aisha-work", "ci-zelene");
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

// ── Měření vstupů (I/O) ─────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** node_modules/.package-lock.json v kořeni a o úroveň níž v balíčkových adresářích. */
function otiskZavislosti(root) {
  const nalez = [];
  const pridej = (rel) => { const p = join(root, rel); if (existsSync(p)) nalez.push([rel, sha(readFileSync(p))]); };
  pridej("node_modules/.package-lock.json");
  for (const kde of ["packages", "services", "extensions", "plugins"]) {
    const d = join(root, kde);
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) pridej(`${kde}/${e.name}/node_modules/.package-lock.json`);
    }
  }
  nalez.sort((a, b) => porovnej(a[0], b[0]));
  return nalez.length ? sha(JSON.stringify(nalez)) : "zadne";
}

/** Obsah všech souborů v packages/*\/dist (relativní cesta + otisk obsahu). */
function otiskDist(root) {
  const nalez = [];
  const chuze = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const a = join(abs, e.name), r = `${rel}/${e.name}`;
      if (e.isDirectory()) chuze(a, r);
      else if (e.isFile()) nalez.push([r, sha(readFileSync(a))]);
    }
  };
  const pk = join(root, "packages");
  if (existsSync(pk)) {
    for (const e of readdirSync(pk, { withFileTypes: true })) {
      const dist = join(pk, e.name, "dist");
      if (e.isDirectory() && existsSync(dist)) chuze(dist, `packages/${e.name}/dist`);
    }
  }
  nalez.sort((a, b) => porovnej(a[0], b[0]));
  return nalez.length ? sha(JSON.stringify(nalez)) : "zadne";
}

function otiskEnvSouboru(root) {
  return ENV_SOUBORY.map((n) => {
    const p = join(root, n);
    try {
      const l = lstatSync(p);
      const cil = l.isSymbolicLink() ? `->${readlinkSync(p)}` : "";
      return [n, `${cil}:${sha(readFileSync(p))}`];
    } catch {
      return [n, "—"];
    }
  });
}

function portOtevreny(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: Number(port) });
    const hotovo = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => hotovo(false));
    s.once("connect", () => hotovo(true));
    s.once("error", () => hotovo(false));
  });
}

/** Stav toho, podle čeho testy volí spustit/přeskočit. Konzervativně: jiný stav = MISS. */
async function schopnosti(root, env) {
  let pgrest = null;
  try {
    const u = new URL(postgrestUrl(env));
    pgrest = { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80") };
  } catch {
    // nečitelná adresa: schopnost „postgrest" = false (klíč se tím liší od běhu s DB), NEsondovat náhradní adresu
  }
  const pgHost = env.AISHA_DB_HOST || env.PGHOST || VYCHOZI_PG_HOST;
  const pgPort = env.AISHA_DB_PORT || env.PGPORT || VYCHOZI_PG_PORT;
  const [postgrest, postgres] = await Promise.all([pgrest ? portOtevreny(pgrest.host, pgrest.port) : false, portOtevreny(pgHost, pgPort)]);
  const mlx = process.arch === "arm64"
    && existsSync(join(root, "scripts/ai/.venv/bin/python3"))
    && existsSync(join(root, "scripts/ai/validate.py"));
  return { postgrest, postgres, mlx };
}

/** Všechny vstupy klíče pro worktree `root`. */
export async function zmerVstupy(root, env = process.env) {
  const spinave = git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  return {
    strom: git(root, ["rev-parse", "HEAD^{tree}"]),
    spinavy: spinave.length > 0,
    node: `${process.version} ${process.arch}`,
    deps: otiskZavislosti(root),
    dist: otiskDist(root),
    envSoubory: otiskEnvSouboru(root),
    promenne: PROMENNE_SADY.map((k) => [k, env[k] ?? null]),
    schopnosti: await schopnosti(root, env),
  };
}

// ── Čisté funkce (testuje brána mutacemi) ───────────────────────────────────

/** Klíč z úplných vstupů; špinavý strom klíč NEMÁ (cache se nepoužije ani nezapíše). */
export function klic(v) {
  if (v.spinavy) return null;
  const casti = {
    verze: VERZE_KLICE,
    strom: v.strom,
    node: v.node,
    deps: v.deps,
    dist: v.dist,
    envSoubory: v.envSoubory,
    promenne: v.promenne,
    schopnosti: v.schopnosti,
  };
  return { hash: sha(JSON.stringify(casti)), casti };
}

const souborZaznamu = (dir, k) => join(dir, `${k.hash}.json`);

/**
 * Hledá zelený záznam pro klíč. HIT jen při shodě VŠEHO a v platnosti.
 * Při MISS se snaží říct PROČ (který díl se u téhož stromu liší).
 */
export function najdi(dir, k, { ted = Date.now(), ttlMs = TTL_MS } = {}) {
  if (!k) return { hit: false, duvod: "pracovní strom není čistý — cache se nepoužije" };
  const f = souborZaznamu(dir, k);
  if (existsSync(f)) {
    let z;
    try { z = JSON.parse(readFileSync(f, "utf8")); } catch { return { hit: false, duvod: "záznam je nečitelný" }; }
    if (JSON.stringify(z.casti) !== JSON.stringify(k.casti)) return { hit: false, duvod: "záznam nesedí s klíčem (kolize?) — běh" };
    if (!(ted - z.zapsano < ttlMs)) return { hit: false, duvod: `záznam je starší než ${Math.round(ttlMs / 3600000)} h` };
    return { hit: true, zaznam: z };
  }
  // Diagnostika: týž strom prošel, ale s jinými vstupy?
  const lisi = new Set();
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith(".json")) continue;
      try {
        const z = JSON.parse(readFileSync(join(dir, n), "utf8"));
        if (z.casti?.strom !== k.casti.strom) continue;
        for (const d of Object.keys(k.casti)) if (JSON.stringify(z.casti[d]) !== JSON.stringify(k.casti[d])) lisi.add(d);
      } catch {
        // cizí/nečitelný soubor v úložišti jen nepřispěje k diagnóze „který díl se liší"
      }
    }
  }
  return { hit: false, duvod: lisi.size ? `strom prošel, ale liší se: ${[...lisi].join(", ")}` : "tento strom tu celou sadou ještě neprošel" };
}

function zajistiUloziste(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Zapíše zelený záznam (atomicky, 0600). Volá se jen po CELÉ zelené sadě. */
export function zapis(dir, k, { ted = Date.now(), meta = {} } = {}) {
  if (!k) return false;
  zajistiUloziste(dir);
  const f = souborZaznamu(dir, k);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ zapsano: ted, casti: k.casti, ...meta }, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
  return true;
}

// Klíč ze STARTU běhu: zapisuje se jen, když se na konci shoduje (nic se během běhu nezměnilo).
const souborBehu = (dir, beh) => join(dir, `beh-${String(beh).replace(/[^0-9A-Za-z_-]/g, "")}.json`);

export function ulozStart(dir, beh, k, ted = Date.now()) {
  if (!k) return;
  zajistiUloziste(dir);
  writeFileSync(souborBehu(dir, beh), JSON.stringify({ zacatek: ted, hash: k.hash }), { mode: 0o600 });
}

/** Režim pre-push, jehož zelený běh smí jít do cache: JEN celá sada. */
export const REZIM_CELA_SADA = "vse";

/**
 * Zapíše konec běhu: jen po CELÉ sadě (`rezim === "vse"`), jen když start existuje
 * a klíč na konci je TENTÝŽ. Pre-push podle cest (#1073) často pouští jen VÝBĚR —
 * zápis výběru by strom prohlásil za zelený celou sadou a push téhož stromu s širším
 * výběrem (jiný remote, jiná báze) by přeskočil části, které nikdy neběžely.
 * Chybějící nebo jiný režim = nezapsáno (fail-closed). HIT ze záznamu celé sady je
 * poctivý pro oba režimy: celá sada ⊇ jakýkoli výběr.
 */
export function zapisKonec(dir, beh, kKonec, { ted = Date.now(), meta = {}, rezim } = {}) {
  const f = souborBehu(dir, beh);
  if (rezim !== REZIM_CELA_SADA) {
    rmSync(f, { force: true });
    return { zapsano: false, duvod: `neběžela celá sada (rezim=${rezim ?? "neuveden"}) — cache drží jen celé sady` };
  }
  if (!existsSync(f)) return { zapsano: false, duvod: "chybí záznam startu běhu" };
  let start;
  try {
    start = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    rmSync(f, { force: true });
    return { zapsano: false, duvod: `záznam startu běhu je nečitelný (${e.message})` };
  }
  rmSync(f, { force: true });
  if (!kKonec) return { zapsano: false, duvod: "pracovní strom je na konci špinavý" };
  if (!start || start.hash !== kKonec.hash) return { zapsano: false, duvod: "vstupy se během běhu změnily" };
  zapis(dir, kKonec, { ted, meta: { ...meta, rezim, trvani_s: Math.round((ted - start.zacatek) / 1000) } });
  return { zapsano: true };
}

// ── Deník (pro měření dopadu — rada d8, 2026-09-25) ─────────────────────────
// Při zásahu cache se slot.sh vůbec nezavolá, takže v deníku fronty by se to
// projevilo jen úbytkem. Každá událost cache proto jde sem jako řádek NDJSON:
// cache-hit (s ušetřenými sekundami = trvání zapsaného běhu), cache-miss (s
// důvodem), cache-zapis, nezapsano, vynuceny-beh. Deník se neuklízí podle TTL.
export const DENIK = "denik.ndjson";
const DENIK_MAX_B = 2 * 1024 * 1024;

export function zapisDenik(dir, udalost, { ted = Date.now() } = {}) {
  zajistiUloziste(dir);
  const f = join(dir, DENIK);
  try {
    if (existsSync(f) && statSync(f).size > DENIK_MAX_B) renameSync(f, join(dir, `denik.1.ndjson`));
  } catch (e) {
    console.warn(`  > Cache zelených stromů: rotace deníku selhala (${e.message}) — zapisuji dál`);
  }
  appendFileSync(f, `${JSON.stringify({ cas: new Date(ted).toISOString(), ...udalost })}\n`, { mode: 0o600 });
}

const jsonNeboNull = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

/** Souhrn deníku: zásahy, ušetřené sekundy, míjení podle důvodu. */
export function souhrnDeniku(dir) {
  const s = { hit: 0, usporaS: 0, miss: 0, zapis: 0, duvody: {} };
  const f = join(dir, DENIK);
  if (!existsSync(f)) return s;
  for (const r of readFileSync(f, "utf8").split("\n")) {
    if (!r.trim()) continue;
    const u = jsonNeboNull(r);
    if (!u) continue; // useknutý řádek (pád uprostřed zápisu) se do souhrnu nepočítá
    if (u.udalost === "cache-hit") { s.hit++; s.usporaS += Number(u.uspora_s) || 0; }
    else if (u.udalost === "cache-miss") { s.miss++; s.duvody[u.duvod] = (s.duvody[u.duvod] ?? 0) + 1; }
    else if (u.udalost === "cache-zapis") s.zapis++;
  }
  return s;
}

/** Úklid: záznamy a starty běhů starší než TTL (deník NE — ten je měření). */
export function uklid(dir, { ted = Date.now(), ttlMs = TTL_MS } = {}) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const nazev of readdirSync(dir)) {
    if (nazev.startsWith("denik")) continue;
    const p = join(dir, nazev);
    try {
      if (ted - statSync(p).mtimeMs > ttlMs) { rmSync(p, { force: true }); n++; }
    } catch {
      // soubor mezitím smazal souběžný úklid jiného běhu
    }
  }
  return n;
}

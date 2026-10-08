#!/usr/bin/env node
/**
 * ci-verdikt.mjs — jak dopadlo CI ke commitu, a když padlo: je vada v KÓDU,
 * nebo na RUNNERU?
 *
 *   node scripts/ci/ci-verdikt.mjs <vlastník/repo> <sha> [--cekej] [--odpojit <soubor>] [--json]
 *
 * ⛔ PROČ (sběr opakovaných ztrát času 2026-10-03, pojistka P2): každá relace si
 * stav CI zjišťovala znovu a jinak — a třemi způsoby se mýlila:
 *   1. KOMBINOVANÝ STATUS COMMITU JE PADĚLATELNÝ: token jobu smí zapsat status
 *      commitu, takže „zelená“ ze statusu není důkaz. Tady se čtou jen běhy a
 *      joby z Actions API (ty zapisuje server, ne job).
 *   2. `/actions/tasks` ukazuje jen převzaté joby a stránkuje (starší běhy
 *      vypadnou; často 504) a `/actions/runs` IGNORUJE `limit` (celý seznam,
 *      desítky MB). Tady se běh hledá filtrem `head_sha` (≈ 20 kB) a joby přes
 *      id běhu.
 *   3. PÁD BEZ SROVNÁNÍ se čte špatně: #1141 job 347567 (2026-10-03) — podpis
 *      `EEXIST + ENOENT rename` byl přečten jako souběh jobů, ve skutečnosti
 *      uklízeč runneru smazal npm cache pod instalací (scripts/ci/npm-ci.sh)
 *      a disk byl pod tlakem (zápis Node do tool cache 3,5 min místo 10 s).
 *      Tady se padlý log porovná s posledním ZELENÝM během téhož jobu na
 *      předcích commitu a se známými podpisy.
 *   4. ZELENÝ JOB ≠ ZELENÉ TESTY: krok s `continue-on-error` (šablona balíčků)
 *      nechá job zelený i se 6 červenými testy (ev-eet, 2026-10-02). Tady se
 *      čtou i logy zelených jobů: souhrn testů a řádek runneru „Failed to
 *      execute step (but continue-on-error is true)“.
 *
 * Verdikt a návratový kód (ve stylu scripts/test/verdikt-kody.mjs — „nevím“
 * není „selhalo“):
 *   0  ZELENÁ    všechny běhy ke commitu doběhly, nic nepadlo, testy zelené
 *   1  KÓD       padl job s podpisem vady kódu, nebo zelený job nese červené testy
 *   2  RUNNER    padlé joby nesou jen podpisy runneru — zopakovat běh, kód neopravovat
 *   75 NEZMĚŘENO běh ještě běží (bez --cekej), nebo pád nejde přiřadit — rozhodne člověk
 *               nad vypsaným srovnáním fází
 *
 * Odpojeně (žádné 30min hlídače v úloze nástroje): `--odpojit <soubor>` spustí
 * tentýž příkaz s `--cekej` jako samostatný proces a vrátí se hned; výsledek
 * končí v souboru řádkem `VERDIKT: …`.
 *
 * Prostředí: FORGEJO_URL (nebo --forgejo), FORGEJO_TOKEN (čtení repa; hodnota
 * se nikdy nevypisuje).
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";

export const KOD = { zelena: 0, kod: 1, runner: 2, nezmereno: 75 };

/** Stavy jobu i běhu ve Forgejo 16. Jiný stav = NEZMĚŘENO, ne odhad. */
const KONECNE = new Set(["success", "failure", "cancelled", "skipped"]);
const BEZICI = new Set(["waiting", "running", "blocked"]);

// ─── log ─────────────────────────────────────────────────────────────────────

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const RAZITKO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;

/** Řádky logu jobu: čas z razítka runneru (ms, nebo null) a text bez barev. */
export function radky(log) {
  return String(log)
    .split("\n")
    .map((r) => {
      const m = RAZITKO.exec(r);
      return { cas: m ? Date.parse(m[1]) : null, text: (m ? r.slice(m[0].length) : r).replace(ANSI, "") };
    });
}

const textLogu = (log) => radky(log).map((r) => r.text).join("\n");

/**
 * Souhrn testů z logu — součet přes všechny souhrnné řádky (job může pouštět
 * víc sad, např. shardy). Zná vitest, jest, node:test (spec i TAP) a mocha.
 * @returns {{ padlo: number, proslo: number } | null} null = žádný souhrn v logu
 */
export function souhrnTestu(log) {
  const t = textLogu(log);
  let padlo = 0;
  let proslo = 0;
  let nasel = false;
  const pridej = (p, o) => {
    nasel = true;
    padlo += p;
    proslo += o;
  };
  const cislo = (s, slovo) => Number(new RegExp(`(\\d+) ${slovo}`).exec(s)?.[1] ?? 0);
  // vitest: „      Tests  6 failed | 126 passed | 6 skipped (138)“
  for (const m of t.matchAll(/^\s*Tests\s{2,}(.+)\(\d+\)\s*$/gm)) pridej(cislo(m[1], "failed"), cislo(m[1], "passed"));
  // jest: „Tests:       1 failed, 5 passed, 6 total“
  for (const m of t.matchAll(/^Tests:\s+(.+) total\s*$/gm)) pridej(cislo(m[1], "failed"), cislo(m[1], "passed"));
  // node:test (spec „ℹ fail 2“, TAP „# fail 2“)
  const nodeFail = [...t.matchAll(/^(?:ℹ|#) fail (\d+)\s*$/gm)];
  const nodePass = [...t.matchAll(/^(?:ℹ|#) pass (\d+)\s*$/gm)];
  if (nodeFail.length) pridej(nodeFail.reduce((s, m) => s + Number(m[1]), 0), nodePass.reduce((s, m) => s + Number(m[1]), 0));
  // mocha: „  12 passing (3s)“ / „  2 failing“
  const mochaPass = [...t.matchAll(/^\s+(\d+) passing\b/gm)];
  if (mochaPass.length) {
    const mochaFail = [...t.matchAll(/^\s+(\d+) failing\s*$/gm)];
    pridej(mochaFail.reduce((s, m) => s + Number(m[1]), 0), mochaPass.reduce((s, m) => s + Number(m[1]), 0));
  }
  return nasel ? { padlo, proslo } : null;
}

/**
 * Pády, které rohatka vědomě nese — JMÉNEM, z jednoho domova. Domov je baseline
 * rohatky (`src/tests/db/test-db.baseline.json`, seznam s důvody; čte ho
 * scripts/test/test-db-rohatka.mjs) a rohatka do logu vypíše, které známé pády
 * v běhu nastaly („známý dluh (baseline), neshazuje:“ + jméno na řádek). Tady se
 * žádné číslo nedrží: odečtou se jen ta jména, a každý „✗ NOVÝ PÁD:“ nebo
 * nenulový kód rohatky je KÓD (podpis níž) — o jeden pád víc = KÓD.
 *
 * ⛔ NAMĚŘENO 2026-10-03: zelený job „DB: runtime testy (rohatka)“ má v logu
 * `Tests  5 failed` a pod ním pět jmen známého dluhu. Bez odečtu by nástroj
 * hlásil KÓD na zeleném mainu.
 */
export function znamePady(log) {
  const r = radky(log).map((x) => x.text);
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    if (!/^\s*známý dluh \(baseline\), neshazuje:\s*$/.test(r[i])) continue;
    for (let j = i + 1; j < r.length && /^ {4,}\S/.test(r[j]); j++) n++;
  }
  return n;
}

/** Červené testy NAD rámec toho, co nese rohatka. */
const noveCervene = (t) => (souhrnTestu(t)?.padlo ?? 0) - znamePady(t);

/**
 * Známé podpisy v logu. Třídy: runner (vada mimo kód — zopakovat), kod, failopen
 * (zelený job s padlým krokem), strop a pamet (samy nerozhodnou — rozhodne
 * srovnání fází), info (jen do výpisu). Každý podpis má odkud: kde je zdokumentovaný.
 */
export const PODPISY = [
  {
    trida: "runner",
    jmeno: "uklízeč runneru smazal sdílenou npm cache pod instalací",
    odkud: "scripts/ci/npm-ci.sh (naměřeno 2026-09-03, 2026-10-03)",
    test: (t) => /npm error code EEXIST/.test(t) && /ENOENT: no such file or directory, rename '[^']*\/_cacache\/tmp\//.test(t),
  },
  { trida: "runner", jmeno: "plný disk runneru", odkud: "ENOSPC", test: (t) => /No space left on device|\bENOSPC\b/.test(t) },
  {
    trida: "runner",
    jmeno: "apt „not signed“ — převlek plného disku",
    odkud: "naměřeno 2026-09-21 (běh 1454)",
    test: (t) => /The repository '[^']+' is not signed/.test(t),
  },
  {
    trida: "runner",
    jmeno: "síť k registru balíčků",
    odkud: "npm",
    test: (t) => /npm error code (ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/.test(t),
  },
  { trida: "strop", jmeno: "job přetekl strop — runner ho ukončil", odkud: "act_runner", test: (t) => /context deadline exceeded/.test(t) },
  { trida: "pamet", jmeno: "došla paměť", odkud: "V8 / jádro", test: (t) => /JavaScript heap out of memory|exitcode '137'/.test(t) },
  { trida: "kod", jmeno: "TypeScript", odkud: "tsc", test: (t) => /error TS\d{4}:/.test(t) },
  {
    trida: "kod",
    jmeno: "ESLint",
    odkud: "eslint",
    test: (t) => [...t.matchAll(/✖ \d+ problems? \((\d+) errors?/g)].some((m) => Number(m[1]) > 0),
  },
  { trida: "kod", jmeno: "červené testy", odkud: "souhrn testů (bez známých pádů rohatky)", test: (t) => noveCervene(t) > 0 },
  {
    trida: "kod",
    jmeno: "rohatka: nový pád",
    odkud: "scripts/test/test-db-rohatka.mjs",
    test: (t) => /✗ NOVÝ PÁD: /.test(t) || /^test-db-rohatka: .*\(kód 1\)/m.test(t),
  },
  {
    trida: "info",
    jmeno: "známé pády pod rohatkou, žádný nový",
    odkud: "scripts/test/test-db-rohatka.mjs",
    test: (t) => znamePady(t) > 0 && noveCervene(t) <= 0,
  },
  {
    trida: "failopen",
    jmeno: "krok padl, job zelený (continue-on-error)",
    odkud: "act_runner",
    test: (t) => /Failed to execute step \(but continue-on-error is true\)/.test(t),
  },
];

export const podpisyLogu = (log) => {
  const t = textLogu(log);
  return PODPISY.filter((p) => p.test(t)).map(({ trida, jmeno, odkud }) => ({ trida, jmeno, odkud }));
};

// ─── srovnání fází ───────────────────────────────────────────────────────────
// Log z API nemá hlavičky kroků (jen obsah s časy runneru). Fáze se proto měří
// mezi KOTVAMI: řádky, které jsou v obou lozích právě jednou (po odstranění
// čísel a otisků), zarovnané monotónně. Úsek mezi dvěma kotvami, který je
// v padlém běhu výrazně delší, ukáže, kde se čas ztratil — bez konfigurace
// pro konkrétní job.

const normalizuj = (t) =>
  t
    .replace(/[0-9a-f]{7,}/gi, "#")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();

/** Jedinečné řádky logu s časem: normalizovaný text → čas (v pořadí logu). */
export function kotvy(log) {
  const pocet = new Map();
  const cas = new Map();
  for (const r of radky(log)) {
    if (r.cas === null) continue;
    const k = normalizuj(r.text);
    if (k.length < 8) continue;
    pocet.set(k, (pocet.get(k) ?? 0) + 1);
    if (!cas.has(k)) cas.set(k, r.cas);
  }
  return new Map([...cas].filter(([k]) => pocet.get(k) === 1));
}

/** Nejdelší rostoucí podposloupnost podle klíče (O(n log n)). */
function rostouci(xs, klic) {
  const konce = [];
  const pred = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = konce.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (klic(xs[konce[mid]]) < klic(xs[i])) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) pred[i] = konce[lo - 1];
    konce[lo] = i;
  }
  const out = [];
  for (let i = konce.length ? konce[konce.length - 1] : -1; i >= 0; i = pred[i]) out.unshift(xs[i]);
  return out;
}

const krajniCas = (log, posledni) => {
  const casy = radky(log).map((r) => r.cas).filter((c) => c !== null);
  return casy.length ? (posledni ? casy[casy.length - 1] : casy[0]) : null;
};

/**
 * @returns {{ zeleny: number, padly: number, useky: Array<{ od: string, do: string, zeleny: number, padly: number, navic: number }> } | null}
 */
export function srovnejFaze(zelenyLog, padlyLog, { prah = 30_000, nejvic = 6 } = {}) {
  const z0 = krajniCas(zelenyLog, false);
  const p0 = krajniCas(padlyLog, false);
  if (z0 === null || p0 === null) return null;
  const kz = kotvy(zelenyLog);
  const spolecne = [...kotvy(padlyLog)].filter(([k]) => kz.has(k)).map(([k, cp]) => ({ k, cp, cz: kz.get(k) }));
  const body = [
    { k: "(začátek jobu)", cz: z0, cp: p0 },
    ...rostouci(spolecne, (x) => x.cz),
    { k: "(konec logu)", cz: krajniCas(zelenyLog, true), cp: krajniCas(padlyLog, true) },
  ];
  const useky = [];
  for (let i = 1; i < body.length; i++) {
    const zeleny = body[i].cz - body[i - 1].cz;
    const padly = body[i].cp - body[i - 1].cp;
    useky.push({ od: body[i - 1].k, do: body[i].k, zeleny, padly, navic: padly - zeleny });
  }
  return {
    zeleny: body[body.length - 1].cz - z0,
    padly: body[body.length - 1].cp - p0,
    useky: useky.filter((u) => u.navic >= prah).sort((a, b) => b.navic - a.navic).slice(0, nejvic),
  };
}

// ─── Forgejo ─────────────────────────────────────────────────────────────────

export class Nezmereno extends Error {}

export function forgejoApi({ forgejo, token, f = fetch }) {
  const zaklad = `${new URL(forgejo).origin}/api/v1`;
  const h = { Authorization: `token ${token}` };
  async function zadost(cesta) {
    const r = await f(zaklad + cesta, { headers: h });
    // Do chyby jen cesta bez dotazu — nikdy hlavička s tokenem.
    if (!r.ok) throw new Nezmereno(`${cesta.split("?")[0]}: HTTP ${r.status}`);
    return r;
  }
  return { json: async (c) => (await zadost(c)).json(), text: async (c) => (await zadost(c)).text() };
}

const commit = (api, repo, sha) => api.json(`/repos/${repo}/git/commits/${sha}?stat=false&verification=false&files=false`);
const behyCommitu = async (api, repo, sha) => (await api.json(`/repos/${repo}/actions/runs?head_sha=${sha}`)).workflow_runs ?? [];

async function jobyBehu(api, repo, id) {
  const d = await api.json(`/repos/${repo}/actions/runs/${id}/jobs`);
  const joby = Array.isArray(d) ? d : d?.jobs;
  if (!Array.isArray(joby)) throw new Nezmereno(`běh ${id}: výpis jobů není seznam`);
  return joby;
}

const logJobu = (api, repo, id) => api.text(`/repos/${repo}/actions/jobs/${id}/logs`);

/** Poslední ZELENÝ job téhož jména a workflow na předcích commitu (první rodič). */
export async function posledniZeleny({ api, repo, sha, workflow, jmeno, hloubka = 25 }) {
  let c = sha;
  for (let i = 0; i < hloubka; i++) {
    const rodic = (await commit(api, repo, c)).parents?.[0]?.sha;
    if (!rodic) return null;
    c = rodic;
    for (const b of (await behyCommitu(api, repo, c)).filter((x) => x.workflow_id === workflow)) {
      const j = (await jobyBehu(api, repo, b.id)).find((x) => x.name === jmeno && x.status === "success");
      if (j) return { beh: b, job: j, sha: c };
    }
  }
  return null;
}

// ─── verdikt ─────────────────────────────────────────────────────────────────

/** Verdikt jednoho jobu z jeho podpisů. Bez podpisu se nehádá. */
export function verdiktJobu(status, podpisy) {
  const t = new Set(podpisy.map((p) => p.trida));
  if (status === "success") return t.has("failopen") || t.has("kod") ? "kod" : "zelena";
  if (t.has("kod")) return "kod";
  if (t.has("runner")) return "runner";
  return "nezmereno";
}

/** Celkový verdikt: kód má přednost (opravit), pak nejistota, pak runner. */
export function celkovyVerdikt(verdikty) {
  if (verdikty.includes("bezi")) return "bezi";
  if (verdikty.includes("kod")) return "kod";
  if (verdikty.includes("nezmereno")) return "nezmereno";
  if (verdikty.includes("runner")) return "runner";
  return "zelena";
}

/**
 * Změří běhy ke commitu. Logy se stahují až po doběhnutí běhu.
 * @returns {Promise<{ sha: string, verdikt: string, duvod?: string, behy: object[] }>}
 */
export async function zmer({ api, repo, sha, testy = true, hloubka = 25 }) {
  const plne = (await commit(api, repo, sha)).sha;
  const behy = await behyCommitu(api, repo, plne);
  if (!behy.length) return { sha: plne, verdikt: "bezi", duvod: "ke commitu zatím není žádný běh", behy: [] };
  const out = [];
  for (const b of behy) {
    const joby = await jobyBehu(api, repo, b.id);
    const nezname = joby.filter((j) => !KONECNE.has(j.status) && !BEZICI.has(j.status));
    if (nezname.length) throw new Nezmereno(`běh ${b.index_in_repo}: neznámý stav jobu ${nezname.map((j) => `„${j.status}“`).join(", ")}`);
    if (!KONECNE.has(b.status)) {
      out.push({ beh: b, verdikt: "bezi", bezi: joby.filter((j) => BEZICI.has(j.status)).length, joby: [] });
      continue;
    }
    const posouzene = [];
    for (const j of joby) {
      if (j.status === "skipped" || BEZICI.has(j.status)) continue;
      if (j.status === "cancelled") {
        posouzene.push({ job: j, verdikt: "nezmereno", podpisy: [], duvod: "zrušeno" });
        continue;
      }
      if (j.status === "success" && !testy) continue;
      const log = await logJobu(api, repo, j.id);
      const podpisy = podpisyLogu(log);
      const v = { job: j, verdikt: verdiktJobu(j.status, podpisy), podpisy, testy: souhrnTestu(log), zname: znamePady(log) };
      if (j.status === "failure") {
        const z = await posledniZeleny({ api, repo, sha: plne, workflow: b.workflow_id, jmeno: j.name, hloubka });
        if (z) v.srovnani = { ...z, faze: srovnejFaze(await logJobu(api, repo, z.job.id), log) };
      }
      if (j.status === "failure" || v.verdikt !== "zelena") posouzene.push(v);
    }
    out.push({ beh: b, verdikt: celkovyVerdikt(posouzene.map((p) => p.verdikt)), joby: posouzene });
  }
  return { sha: plne, verdikt: celkovyVerdikt(out.map((b) => b.verdikt)), behy: out };
}

// ─── výpis ───────────────────────────────────────────────────────────────────

export const trvani = (ms) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${ms < 0 ? "-" : ""}${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

const ZAVER = {
  zelena: "ZELENÁ — všechny běhy doběhly, nic nepadlo, testy zelené",
  kod: "KÓD — opravit; padlý job nese podpis vady kódu, nebo zelený job nese červené testy",
  runner: "RUNNER — padlé joby nesou jen podpisy runneru; zopakovat běh (rerun přes UI), kód neopravovat",
  nezmereno: "NEZMĚŘENO — pád nejde přiřadit podpisem; rozhodni nad srovnáním fází výš",
  bezi: "BĚŽÍ — běh ještě nedoběhl (počkej, nebo --cekej / --odpojit)",
};

export function vypis(repo, v) {
  const r = [];
  if (!v.behy.length) r.push(`ci-verdikt ${repo} @${v.sha.slice(0, 9)}: ${v.duvod}`);
  for (const b of v.behy) {
    const ref = b.beh.prettyref ? `, ${b.beh.prettyref}` : "";
    r.push(`ci-verdikt ${repo} @${v.sha.slice(0, 9)} — běh #${b.beh.index_in_repo} (${b.beh.workflow_id}, ${b.beh.event}${ref}): ${b.beh.status}`);
    if (b.verdikt === "bezi") r.push(`  … běží ještě ${b.bezi} job(ů)`);
    for (const p of b.joby) {
      const znak = p.job.status === "success" ? "⚠" : "✗";
      const pod = p.podpisy.length ? p.podpisy.map((x) => `${x.jmeno} [${x.trida}]`).join("; ") : (p.duvod ?? "bez známého podpisu");
      r.push(`  ${znak} ${p.job.name} (job ${p.job.id}, ${p.job.status}) — ${p.verdikt.toUpperCase()}: ${pod}`);
      if (p.testy) r.push(`     testy v logu: ${p.testy.padlo} padlo${p.zname ? ` (z toho ${p.zname} známých pod rohatkou)` : ""}, ${p.testy.proslo} prošlo`);
      if (p.job.status === "failure" && !p.srovnani) r.push("     srovnání: na předcích commitu není zelený běh téhož jobu");
      if (p.srovnani?.faze) {
        const f = p.srovnani.faze;
        r.push(`     fáze proti poslednímu zelenému (#${p.srovnani.beh.index_in_repo} @${p.srovnani.sha.slice(0, 9)}, job ${p.srovnani.job.id}): ${trvani(f.zeleny)} → ${trvani(f.padly)}`);
        for (const u of f.useky) r.push(`       +${trvani(u.navic)}  „${u.od.slice(0, 60)}“ → „${u.do.slice(0, 60)}“ (${trvani(u.zeleny)} → ${trvani(u.padly)})`);
        if (!f.useky.length) r.push("       žádný úsek není o 30 s delší než v zeleném běhu");
      }
    }
  }
  r.push(`VERDIKT: ${ZAVER[v.verdikt]}`);
  return r.join("\n");
}

const kodVerdiktu = (v) => (v === "zelena" ? KOD.zelena : v === "kod" ? KOD.kod : v === "runner" ? KOD.runner : KOD.nezmereno);

// ─── příkazová řádka ─────────────────────────────────────────────────────────

const PREPINACE = new Set(["cekej", "json", "bez-testu"]);
function argumenty(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith("--")) a._.push(x);
    else if (PREPINACE.has(x.slice(2))) a[x.slice(2)] = true;
    else a[x.slice(2)] = argv[++i];
  }
  return a;
}

const spiVychozi = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {Promise<number>} návratový kód */
export async function hlavni(argv, { env = process.env, f = fetch, spi = spiVychozi, pis = (s) => console.log(s), ted = Date.now } = {}) {
  const a = argumenty(argv);
  const [repo, sha] = a._;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    pis("VERDIKT: NEZMĚŘENO — použití: ci-verdikt.mjs <vlastník/repo> <sha> [--cekej] [--odpojit <soubor>] [--json]");
    return KOD.nezmereno;
  }
  const forgejo = a.forgejo || env.FORGEJO_URL;
  const token = env.FORGEJO_TOKEN;
  if (!forgejo || !token) {
    pis("VERDIKT: NEZMĚŘENO — chybí FORGEJO_URL (nebo --forgejo) nebo FORGEJO_TOKEN");
    return KOD.nezmereno;
  }

  if (a.odpojit) {
    // Samostatný proces: přežije konec úlohy nástroje, výsledek čeká v souboru.
    const fd = openSync(a.odpojit, "a");
    const bez = argv.filter((x, i) => x !== "--odpojit" && argv[i - 1] !== "--odpojit");
    const dite = spawn(process.execPath, [fileURLToPath(import.meta.url), ...bez, ...(a.cekej ? [] : ["--cekej"])], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
    });
    dite.unref();
    pis(`ci-verdikt: odpojeno (pid ${dite.pid}) → ${a.odpojit}; konec poznáš podle řádku „VERDIKT:“`);
    return KOD.zelena;
  }

  const api = forgejoApi({ forgejo, token, f });
  const konec = ted() + Number(a.nejdele ?? 180) * 60_000;
  const interval = Number(a.interval ?? 30) * 1000;
  let posledniStav = "";
  for (;;) {
    let v;
    try {
      v = await zmer({ api, repo, sha, testy: !a["bez-testu"], hloubka: Number(a.hloubka ?? 25) });
    } catch (e) {
      if (!(e instanceof Nezmereno)) throw e;
      pis(`VERDIKT: NEZMĚŘENO — ${e.message}`);
      return KOD.nezmereno;
    }
    if (v.verdikt !== "bezi" || !a.cekej) {
      pis(a.json ? JSON.stringify(v, null, 2) : vypis(repo, v));
      return kodVerdiktu(v.verdikt);
    }
    const stav = v.behy.map((b) => `#${b.beh.index_in_repo}:${b.verdikt === "bezi" ? `běží ${b.bezi}` : b.verdikt}`).join(" ") || v.duvod;
    if (stav !== posledniStav) pis(`${new Date(ted()).toISOString()} … ${stav}`);
    posledniStav = stav;
    if (ted() > konec) {
      pis(`VERDIKT: NEZMĚŘENO — běh nedoběhl do ${a.nejdele ?? 180} min`);
      return KOD.nezmereno;
    }
    await spi(interval);
  }
}

if (isDirectRun(import.meta.url)) {
  hlavni(process.argv.slice(2)).then(
    (kod) => process.exit(kod),
    (e) => {
      console.error(`VERDIKT: NEZMĚŘENO — ${e.message}`);
      process.exit(KOD.nezmereno);
    },
  );
}

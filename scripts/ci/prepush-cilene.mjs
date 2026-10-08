#!/usr/bin/env node
// =============================================================================
// prepush-cilene.mjs — cílená dráha pre-pushe: dotčené brány + testy dotčených částí
// =============================================================================
// ⭐ ROZHODNUTÍ MAJITELE 2026-10-05: „plné sady jen v CI". Celá sada bran, unit,
// services i build běží na runneru; místně jen cílené testy změněných částí a slučuje
// se podle závěrů jobů v CI (`npm run ci:verdikt`). Důvod: stroj s 11+ relacemi se
// dusil (swap 9,5/11 GB, load 250+) a pre-push integrační dávky spadl na 37 timeoutech
// zátěže — a blokoval produkční opravu.
//
// Volání (z .husky/pre-push):
//   bash scripts/ci/prepush-vyber.sh <remote> < refs | node scripts/ci/prepush-cilene.mjs [--plan]
//   stdin  = plán ze scripts/ci/prepush-vyber.sh (key=value; `cesta=` = změněné cesty)
//   --plan = nic nespouští: plán jako JSON na stdout, lidský souhrn na stderr (měří ho brána
//            prepush-vyber-je-cileny nad dočasným gitem)
//
// CO SE PUSTÍ
//   vyber  → brány z výběru (scripts/test/brany-dotcene.mjs: kategorie lanes.json, změněná
//            brána, odkaz na cestu, přímý import, třídní brány trida-repo vždy) · sady dotčených pracovních prostorů
//            (services/packages/plugins/extensions, týž predikát jako celá test:services) ·
//            unit a script testy, které změněné moduly PŘÍMO importují (nebo se samy změnily)
//   sirsi  → totéž, jen místo výběru bran CELÁ LEHKÁ DRÁHA + vybrané těžké brány.
//            Kdy: plán sám říká sirsi (báze neznámá, rozpor směrování, …), mapa bran zná
//            změněnou cestu jen zčásti, výběr bran nebo objevení sad SPADLO.
//   Nikdy „nic" a nikdy tichý přeskok: co se nepustí, se VYPÍŠE i s úlohou CI, která to změří.
//
// Kódy: 0 zelené · 1 padlé · 75 NEZMĚŘENO (scripts/test/verdikt-kody.mjs) · 2 vadné volání
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";

const TENTO = fileURLToPath(import.meta.url);
const KOD_NEZMERENO = 75;

// Strop vybraných unit testů na JEDEN běh. Deklarovaná hodnota tohoto skriptu (ne odhad
// světa), prostředí ji smí přepsat. Změna modulu, který přímo importuje víc testů, se
// místně nespouští — je to téměř celá sada a ta patří do CI; výpis to řekne.
const STROP_TESTU_VYCHOZI = 60;

// Vesmír testů = co sbírají vitest konfigurace (vitest.config.ts, vitest.scripts.config.mjs).
// Runner navíc filtruje svým `include`, takže vybraný soubor mimo něj by se jen nespustil.
const VESMIRY = [
  {
    jmeno: "web",
    popis: "unit testy webu (test:run)",
    config: null,
    patri: (f) => /^src\/.*\.(test|spec)\.tsx?$/.test(f) && !/\.gate\.test\.ts$/.test(f) && !f.startsWith("src/tests/omni-acceptance/"),
    ci: (pr) => (pr.app === "false" ? "Web: Tests se pro tuhle změnu v CI NESPOUŠTÍ (app=false — změna se webu netýká)" : "dokryje CI: Web: Tests"),
  },
  {
    jmeno: "skripty",
    popis: "testy skriptů (test:scripts)",
    config: "vitest.scripts.config.mjs",
    patri: (f) => /^scripts\/.*\.test\.mjs$/.test(f),
    ci: () => "dokryje CI: Web: Brány (krok Scripts tests)",
  },
];

const PRACOVNI_PROSTOR = /^((?:services|packages|plugins|extensions)\/[^/]+)\//;

/** Plán ze stdinu (výstup prepush-vyber.sh). Cizí klíče se ignorují, nic se nevyhodnocuje. */
export function prectiPlan(text) {
  const p = { rezim: null, duvody: [], zmeneno: 0, slouceni: 0, baze: [], priznaky: {}, cesty: [] };
  for (const radek of String(text).split("\n")) {
    const i = radek.indexOf("=");
    if (i <= 0) continue;
    const k = radek.slice(0, i);
    const v = radek.slice(i + 1);
    if (k === "rezim") p.rezim = v;
    else if (k === "duvod") p.duvody.push(v);
    else if (k === "zmeneno") p.zmeneno = Number(v) || 0;
    else if (k === "slouceni") p.slouceni = Number(v) || 0;
    else if (k === "baze") p.baze.push(v);
    else if (k === "cesta") { if (v) p.cesty.push(v); }
    else if (/^[a-z0-9_]+$/.test(k) && (v === "true" || v === "false")) p.priznaky[k] = v;
  }
  return p;
}

function ctiNeboNull(cesta) {
  try {
    return readFileSync(cesta, "utf-8");
  } catch {
    return null;
  }
}

function gitSoubory(koren) {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", "ls-files"], { cwd: koren, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/** Testy z vesmíru, které se samy změnily nebo změněný modul přímo importují. */
function vyberTestu(vesmir, cesty, koren, { primeImporty, idModulu, aliasy, sledovane, strop }) {
  const existuje = (f) => existsSync(path.join(koren, f));
  const kandidati = new Set([...(sledovane ?? []), ...cesty].filter((f) => vesmir.patri(f) && existuje(f)));
  const zmenene = new Set(cesty.filter((f) => vesmir.patri(f) && existuje(f)));
  const moduly = new Set(cesty.filter((f) => /\.(?:[cm]?[jt]sx?)$/.test(f) && !vesmir.patri(f)).map(idModulu));
  const vybrane = new Set(zmenene);
  if (moduly.size > 0) {
    for (const t of kandidati) {
      if (vybrane.has(t)) continue;
      const text = ctiNeboNull(path.join(koren, t));
      if (text == null) continue; // sledovaný, ale na disku smazaný test: není co spustit
      for (const m of primeImporty(t, text, aliasy)) if (moduly.has(m)) { vybrane.add(t); break; }
    }
  }
  const soubory = [...vybrane].sort();
  if (soubory.length > strop) {
    return { soubory: [], vybranoBySe: soubory.length, celkem: kandidati.size, duvod: `${soubory.length} souborů > strop ${strop} (AISHA_PREPUSH_STROP_TESTU) — to je skoro celá sada` };
  }
  return { soubory, celkem: kandidati.size };
}

/** Plán, když výběr sám spadl: širší dráha bez cílených testů — a nahlas proč. */
export function nouzovyPlan(duvod, p = prectiPlan("")) {
  return {
    rezim: "sirsi",
    duvody: [...p.duvody, duvod],
    zmeneno: p.zmeneno, slouceni: p.slouceni, baze: p.baze, priznaky: p.priznaky,
    brany: { draha: "light", soubory: [], celkem: null, tezkych: null, zdroje: null, neznameCesty: [] },
    workspace: { adresare: [], bezTestu: [], duvod: "výběr spadl — dotčené sady nejde určit" },
    testy: VESMIRY.map((v) => ({ jmeno: v.jmeno, popis: v.popis, config: v.config, soubory: [], duvod: "výběr spadl — dotčené testy nejde určit" })),
  };
}

/**
 * Sestaví plán. Moduly výběru se nahrávají DYNAMICKY: jejich pád (i syntaktický) je
 * „výběr spadl" → širší dráha, ne pád celého pre-pushe a ne „nic".
 */
export async function sestavPlan(p, koren, env = process.env) {
  const duvody = [...p.duvody];
  let rezim = p.rezim === "vyber" ? "vyber" : "sirsi";
  if (p.rezim !== "vyber" && p.rezim !== "sirsi") duvody.push(`plán nemá známý režim (rezim=${p.rezim ?? "chybí"})`);

  const zStropu = env.AISHA_PREPUSH_STROP_TESTU;
  let strop = STROP_TESTU_VYCHOZI;
  if (zStropu !== undefined && zStropu !== "") {
    if (/^\d+$/.test(zStropu)) strop = Number(zStropu);
    else duvody.push(`AISHA_PREPUSH_STROP_TESTU='${zStropu}' není číslo — platí ${STROP_TESTU_VYCHOZI}`);
  }

  // ── brány ──
  let vyber;
  let selektor = null;
  try {
    selektor = await import(path.join(path.dirname(TENTO), "../test/brany-dotcene.mjs"));
  } catch (e) {
    duvody.push(`výběr bran nejde nahrát (${String(e.message).split("\n")[0]})`);
  }
  if (!selektor) vyber = { rezim: "VSE_LEHKE", brany: [], neznameCesty: [] };
  else if (p.cesty.length === 0) vyber = { rezim: "VSE_LEHKE", brany: [], neznameCesty: [], duvod: "seznam změněných cest chybí — výběr nemá z čeho vybírat" };
  else {
    try {
      vyber = selektor.vyberBranVeStromu(p.cesty, koren, (t) => process.stderr.write(`  (brany-dotcene: ${t})\n`));
    } catch (e) {
      vyber = { rezim: "VSE_LEHKE", brany: [], neznameCesty: [], duvod: `výběr bran spadl (${String(e.message).split("\n")[0]})` };
    }
  }
  if (vyber.rezim !== "vyber") {
    rezim = "sirsi";
    if (vyber.duvod) duvody.push(vyber.duvod);
  }
  let heavy = new Set();
  let celkem = null;
  try {
    const lanes = JSON.parse(readFileSync(path.join(koren, "src/tests/gates/lanes.json"), "utf-8"));
    heavy = new Set((lanes.heavy ?? []).map((h) => h.soubor));
    if (selektor) celkem = selektor.vsechnyBrany(koren).length;
  } catch (e) {
    duvody.push(`lanes.json nejde přečíst (${String(e.message).split("\n")[0]})`);
    rezim = "sirsi";
  }
  // ── sady dotčených pracovních prostorů ──
  const chci = [...new Set(p.cesty.map((c) => c.match(PRACOVNI_PROSTOR)?.[1]).filter(Boolean))].sort();
  let workspace = { adresare: [], bezTestu: [] };
  if (chci.length > 0) {
    try {
      const { cileneSady } = await import(path.join(path.dirname(TENTO), "../test/run-service-tests.mjs"));
      const s = cileneSady(chci);
      const rel = (a) => path.relative(koren, a);
      workspace = { adresare: [...s.services, ...s.packages, ...s.plugins, ...s.rozsireni].map(rel).sort(), bezTestu: s.bezTestu.sort() };
    } catch (e) {
      rezim = "sirsi";
      duvody.push(`objevení sad pracovních prostorů spadlo (${String(e.message).split("\n")[0]})`);
      workspace = { adresare: [], bezTestu: [], duvod: "objevení sad spadlo — dotčené sady nejde určit" };
    }
  }

  // Dráha bran až TEĎ: i pád objevení sad výš rozšiřuje (sirsi), takže o dráze se
  // rozhoduje po všech krocích, které režim mohou změnit.
  const jeTezka = (f) => heavy.has(path.basename(f));
  const brany = rezim === "vyber"
    ? { draha: null, soubory: vyber.brany }
    : { draha: "light", soubory: vyber.brany.filter(jeTezka) };
  Object.assign(brany, { celkem, tezkych: heavy.size, zdroje: vyber.zdroje ?? null, neznameCesty: vyber.neznameCesty ?? [], pocetNeznamych: vyber.pocetNeznamych ?? (vyber.neznameCesty ?? []).length, vybrano: vyber.brany.length });

  // ── unit a script testy, které změněné moduly přímo importují ──
  const sledovane = gitSoubory(koren);
  const testy = [];
  for (const v of VESMIRY) {
    if (!selektor) { testy.push({ jmeno: v.jmeno, popis: v.popis, config: v.config, soubory: [], duvod: "výběr nejde nahrát" }); continue; }
    try {
      const aliasy = selektor.aliasyZTsconfigu(koren);
      const r = vyberTestu(v, p.cesty, koren, { primeImporty: selektor.primeImporty, idModulu: selektor.idModulu, aliasy, sledovane, strop });
      // Bez seznamu sledovaných souborů zná výběr jen změněné testy — zúžení se musí ŘÍCT.
      if (sledovane == null && !r.duvod) r.duvod = "git ls-files selhal — importéry mimo změněné soubory nejde hledat";
      testy.push({ jmeno: v.jmeno, popis: v.popis, config: v.config, ...r });
    } catch (e) {
      testy.push({ jmeno: v.jmeno, popis: v.popis, config: v.config, soubory: [], duvod: `výběr testů spadl (${String(e.message).split("\n")[0]})` });
    }
  }

  return { rezim, duvody, zmeneno: p.zmeneno, slouceni: p.slouceni, baze: p.baze, priznaky: p.priznaky, brany, workspace, testy };
}

/** Co se místně NEPUSTÍ a kdo to změří — řádky pro člověka. */
export function preskoceno(plan) {
  const pr = plan.priznaky ?? {};
  const out = [];
  const b = plan.brany;
  if (b.draha === "light") {
    const tezkeMimo = b.tezkych != null ? b.tezkych - b.soubory.length : "?";
    out.push(`těžká dráha bran mimo výběr (${tezkeMimo} souborů) — dokryje CI: Web: Brány (celá sada, obě dráhy)`);
  } else {
    const mimo = b.celkem != null ? b.celkem - b.soubory.length : "?";
    out.push(`${mimo} bran mimo výběr (z ${b.celkem ?? "?"}) — dokryje CI: Web: Brány (celá sada, obě dráhy)`);
  }
  for (const t of plan.testy) {
    const v = VESMIRY.find((x) => x.jmeno === t.jmeno);
    const kolik = t.celkem != null ? `${t.celkem - t.soubory.length} z ${t.celkem} souborů` : "celá sada";
    out.push(`${t.popis}: ${kolik} mimo výběr${t.duvod ? ` (${t.duvod})` : ""} — ${v ? v.ci(pr) : "dokryje CI"}`);
  }
  if (plan.workspace.duvod) out.push(`sady services/packages/plugins: ${plan.workspace.duvod} — dokryje CI: Services: Tests`);
  out.push(
    pr.services_change === "false"
      ? "ostatní sady services/packages/plugins — v CI se pro tuhle změnu NESPOUŠTÍ (services_change=false)"
      : "ostatní sady services/packages/plugins — dokryje CI: Services: Tests",
  );
  if (pr.extension === "true" && !plan.workspace.adresare.some((a) => a.startsWith("extensions/"))) {
    out.push("sada rozšíření (změna je v jeho zdrojové závislosti, ne v něm) — dokryje CI: Extension: Test (extension=true)");
  }
  if (pr.app !== "false") out.push("build (vite) — dokryje CI: Web: Build");
  if (pr.surfaces === "true") out.push("build povrchů (extranet) — dokryje CI: Surfaces: Contract & Overlays");
  const dalsi = Object.entries(pr).filter(([k, v]) => v === "true" && !["app", "services_change", "extension", "surfaces", "docs_only"].includes(k)).map(([k]) => k);
  if (dalsi.length > 0) out.push(`další úlohy CI podle směrování (místně se nikdy nepouštěly): ${dalsi.join(", ")}`);
  return out;
}

/** Lidský souhrn plánu (stejný v --plan i při běhu). */
export function popis(plan) {
  const r = [];
  const b = plan.brany;
  if (plan.rezim === "sirsi") {
    r.push(`  > ŠIRŠÍ cílená dráha — ${plan.duvody.join("; ") || "důvod neuveden"}`);
    for (const c of b.neznameCesty ?? []) r.push(`    neznámá cesta: ${c}`);
    if ((b.pocetNeznamych ?? 0) > (b.neznameCesty ?? []).length) r.push(`    … a dalších ${b.pocetNeznamych - b.neznameCesty.length}`);
  } else {
    r.push(`  > CÍLENÁ dráha — ${plan.zmeneno} změněných cest${plan.slouceni ? ` (v rozsahu ${plan.slouceni} merge commitů: posuzuje se rozdíl proti bázi)` : ""}`);
  }
  for (const z of plan.baze ?? []) r.push(`    báze ${z}`);
  const zd = b.zdroje;
  const odkud = zd ? ` (kategorie: ${zd.kategorie.join(", ") || "—"} · třídní vždy: ${zd.trida ?? 0} · změněné brány: ${zd.zmeneneBrany} · odkaz na cestu: ${zd.odkaz} · přímý import: ${zd.import})` : "";
  r.push(b.draha === "light"
    ? `    · brány: CELÁ LEHKÁ DRÁHA + ${b.soubory.length} vybraných těžkých${odkud}`
    : `    · brány: ${b.soubory.length} z ${b.celkem ?? "?"}${odkud}`);
  r.push(`    · sady pracovních prostorů: ${plan.workspace.adresare.join(", ") || "žádná"}${plan.workspace.bezTestu.length ? ` (bez testů: ${plan.workspace.bezTestu.join(", ")})` : ""}`);
  for (const t of plan.testy) r.push(`    · ${t.popis}: ${t.soubory.length ? `${t.soubory.length} souborů` : "žádný"}${t.duvod ? ` — ${t.duvod}` : ""}`);
  r.push("  > PŘESKOČENO místně (rozhodnutí majitele 2026-10-05: plné sady jen v CI; slučuje se podle `npm run ci:verdikt`):");
  for (const s of preskoceno(plan)) r.push(`    · ${s}`);
  return r.join("\n");
}

function spust(popisKroku, args, env, koren) {
  process.stderr.write(`\n▸ ${popisKroku}\n`);
  const adresar = mkdtempSync(path.join(os.tmpdir(), "aisha-prepush-cilene-"));
  const r = spawnSync("node", args, { cwd: koren, stdio: "inherit", env: { ...process.env, ...env, AISHA_REPORT_DIR: adresar } });
  const kod = r.status ?? 1;
  if (kod === 0) rmSync(adresar, { recursive: true, force: true });
  else process.stderr.write(`  reporty ponechány k diagnóze: ${adresar}\n`);
  return { popisKroku, kod };
}

/** Pustí plán; vrací kód podle verdikt-kody (1 přebíjí 75, 75 přebíjí 0). */
export function proved(plan, koren) {
  const vysledky = [];
  const brany = ["scripts/test/run-vitest.mjs", "--config", "vitest.gates.config.ts", "--default-dir", "src/tests/gates/"];
  if (plan.brany.draha === "light") {
    vysledky.push(spust("brány: celá lehká dráha", brany, { AISHA_SKIP_ONLINE: "1", AISHA_GATES_LANE: "light" }, koren));
  }
  if (plan.brany.soubory.length > 0) {
    vysledky.push(spust(`brány: ${plan.brany.soubory.length} vybraných`, [...brany, ...plan.brany.soubory], { AISHA_SKIP_ONLINE: "1", AISHA_GATES_LANE: "all" }, koren));
  }
  if (plan.workspace.adresare.length > 0) {
    vysledky.push(spust(`sady: ${plan.workspace.adresare.join(", ")}`, ["scripts/test/run-service-tests.mjs", ...plan.workspace.adresare.flatMap((d) => ["--jen", d])], {}, koren));
  }
  for (const t of plan.testy) {
    if (t.soubory.length === 0) continue;
    const args = ["scripts/test/run-vitest.mjs", ...(t.config ? ["--config", t.config] : []), ...t.soubory];
    vysledky.push(spust(`${t.popis}: ${t.soubory.length} souborů`, args, {}, koren));
  }
  const pady = vysledky.filter((v) => v.kod !== 0 && v.kod !== KOD_NEZMERENO);
  const nezmerene = vysledky.filter((v) => v.kod === KOD_NEZMERENO);
  process.stderr.write("\n━━━ cílená dráha: souhrn ━━━\n");
  for (const v of vysledky) process.stderr.write(`  ${v.kod === 0 ? "OK  " : v.kod === KOD_NEZMERENO ? "NEZMĚŘENO" : "FAIL"} ${v.popisKroku}\n`);
  if (vysledky.length === 0) process.stderr.write("  (žádný cílený test — tsc, lint, validate:static a i18n proběhly výš)\n");
  return pady.length > 0 ? 1 : nezmerene.length > 0 ? KOD_NEZMERENO : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  // Registr známých přepínačů (vzor scripts/aisha-redeploy.mjs): neznámý přepínač ani poziční
  // argument nesmí spadnout do výchozího režimu — ten testy SPOUŠTÍ (a maže adresáře reportů).
  const ZNAME_PREPINACE = new Set(["--plan"]);
  const nezname = argv.filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a));
  const pozicni = argv.filter((a) => !a.startsWith("-"));
  if (nezname.length || pozicni.length) {
    process.stderr.write(`prepush-cilene: neznámý argument ${[...nezname, ...pozicni].join(" ")} (známé: ${[...ZNAME_PREPINACE].join(", ")}; plán jde na stdin)\n`);
    process.exit(2);
  }
  const jenPlan = argv.includes("--plan");
  let koren = process.cwd();
  try {
    koren = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
  } catch (e) {
    process.stderr.write(`prepush-cilene: kořen repa nezjištěn (${String(e.message).split("\n")[0]}) — beru pracovní adresář\n`);
  }

  const p = prectiPlan(readFileSync(0, "utf-8"));
  if (p.rezim === "vse") {
    process.stderr.write("prepush-cilene: rezim=vse (plná sada) spouští hook sám — sem patří jen vyber/sirsi\n");
    process.exit(2);
  }
  let plan;
  try {
    plan = await sestavPlan(p, koren);
  } catch (e) {
    plan = nouzovyPlan(`sestavení plánu spadlo (${String(e.message).split("\n")[0]})`, p);
  }
  process.stderr.write(popis(plan) + "\n");
  if (jenPlan) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    process.exit(0);
  }
  process.exit(proved(plan, koren));
}

if (isDirectRun(import.meta.url)) main(); // lib/cli-entry.mjs: porovnává soubor, ne zápis cesty

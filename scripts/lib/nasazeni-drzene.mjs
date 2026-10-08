#!/usr/bin/env node
/**
 * nasazeni-drzene.mjs — DEKLAROVANÉ DRŽENÍ aplikací při nasazení po vlnách
 *
 * PROČ VZNIKL (naměřeno 2026-10-02, upstream dávka #1139, job 345483)
 * --------------------------------------------------------------------
 * Vlna 10 `web-render` neměla WEB_RENDER_SHELL_HOST_DIR ani WEB_RENDER_STATIC_HOST_DIR,
 * preflight compose ji správně odmítl (fail-closed) a další vlny se nenasadily.
 * Jenže web-render a local-ingest DRŽÍ rozhodnutí majitele z 2026-09-28: Coolify
 * převádí holý `${VAR}` bind na prázdný svazek, takže nasazení by odpojilo data.
 * Nasazení stacků by tak bylo červené při KAŽDÉM běhu, dokud majitel nerozhodne —
 * a stálá červená schová skutečné chyby.
 *
 * Řešení není výjimka v kódu, ale DEKLARACE instance s plničem:
 *   · overlay instance vyjmenuje držené aplikace v `nasazeni-drzene.json`, každou
 *     s důvodem a odkazem na rozhodnutí;
 *   · vlnový skript je VIDITELNĚ přeskočí („DRŽENO: …“) a pokračuje dalšími vlnami;
 *   · deploy-verdikt je zelený S VÝPISEM výjimek;
 *   · zmizí-li deklarace, aplikace se nasadí normálně;
 *   · nedeklarovaná chybějící proměnná zůstává fail-closed jako dřív.
 *
 * Deklaraci čte a ověřuje deploy-razitko — PRVNÍ krok nasazení, dřív než se cokoli
 * nasadí (nečitelná nebo neplatná deklarace nesmí nechat instanci napůl nasazenou).
 * Držet lze přesto JEN aplikaci, kterou nasazuje řetěz vln 3+: jen vlnové úlohy mají
 * plnič (`nasad-podle-vln.sh --drzene`). Aplikaci vln 0–2 (Kořen) nebo aplikaci
 * s vlastní přímou úlohou (Core/Edge/Extranet, restart n8n) by deklarace
 * nezastavila — deklarace bez plniče je chyba deklarace.
 *
 * KDO DEKLARACI ČTE — a proč všichni odsud (doplněno 2026-10-04)
 * ------------------------------------------------------------
 * Do 2026-10-04 ji četlo JEN nasazení z CI. Studený start (`aisha-cold-start.sh
 * --skip-create`, konvergence existující instance) o držení nevěděl: krok 5 by
 * drženou aplikaci přenasadil (odpojení dat na prázdný svazek, spuštění služby,
 * kterou provozovatel zastavil) a krok 4 by jí předtím doručil právě ty proměnné,
 * jejichž nepřítomnost preflight compose dnes zastavuje. Držení je vlastnost
 * INSTANCE, ne jedné cesty nasazení:
 *   · CI vlny ............ `scripts/ci/drzene-z-overlaye.sh` → `nasad-podle-vln.sh --drzene`
 *   · KAŽDÁ mutace ....... `lib/coolify-mutace.mjs` — jediný domov volání deploy / restart /
 *                          start / stop aplikace v Coolify; před voláním se ptá TADY
 *   · studený start ...... `aisha-cold-start.sh` (STOP před čímkoli, výčet v souhrnu)
 *   · nasazení a restart . `aisha-redeploy.mjs` (vlny, --only, --canary, --restart-validate)
 *   · zápis konfigurace .. `coolify-sync-envs.sh`, `coolify-deploy-init.sh`,
 *                          `coolify-story-init.sh` — držené aplikace se NEDOTKNOU
 *   · doktor ............. `cold-start-doctor.sh` (fáze E: výčet, neplatná = FAIL)
 * Mimo CI si overlay nástroj obstará sám (`drzeniInstance` → lib/instance-overlay.mjs);
 * shell čte přes `scripts/lib/drzeni.sh`, který jen volá tohle CLI.
 *
 * ⛔ Pravidlo „jen vlny 3+ bez přímé úlohy“ platí i pro studený start, ačkoli ten
 * by plnič měl pro každou vlnu. Deklarace je JEDNA a musí ji umět naplnit KAŽDÁ
 * cesta: držení vlny 0–2 nebo aplikace přímé úlohy by studený start ctil a CI ne —
 * aplikace by byla „držená“ jen do příštího sloučení do mainu. Platí tedy průnik.
 *
 * Tvar souboru (pole; neznámý klíč = chyba, ať překlep neprojde jako „platí“):
 *   [{ "aplikace": "web-render",
 *      "duvod": "…",
 *      "rozhodnuti": { "kdo": "majitel", "datum": "2026-09-28", "odkaz": "…" } }]
 *
 * Bez závislostí (Node stdlib): deploy joby běží bez node_modules.
 *
 * CLI:
 *   node scripts/lib/nasazeni-drzene.mjs --soubor <overlay>/nasazeni-drzene.json
 *        [--ci .forgejo/workflows/ci.yml] [--dnes YYYY-MM-DD]
 *   node scripts/lib/nasazeni-drzene.mjs --instance <nástroj> [--env-soubor <soubor>]
 *        [--tvar tsv] [--dnes YYYY-MM-DD]
 *     `--instance`   overlay TÉTO instance si obstará sám (cesta z prostředí, jinak klon
 *                    podle deklarace); `<nástroj>` jde do hlášky. Instance bez overlaye
 *                    i overlay bez souboru = nic drženo. Deklarovaný a NEDOSTUPNÝ overlay
 *                    = kód 1 (ne „nic drženo“ — to by bylo fail-open).
 *     `--env-soubor` soubor prostředí instance (KLIC=hodnota), ze kterého se vezme
 *                    deklarace overlaye, když ji samostatně spuštěný nástroj nemá v prostředí
 *     `--tvar tsv`   pro shell: `aplikace<TAB>hláška DRŽENO…` na řádek a PATIČKA
 *                    `__DRZENI_END__<TAB>počet<TAB>odkud se četlo` (důkaz úplnosti:
 *                    prázdný výstup s kódem 0 není „nic drženo“, je to „nevím“)
 * stdout: kompaktní JSON pole platných položek (+ `vlna`, `dni`); chybějící soubor = `[]`.
 * Kód 0 = platné · 1 = neplatná deklarace (::error na stderr) · 2 = chybný vstup.
 *
 *   node scripts/lib/nasazeni-drzene.mjs --drzene '<JSON pole z --soubor>' --aplikace <role>
 *     Dotaz nad UŽ OVĚŘENOU deklarací (output úlohy, která ji četla) — pro workflow,
 *     které nasazuje jednu jmenovanou aplikaci:
 *       kód 0 = aplikace JE držená (stdout: hláška „DRŽENO: …“) → NENASAZOVAT
 *       kód 3 = držená není (stdout prázdný)
 *       kód 1 = JSON nejde přečíst nebo není polem položek → nevíme, NENASAZOVAT
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { readConfigKey } from "./config-env-files.mjs";
import { DECLARATION_ENV, OVERLAY_ENV, REQUIRED_ENV, deklarovanyOverlayRepo, overlayDeclared, overlayDir, overlayRequired, ziskejDeklarovanyOverlay } from "./instance-overlay.mjs";

export const SOUBOR = "nasazeni-drzene.json";
/** Patička výstupu `--tvar tsv` — bez ní shell výstup nepřijme (lib/drzeni.sh). */
export const PATICKA_TSV = "__DRZENI_END__";
/**
 * Návratový kód „DRŽENO“ — aplikace se nenasadila, protože ji instance drží.
 * Volající ho nesmí zaměnit s úspěchem (0), s chybou nástroje (1, 2) ani s chybou sítě:
 * curl vrací 1–99, signály 128+. Proto 100. Nese ho domov mutace (lib/coolify-mutace.mjs)
 * i každý nástroj, kterému někdo drženou aplikaci výslovně jmenoval.
 */
export const KOD_DRZENO = 100;
/** Deklaraci čte deploy-zacatek, který běží po Kořeni (vlny 0–2) — držet lze až vlny 3+. */
export const PRVNI_DRZITELNA_VLNA = 3;

const KLICE_POLOZKY = new Set(["aplikace", "duvod", "rozhodnuti"]);
const KLICE_ROZHODNUTI = new Set(["kdo", "datum", "odkaz"]);
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Aplikace, na které workflow sahá PŘÍMO, mimo řetěz vln — deklarace držení by je nezastavila:
 *   · vlastní úloha nasazení: `bash scripts/ci/deploy-and-verify.sh <suffix>`
 *   · přímé adresování v Coolify: `coolify-resolve-uuid.sh "${…PREFIX}-<suffix>"` (např. restart
 *     po vydání uzlů n8n) — do 2026-10-03 to validátor neviděl a pustil by držení aplikace,
 *     kterou jiná úloha restartuje bez ohledu na deklaraci.
 * Řádky komentářů se neberou.
 */
export function primeAplikace(ciText) {
  const out = new Set();
  for (const r of String(ciText).split("\n")) {
    if (/^\s*#/.test(r)) continue;
    const m = /^\s*(?:run:\s*)?bash scripts\/ci\/deploy-and-verify\.sh ([a-z0-9-]+)\b/.exec(r);
    if (m) out.add(m[1]);
    for (const x of r.matchAll(/coolify-resolve-uuid\.sh\s+"?\$\{?[A-Z_]*PREFIX\}?-([a-z0-9-]+)"?/g)) out.add(x[1]);
  }
  return out;
}

/** Výstup `aisha-redeploy.mjs --print-waves` (vlna<TAB>aplikace[<TAB>strop]) → Map aplikace → vlna. */
export function vlnyZPoradi(poradi) {
  const out = new Map();
  for (const r of String(poradi).split("\n")) {
    const [vlna, app] = r.split("\t");
    if (app && /^\d+$/.test(vlna)) out.set(app, Number(vlna));
  }
  return out;
}

/** Celé dny mezi datem rozhodnutí a dneškem (UTC). */
export function dniOd(datum, dnes) {
  return Math.floor((Date.parse(`${dnes}T00:00:00Z`) - Date.parse(`${datum}T00:00:00Z`)) / 86_400_000);
}

function platneDatum(s) {
  const m = DATUM.exec(String(s));
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const neprazdne = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Ověří deklaraci. Neplatná položka se NEIGNORUJE — chyba deklarace zastaví nasazení.
 * @param {unknown} data  obsah souboru (JSON.parse)
 * @param {{ vlny: Map<string, number>, prime: Set<string>, dnes: string }} kontext
 * @returns {{ polozky: Array<{aplikace:string,duvod:string,kdo:string,datum:string,odkaz:string,vlna:number,dni:number}>, chyby: string[] }}
 */
export function validuj(data, { vlny, prime, dnes }) {
  const chyby = [];
  const polozky = [];
  if (!Array.isArray(data)) return { polozky, chyby: ["deklarace musí být pole položek"] };
  const videne = new Set();
  data.forEach((p, i) => {
    const kde = `položka ${i + 1}`;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      chyby.push(`${kde}: není objekt`);
      return;
    }
    for (const k of Object.keys(p)) if (!KLICE_POLOZKY.has(k)) chyby.push(`${kde}: neznámý klíč „${k}“`);
    const app = p.aplikace;
    const jmeno = neprazdne(app) ? app : `#${i + 1}`;
    if (!neprazdne(app)) chyby.push(`${kde}: chybí „aplikace“`);
    else if (!vlny.has(app)) chyby.push(`${app}: aplikaci WAVES neznají (aisha-redeploy.mjs --print-waves)`);
    else if (prime.has(app)) chyby.push(`${app}: nasazuje ji PŘÍMÁ úloha — deklarace by ji nezastavila (držet lze jen aplikace vln ${PRVNI_DRZITELNA_VLNA}+ bez vlastní úlohy)`);
    else if (vlny.get(app) < PRVNI_DRZITELNA_VLNA) chyby.push(`${app}: vlna ${vlny.get(app)} běží před deploy-zacatek — deklarace by ji nezastavila (držet lze jen vlny ${PRVNI_DRZITELNA_VLNA}+)`);
    if (neprazdne(app)) {
      if (videne.has(app)) chyby.push(`${app}: deklarována dvakrát`);
      videne.add(app);
    }
    if (!neprazdne(p.duvod)) chyby.push(`${jmeno}: chybí důvod držení`);
    const r = p.rozhodnuti;
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      chyby.push(`${jmeno}: chybí „rozhodnuti“ { kdo, datum, odkaz }`);
      return;
    }
    for (const k of Object.keys(r)) if (!KLICE_ROZHODNUTI.has(k)) chyby.push(`${jmeno}: neznámý klíč rozhodnutí „${k}“`);
    if (!neprazdne(r.kdo)) chyby.push(`${jmeno}: chybí, KDO držení rozhodl`);
    if (!neprazdne(r.odkaz)) chyby.push(`${jmeno}: chybí odkaz na rozhodnutí`);
    if (!platneDatum(r.datum)) chyby.push(`${jmeno}: datum rozhodnutí „${r.datum ?? ""}“ není YYYY-MM-DD`);
    // `dnes` je datum v UTC; rozhodnutí zapsané po místní půlnoci na východ od UTC nese už
    // zítřejší datum (až +14 h). Budoucnost je proto až POZÍTŘÍ — jinak deklarace z prvních
    // hodin dne shodí celé nasazení jako „v budoucnosti“.
    else if (dniOd(r.datum, dnes) < -1) chyby.push(`${jmeno}: datum rozhodnutí ${r.datum} je v budoucnosti`);
    if (chyby.length === 0) {
      polozky.push({ aplikace: app, duvod: p.duvod.trim(), kdo: r.kdo.trim(), datum: r.datum, odkaz: r.odkaz.trim(), vlna: vlny.get(app), dni: Math.max(0, dniOd(r.datum, dnes)) });
    }
  });
  return { polozky: chyby.length ? [] : polozky, chyby };
}

const NAPRAVA = "Neplatná deklarace se neignoruje: oprav nasazeni-drzene.json v overlayi instance (nebo položku smaž — aplikace se pak nasadí normálně).";
const dnesUtc = () => new Date().toISOString().slice(0, 10);

/**
 * JEDEN text pro všechny cesty (CI vlny, studený start, redeploy, sync env, doktor) —
 * držená aplikace se v jakémkoli logu najde jedním grepem „DRŽENO: <aplikace>“.
 * Volající za něj jen připíše, CO kvůli tomu nedělá („Nenasazuji.“).
 */
export function hlaskaDrzeno(p) {
  return `DRŽENO: ${p.aplikace} — ${p.duvod} — rozhodnutí ${p.kdo} ${p.datum} (${p.odkaz}); drženo od ${p.datum} (${p.dni} dní)`;
}

/**
 * Přečte a ověří deklaraci ze souboru — táž cesta pro CI (`--soubor`) i pro nástroje,
 * které si overlay obstarávají samy (`drzeniInstance`). NEHÁZÍ; neprázdné `chyby`
 * znamenají „nevíme, co je drženo“ a volající NESMÍ pokračovat jako „nic drženo“.
 * @param {string} soubor  cesta k nasazeni-drzene.json (nemusí existovat = nic drženo)
 * @param {{ dnes?: string, ci?: string }} [volby]
 * @returns {{ polozky: ReturnType<typeof validuj>["polozky"], chyby: string[], titulek: string, existuje: boolean }}
 */
export function nactiDeklaraci(soubor, { dnes = dnesUtc(), ci = join(REPO_ROOT, ".forgejo", "workflows", "ci.yml") } = {}) {
  // Overlay bez deklarace = nic drženo (stav jako před zavedením).
  if (!existsSync(soubor)) return { polozky: [], chyby: [], titulek: "", existuje: false };
  let data;
  try {
    data = JSON.parse(readFileSync(soubor, "utf8"));
  } catch (e) {
    return {
      polozky: [],
      existuje: true,
      titulek: "deklarace držení NEČITELNÁ",
      chyby: [`${soubor}: ${e.message} — nevíme, co je drženo, takže nevíme, co smíme nasadit. NENASAZUJI.`],
    };
  }
  const poradi = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "aisha-redeploy.mjs"), "--print-waves"], { encoding: "utf8" });
  if (poradi.status !== 0 || !poradi.stdout.trim()) {
    return {
      polozky: [],
      existuje: true,
      titulek: "deklaraci držení nejde ověřit",
      chyby: ["aisha-redeploy.mjs --print-waves selhal — bez vln nevím, co lze držet. NENASAZUJI."],
    };
  }
  const { polozky, chyby } = validuj(data, { vlny: vlnyZPoradi(poradi.stdout), prime: primeAplikace(readFileSync(ci, "utf8")), dnes });
  return { polozky, chyby, titulek: chyby.length ? "deklarace držení NEPLATNÁ" : "", existuje: true };
}

/**
 * Deklarace držení TÉTO instance — pro každou cestu mimo CI (studený start, redeploy,
 * zápis konfigurace, doktor). Overlay si obstará sama jedněmi dveřmi
 * (lib/instance-overlay.mjs): cesta předaná prostředím, jinak klon podle deklarace.
 *
 * ⛔ Samostatně spuštěný nástroj deklaraci overlaye v prostředí mít nemusí (obsluha ji
 * neexportovala) — a „nevím o overlayi“ by se přečetlo jako „nic drženo“, tedy
 * fail-open právě na cestě ručního nasazení. Proto `envSoubory`: soubory prostředí
 * instance, ze kterých se deklarace vezme, když v prostředí není. Do prostředí
 * procesu se propůjčí jen na dobu volání dveří.
 *
 * Instance bez overlaye a overlay bez souboru = nic drženo (`popis` říká které).
 * Deklarovaný a NEDOSTUPNÝ overlay, nečitelná nebo neplatná deklarace = VÝJIMKA
 * (`.chyby`, `.titulek`) — nikdy „nic drženo“.
 *
 * ⛔ Dveře overlaye jsou psané pro VOLITELNÁ čtení: ruční přebití, které neexistuje,
 * přeskočí; adresu, kterou nejde přečíst, vezmou jako „overlay nedeklarován“;
 * vynucení (`AISHA_OVERLAY_REQUIRED`) hlídá až `requireOverlay`. Pro držení je každý
 * z těch tří stavů „nevím, co je drženo“ — tady proto výjimka, ne „nic drženo“.
 * @param {string} kdo  jméno volajícího nástroje (do hlášky dveří)
 * @param {{ envSoubory?: string[], dnes?: string }} [volby]
 * @returns {{ polozky: ReturnType<typeof validuj>["polozky"], popis: string }}
 */
export function drzeniInstance(kdo, { envSoubory = [], dnes = dnesUtc() } = {}) {
  const selhani = (titulek, chyby) => Object.assign(new Error(`${titulek}: ${chyby.join("; ")}`), { titulek, chyby });
  const nevime = (duvod) =>
    selhani("deklaraci držení nejde získat", [`${duvod} Nevíme, co je drženo, takže nevíme, co smíme nasadit — „nic drženo“ by bylo fail-open. NENASAZUJI.`]);
  const rucni = (process.env[OVERLAY_ENV] ?? "").trim();
  if (rucni && !overlayDir()) throw nevime(`${OVERLAY_ENV}='${rucni}' ukazuje na adresář, který neexistuje.`);
  let propujceno = false;
  const puvodni = process.env[DECLARATION_ENV];
  if (!overlayDir() && !overlayDeclared() && envSoubory.length) {
    const zeSouboru = readConfigKey(DECLARATION_ENV, { files: envSoubory });
    if (zeSouboru) {
      process.env[DECLARATION_ENV] = zeSouboru;
      propujceno = true;
    }
  }
  let dir;
  let vynuceno;
  try {
    // Obě podmínky se čtou UVNITŘ: deklarace může být jen propůjčená ze souboru prostředí.
    if (overlayDeclared() && !deklarovanyOverlayRepo()) throw nevime(`${DECLARATION_ENV} je nastavená, ale nejde přečíst jako adresa repozitáře.`);
    vynuceno = overlayRequired();
    dir = ziskejDeklarovanyOverlay(kdo);
  } catch (e) {
    if (e?.titulek) throw e;
    throw selhani("deklarace držení NEČITELNÁ", [`${e.message} Nevíme, co je drženo, takže nevíme, co smíme nasadit — „nic drženo“ by bylo fail-open. NENASAZUJI.`]);
  } finally {
    // Propůjčená deklarace se vrací: zbytek procesu (profil, doktor) má dál vidět
    // prostředí tak, jak ho dostal — tenhle modul čte držení, nepřepíná overlay.
    if (propujceno) {
      if (puvodni === undefined) delete process.env[DECLARATION_ENV];
      else process.env[DECLARATION_ENV] = puvodni;
    }
  }
  if (!dir && vynuceno) throw nevime(`${REQUIRED_ENV} overlay vynucuje, ale instance žádný nemá.`);
  if (!dir) return { polozky: [], popis: `instance nemá overlay (${DECLARATION_ENV}) — nic drženo` };
  const d = nactiDeklaraci(join(dir, SOUBOR), { dnes });
  if (d.chyby.length) throw selhani(d.titulek, d.chyby);
  if (!d.existuje) return { polozky: [], popis: `overlay instance ${SOUBOR} nemá — nic drženo` };
  if (!d.polozky.length) return { polozky: [], popis: `${SOUBOR} v overlayi instance je prázdný — nic drženo` };
  return { polozky: d.polozky, popis: `${SOUBOR} v overlayi instance: drženo ${d.polozky.length} (${d.polozky.map((p) => p.aplikace).join(", ")})` };
}

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return a;
}

const ZNAME_PREPINACE = new Set(["soubor", "instance", "env-soubor", "tvar", "ci", "dnes", "drzene", "aplikace"]);

/**
 * Je `aplikace` v už ověřené deklaraci (JSON pole z `--soubor`/`--instance`)?
 * Prázdná, nečitelná nebo jinak tvarovaná hodnota je CHYBA (výjimka), ne „není držená“:
 * v CI znamená ztracený output úlohy, která deklaraci četla.
 * @returns {object|null} položka deklarace, nebo null
 */
export function polozkaZDrzenych(json, aplikace) {
  return polozkyZDrzenych(json).find((p) => p.aplikace === aplikace) ?? null;
}

/**
 * Už ověřená deklarace (JSON pole z `--soubor`/`--instance`) jako pole položek.
 * Prázdná, nečitelná nebo jinak tvarovaná hodnota = výjimka (nevíme, co je drženo).
 */
export function polozkyZDrzenych(json) {
  let d;
  try {
    d = JSON.parse(String(json));
  } catch (e) {
    throw new Error(`deklarace držení nejde přečíst jako JSON (${e.message})`);
  }
  if (!Array.isArray(d)) throw new Error("deklarace držení není pole položek");
  for (const p of d) {
    if (!p || typeof p !== "object" || !neprazdne(p.aplikace) || !neprazdne(p.duvod) || !neprazdne(p.datum)) {
      throw new Error("deklarace držení nese položku bez aplikace, důvodu nebo data");
    }
  }
  return d;
}
const bezTabu = (v) => String(v).replace(/[\t\n\r]+/g, " ");

function hlavni(argv) {
  const a = argumenty(argv);
  // Neznámý přepínač je STOP: překlep (`--instanc`) by jinak spadl do „chybí --soubor“
  // nebo — hůř — do výchozího tvaru výstupu, který volající nečeká.
  const nezname = Object.keys(a).filter((k) => !ZNAME_PREPINACE.has(k));
  if (nezname.length) {
    console.error(`nasazeni-drzene: neznámý přepínač: ${nezname.map((k) => `--${k}`).join(" ")}`);
    return 2;
  }
  if (a.drzene !== undefined || a.aplikace !== undefined) {
    if (typeof a.aplikace !== "string" || a.soubor !== undefined || a.instance !== undefined || a.tvar !== undefined) {
      console.error("nasazeni-drzene: dotaz chce PRÁVĚ --drzene '<JSON>' --aplikace <role> (bez --soubor/--instance/--tvar)");
      return 2;
    }
    try {
      // `--drzene ""` (ztracený output) parser přečte jako přepínač bez hodnoty → taky „nevíme“.
      const p = polozkaZDrzenych(typeof a.drzene === "string" ? a.drzene : "", a.aplikace);
      if (!p) return 3;
      process.stdout.write(`${hlaskaDrzeno(p)}\n`);
      return 0;
    } catch (e) {
      console.error(`::error title=deklarace držení::${e.message} — nevíme, co je drženo, NENASAZUJI.`);
      return 1;
    }
  }
  const zeSouboru = typeof a.soubor === "string";
  const zInstance = typeof a.instance === "string";
  if (zeSouboru === zInstance) {
    console.error("nasazeni-drzene: zadej PRÁVĚ JEDNO: --soubor <overlay>/nasazeni-drzene.json, nebo --instance <nástroj>");
    return 2;
  }
  if (a.tvar !== undefined && a.tvar !== "tsv") {
    console.error(`nasazeni-drzene: --tvar zná jen „tsv“ (bez něj JSON), dostal „${a.tvar}“`);
    return 2;
  }
  if (a["env-soubor"] !== undefined && (!zInstance || typeof a["env-soubor"] !== "string")) {
    console.error("nasazeni-drzene: --env-soubor <soubor> patří jen k --instance");
    return 2;
  }
  const dnes = typeof a.dnes === "string" ? a.dnes : dnesUtc();
  if (!platneDatum(dnes)) {
    console.error(`nasazeni-drzene: --dnes „${dnes}“ není YYYY-MM-DD`);
    return 2;
  }
  let polozky;
  let popis = "";
  if (zeSouboru) {
    const d = nactiDeklaraci(a.soubor, { dnes, ...(typeof a.ci === "string" ? { ci: a.ci } : {}) });
    if (d.chyby.length) {
      for (const c of d.chyby) console.error(`::error title=${d.titulek}::${c}`);
      if (d.titulek === "deklarace držení NEPLATNÁ") console.error(NAPRAVA);
      return 1;
    }
    polozky = d.polozky;
    popis = d.existuje ? a.soubor : `${a.soubor} neexistuje — nic drženo`;
  } else {
    try {
      ({ polozky, popis } = drzeniInstance(a.instance, { dnes, envSoubory: typeof a["env-soubor"] === "string" ? [a["env-soubor"]] : [] }));
    } catch (e) {
      if (!Array.isArray(e?.chyby)) throw e;
      for (const c of e.chyby) console.error(`::error title=${e.titulek}::${c}`);
      if (e.titulek === "deklarace držení NEPLATNÁ") console.error(NAPRAVA);
      return 1;
    }
  }
  if (a.tvar === "tsv") {
    const radky = polozky.map((p) => `${bezTabu(p.aplikace)}\t${bezTabu(hlaskaDrzeno(p))}\n`).join("");
    process.stdout.write(`${radky}${PATICKA_TSV}\t${polozky.length}\t${bezTabu(popis)}\n`);
    return 0;
  }
  process.stdout.write(`${JSON.stringify(polozky)}\n`);
  return 0;
}

if (isDirectRun(import.meta.url)) process.exit(hlavni(process.argv.slice(2)));

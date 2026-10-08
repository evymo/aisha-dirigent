#!/usr/bin/env node
/**
 * domenovy-overlay.mjs — doménový overlay instance: KTERÝ soubor a CO deklaruje
 * o doménách webu. Jeden domov pro obal cold-startu, cold-start i env-doktora.
 *
 * ⛔ NAMĚŘENO 2026-10-05 (sloučení s fix/bocni-vstupy-konvergence): redeploy
 * srovnává domény doktorem domén s prostředím z `.env.coolify`. `WEB_FQDNS`
 * (seznam značek webu) žije ale jen v doménovém overlayi instance a do
 * `.env.coolify` ho nikdo nepsal — doktor v redeployi proto „nevěděl" (správně:
 * nezapsal nic) a srovnání domén padalo u KAŽDÉHO forku. Overlay přitom uměl
 * najít jen obal cold-startu (`aisha-cold-start-env.sh`: DOMAINS_FILE) a
 * cold-start (rozklad proti instance-data a repu). Env-doktor, který v redeployi
 * běží před doktorem domén, ho najít neuměl — a tak deklaraci neznal.
 *
 * ⭐ JEDEN ROZKLAD, TŘI ČTENÁŘI:
 *   · `pozadovanyDomenovyOverlay` — JAKÝ soubor si prostředí žádá. Dřív inline
 *     v obalu: `COOLIFY_<ENV>_DOMAINS_FILE` (prostředí → config/coolify-environments.env,
 *     tam `${X:-výchozí}`), jinak `config/domains-<env>.env`, existuje-li v repu.
 *   · `rozlozDomenovyOverlay` — KDE leží. Dřív inline v cold-startu: nejdřív
 *     instance-data (sem instanční deklarace patří), pak repo; absolutní cesta
 *     platí, jak je.
 *   · `deklaraceWebFqdns` — CO z toho pro `WEB_FQDNS` plyne, ve stejném pořadí
 *     vrstev jako cold-start: soubor domén prostředí z repa (cold-start ho
 *     sourcuje hned na začátku), pak overlay (sourcuje se po derivaci), nakonec
 *     operátorský trezor (poslední slovo). Poslední přiřazení vyhrává; sebeodkaz
 *     `WEB_FQDNS=${WEB_FQDNS:-}` čte předchozí vrstvu.
 *
 * ⛔ „NEVÍM" NENÍ PRÁZDNO. Prázdný výsledek znamená „instance víc značek
 * nedeklaruje" a smí se zapsat. Nevím je: overlay vyžádaný a nenalezený,
 * deklarovaný overlay instance nejde získat, neznámý tvar prostředí, odkaz
 * v hodnotě, který nejde rozbalit. Tehdy se nevydá nic — prázdná hodnota by
 * doktoru domén řekla „jedna značka" a ten by routy značek smazal.
 *
 * CLI:
 *   node domenovy-overlay.mjs --pozadovany <AISHA_ENV>  (obal cold-startu)
 *     → stdout: požadovaný soubor nebo prázdno (kód 0); neznámý tvar prostředí → kód 2
 *   node domenovy-overlay.mjs --soubor <pozadovany>     (cold-start)
 *     → stdout: nalezená cesta (kód 0); nenalezeno → kód 3, stdout prázdný
 *       (instance-data = overlayDir() z instance-overlay.mjs, repo = kořen tohohle repa)
 * Měření na stanovišti: `AISHA_ENV=<prostředí> node scripts/aisha-env-doctor.mjs --dry-run`
 * vypíše WEB_FQDNS i se zdrojem (env-doktor je jediný zapisovatel té hodnoty).
 *
 * @module
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { rozbalDomainsEnv, rozbalHodnotu } from "./domeny-rozbal.mjs";
import { overlayDir } from "./instance-overlay.mjs";
import { pbPrefix } from "./prostredi-behu.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOUBOR_PROSTREDI = "config/coolify-environments.env";
export const KOD_NEVIM = 2;
export const KOD_NENALEZENO = 3;
/**
 * Kód, kterým env-doktor říká „WEB_FQDNS neznám, ostatní odvozené klíče jsem
 * zapsal". Vlastní kód, ne obecné selhání (2): redeploy s ním aplikace NASADÍ
 * (nasazení stav domén nezhorší), jen srovnání domén neproběhne a běh skončí
 * nenulou s příčinou (revize 08f6f66de, bod C).
 */
export const KOD_ENV_DOKTORA_WEB_NEVIM = 3;

/**
 * Hodnota klíče z config/coolify-environments.env tak, jak ji vidí obal (`set -a; .` nad prostředím).
 * `{ nevim }`, když odkaz v hodnotě nejde rozbalit — „nic nežádáno" by z toho udělalo známé prázdno.
 * @returns {{ hodnota: string } | { nevim: string }}
 */
function zeSouboruProstredi(repo, klic, prostredi) {
  const soubor = join(repo, SOUBOR_PROSTREDI);
  if (!existsSync(soubor)) return { hodnota: "" };
  let surova = null;
  for (const radek of readFileSync(soubor, "utf8").split("\n")) {
    const m = radek.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] === klic) surova = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  if (surova === null) return { hodnota: "" };
  const r = rozbalHodnotu(surova, (jmeno) => {
    const v = prostredi[jmeno];
    return v ? { hodnota: v, volitelnePrazdne: false } : null;
  });
  // ⛔ NAMĚŘENO v revizi 08f6f66de: tady stálo `chybi → ""`, tedy „overlay nežádán".
  // `COOLIFY_<ENV>_DOMAINS_FILE=${INSTANCE_DOMAINS}` bez hodnoty tak dal ZNÁMÉ prázdno
  // a env-doktor by jím přepsal uložený seznam značek.
  if (r.chybi.length > 0) return { nevim: `${klic} v ${SOUBOR_PROSTREDI} odkazuje na hodnotu, která není: ${r.chybi.join(", ")}` };
  return { hodnota: r.hodnota };
}

/**
 * Jaký doménový overlay si prostředí běhu žádá — týž výpočet, jaký dělá obal
 * cold-startu (ten ho od 2026-10-05 volá přes CLI).
 *
 * @param {{ repo?: string, env?: string, prostredi?: Record<string, string|undefined> }} o
 * @returns {{ znamo: true, pozadovany: string, deklarovany: string } | { znamo: false, duvod: string }}
 *   `deklarovany` = hodnota COOLIFY_<ENV>_DOMAINS_FILE (cold-start ten soubor z repa sourcuje hned
 *   na začátku); `pozadovany` = co se rozkládá jako overlay ("" = žádný).
 */
export function pozadovanyDomenovyOverlay({ repo = REPO, env = "", prostredi = process.env } = {}) {
  const prefix = pbPrefix(env);
  if (prefix === null) return { znamo: false, duvod: `AISHA_ENV=${env} není známý tvar prostředí` };
  const klic = `${prefix}DOMAINS_FILE`;
  let deklarovany = prostredi[klic] ?? "";
  if (deklarovany.includes("${")) return { znamo: false, duvod: `${klic} v prostředí je nerozbalená šablona (${deklarovany})` };
  if (!deklarovany) {
    const zeSouboru = zeSouboruProstredi(repo, klic, prostredi);
    if ("nevim" in zeSouboru) return { znamo: false, duvod: zeSouboru.nevim };
    deklarovany = zeSouboru.hodnota;
  }
  if (deklarovany) return { znamo: true, pozadovany: deklarovany, deklarovany };
  const odvozeny = `config/domains-${env}.env`;
  if (env && existsSync(join(repo, odvozeny))) return { znamo: true, pozadovany: odvozeny, deklarovany: "" };
  return { znamo: true, pozadovany: "", deklarovany: "" };
}

/**
 * Kde požadovaný overlay leží: instance-data, pak repo; absolutní cesta, jak je.
 * @returns {string|null}
 */
export function rozlozDomenovyOverlay({ pozadovany, overlayDir = "", repo = REPO }) {
  if (!pozadovany) return null;
  if (isAbsolute(pozadovany)) return existsSync(pozadovany) ? pozadovany : null;
  for (const zaklad of [overlayDir, repo]) {
    if (!zaklad) continue;
    const kandidat = join(zaklad, pozadovany);
    if (existsSync(kandidat)) return kandidat;
  }
  return null;
}

/**
 * WEB_FQDNS, jak ho instance deklaruje — vrstvy v pořadí cold-startu.
 *
 * @param {{
 *   repo?: string,
 *   env?: string,
 *   prostredi?: Record<string, string|undefined>,
 *   ziskejOverlayDir?: () => string|null,  // instance-data; vyhodí, když je deklarovaný a nejde získat
 *   trezor?: Map<string,string>,           // operátorský trezor (.env-prod-backup / záloha prostředí)
 *   najdi?: (jmeno: string) => string,     // ostatní odkazy v hodnotě (topologie, trezor…)
 *   ulozena?: string,                      // WEB_FQDNS v cílovém env souboru; undefined = klíč tam CHYBÍ
 * }} o
 * @returns {{ znamo: true, hodnota: string, zdroj: string } | { znamo: false, duvod: string }}
 */
export function deklaraceWebFqdns({
  repo = REPO,
  env = "",
  prostredi = process.env,
  ziskejOverlayDir = () => null,
  trezor = new Map(),
  najdi = () => "",
  ulozena,
} = {}) {
  // Trezor má poslední slovo — i VÝSLOVNĚ PRÁZDNÝ `WEB_FQDNS=` (cold-start ho
  // `load_env_file_keys … overwrite` vyexportuje prázdný, změřeno). Výslovná
  // deklarace operátora smí seznam i zúžit.
  if (trezor.has("WEB_FQDNS")) {
    const zTrezoru = String(trezor.get("WEB_FQDNS") ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (zTrezoru.includes("${")) return { znamo: false, duvod: `WEB_FQDNS v trezoru je nerozbalená šablona (${zTrezoru})` };
    return { znamo: true, hodnota: zTrezoru, zdroj: "deklarace operátora (trezor)" };
  }

  // Cold-start exportuje, co SÁM vyžádal (i prázdné = overlay nežádal). Bez něj
  // (redeploy, ruční běh) se požadavek spočítá stejně jako v obalu.
  let pozadavek;
  const vyslovnyPozadavek = prostredi.DOMAINS_OVERLAY_REQUESTED !== undefined;
  if (vyslovnyPozadavek) {
    const p = pozadovanyDomenovyOverlay({ repo, env, prostredi });
    pozadavek = { znamo: true, pozadovany: prostredi.DOMAINS_OVERLAY_REQUESTED, deklarovany: p.znamo ? p.deklarovany : "" };
  } else {
    pozadavek = pozadovanyDomenovyOverlay({ repo, env, prostredi });
  }
  if (!pozadavek.znamo) return { znamo: false, duvod: pozadavek.duvod };

  let overlayDir = null;
  if (pozadavek.pozadovany && !isAbsolute(pozadavek.pozadovany)) {
    try {
      overlayDir = ziskejOverlayDir();
    } catch (e) {
      return { znamo: false, duvod: String(e?.message ?? e).split("\n")[0] };
    }
  }

  const vrstvy = [];
  if (pozadavek.deklarovany) {
    const brzka = isAbsolute(pozadavek.deklarovany) ? pozadavek.deklarovany : join(repo, pozadavek.deklarovany);
    if (existsSync(brzka)) vrstvy.push(brzka);
  }
  if (pozadavek.pozadovany) {
    const nalez = rozlozDomenovyOverlay({ pozadovany: pozadavek.pozadovany, overlayDir, repo });
    if (!nalez) {
      return {
        znamo: false,
        duvod:
          `doménový overlay „${pozadavek.pozadovany}" je vyžádaný, ale není v instance-data` +
          `${overlayDir ? ` (${overlayDir})` : " (overlay instance není k dispozici)"} ani v repu`,
      };
    }
    if (!vrstvy.includes(nalez)) vrstvy.push(nalez);
  }

  let hodnota = "";
  let odkud = "";
  for (const soubor of vrstvy) {
    const text = readFileSync(soubor, "utf8").replace(/^\s*export\s+/gm, "");
    const r = rozbalDomainsEnv(text, (jmeno) => (jmeno === "WEB_FQDNS" ? hodnota : najdi(jmeno) || ""));
    if (r.nerozbalene.has("WEB_FQDNS")) {
      return {
        znamo: false,
        duvod: `WEB_FQDNS v ${soubor} odkazuje na hodnotu, která není: ${r.nerozbalene.get("WEB_FQDNS").join(", ")}`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(r.hodnoty, "WEB_FQDNS")) {
      // ⛔ Odkaz uvnitř seznamu, který vyjde PRÁZDNÝ, značku tiše vypustí
      // (`https://a,${ZNACKA_B:-}` → jen `https://a`). Tvrdý `${X}` i volitelný
      // `${X:-}` bez hodnoty jsou proto NEVÍM, ne kratší seznam.
      const najdiVSouboru = (jmeno) => {
        const v = Object.prototype.hasOwnProperty.call(r.hodnoty, jmeno) && jmeno !== "WEB_FQDNS" ? r.hodnoty[jmeno] : najdi(jmeno) || "";
        return v ? { hodnota: v, volitelnePrazdne: false } : null;
      };
      for (const { jmeno, text: odkaz } of odkazyVHodnote(r.sablony.WEB_FQDNS ?? "")) {
        if (jmeno === "WEB_FQDNS") continue;
        if (rozbalHodnotu(odkaz, najdiVSouboru).hodnota === "") {
          return { znamo: false, duvod: `WEB_FQDNS v ${soubor}: odkaz ${odkaz} je prázdný — značka by tiše vypadla ze seznamu` };
        }
      }
      hodnota = r.hodnoty.WEB_FQDNS.replace(/^(["'])(.*)\1$/, "$2");
      odkud = soubor;
    }
  }

  // ⛔ ZÚŽIT SMÍ JEN VÝSLOVNÝ POŽADAVEK COLD-STARTU (revize 08f6f66de). Mimo
  // cold-start (redeploy, ruční běh) je požadavek na overlay DOPOČTENÝ — a každý
  // rozdíl proti cold-startu (export v shellu obsluhy, jiné AISHA_ENV, absolutní
  // cesta, hodnota z trezoru v prostředí) by dal kratší seznam nebo prázdno, které
  // by doktor domén zapsal a routy značek smazal. Ubrat značku proti uloženému
  // seznamu proto dopočtený požadavek nesmí: to je NEVÍM. Přidat smí.
  if (!vyslovnyPozadavek) {
    // ⛔ Klíč v cílovém souboru CHYBÍ (první redeploy po zavedení klíče, obnova
    // .env.coolify bez něj): není s čím porovnat, takže ani neprázdný výsledek
    // nejde odlišit od cizího overlaye. Výchozí hodnotu založí jen cold-start
    // (výslovný požadavek) nebo deklarace v trezoru (revize 27d6f3f5e).
    if (ulozena === undefined) {
      return {
        znamo: false,
        duvod:
          "WEB_FQDNS v cílovém env souboru CHYBÍ a požadavek na doménový overlay je DOPOČTENÝ (bez cold-startu) — " +
          "není s čím porovnat; výchozí hodnotu založí jen cold-start (--skip-create) nebo výslovná deklarace v trezoru",
      };
    }
    const nove = new Set(hostySeznamu(hodnota));
    const ubrane = hostySeznamu(ulozena).filter((h) => !nove.has(h));
    if (ubrane.length > 0) {
      return {
        znamo: false,
        duvod:
          `požadavek na doménový overlay je DOPOČTENÝ (bez cold-startu) a ${hodnota ? "ubral by" : "vyprázdnil by"} ` +
          `uložený seznam značek (${ubrane.length} z ${hostySeznamu(ulozena).length}: ${ubrane.slice(0, 3).join(", ")}` +
          `${ubrane.length > 3 ? ", …" : ""}) — zúžit smí jen výslovný požadavek cold-startu (cold-start --skip-create)`,
      };
    }
  }
  return { znamo: true, hodnota, zdroj: hodnota ? `doménový overlay ${odkud}` : "instance víc značek nedeklaruje" };
}

/** Položky seznamu značek pro porovnání (bez mezer, malými písmeny, bez koncového `/`). */
function hostySeznamu(csv) {
  return String(csv ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Odkazy `${…}` nejvyšší úrovně v hodnotě (párové závorky; výchozí smí nést další odkaz). */
function odkazyVHodnote(text) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf("${", i)) >= 0) {
    let j = i + 2;
    let otevreno = 1;
    while (j < text.length && otevreno > 0) {
      if (text.startsWith("${", j)) { otevreno++; j += 2; continue; }
      if (text[j] === "}") otevreno--;
      j++;
    }
    const odkaz = text.slice(i, j);
    const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)/.exec(odkaz);
    out.push({ jmeno: m ? m[1] : "", text: odkaz });
    i = j;
  }
  return out;
}

if (isDirectRun(import.meta.url)) {
  const [prepinac, argument] = process.argv.slice(2);
  if (prepinac === "--pozadovany") {
    const r = pozadovanyDomenovyOverlay({ env: argument ?? "" });
    if (!r.znamo) {
      process.stderr.write(`[domenovy-overlay] NEVÍM: ${r.duvod}\n`);
      process.exit(KOD_NEVIM);
    }
    process.stdout.write(r.pozadovany ? `${r.pozadovany}\n` : "");
    process.exit(0);
  }
  if (prepinac === "--soubor") {
    // Instance-data přes rozcestník (jedny dveře k overlayi) — cold-start ho má
    // v tu chvíli už naklonovaný a exportovaný.
    const nalez = rozlozDomenovyOverlay({ pozadovany: argument ?? "", overlayDir: overlayDir() ?? "" });
    if (!nalez) process.exit(KOD_NENALEZENO);
    process.stdout.write(`${nalez}\n`);
    process.exit(0);
  }
  process.stderr.write("použití: node scripts/lib/domenovy-overlay.mjs --pozadovany <AISHA_ENV> | --soubor <pozadovany>\n");
  process.exit(64);
}

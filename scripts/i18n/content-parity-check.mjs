#!/usr/bin/env node
/**
 * Parita jazyků v content slovnících (`src/i18n/content/**`).
 *
 * ⛔ PROČ VZNIKLA: 2026-09-05 mělo `src/i18n/content/<locale>/extranet.json` 134 klíčů
 * v `en` a 118 v každém z ostatních pěti jazyků — 16 klíčů existovalo POUZE
 * anglicky. Všechny existující brány přitom svítily zeleně, protože žádná z nich
 * tuhle vlastnost neměří:
 *
 *   · `i18n:check` (scripts/i18n/check.mjs)  → měří `src/i18n/segments`, JINÝ strom
 *   · `check:i18n` (check-i18n-parity.mjs)   → měří `použité ⊆ floor`, jen `instances/*`
 *   · `i18n:content:check` + content-translations-sot.gate → měří `seed == generátor`
 *
 * Poslední jmenovaná je zrádná: seed VĚRNĚ odráží neúplný zdroj, takže neúplnost
 * projde jako „up to date". Zelená znamenala „strom je konzistentní sám se sebou",
 * ne „je přeloženo".
 *
 * ⭐ MĚŘÍ SE VLASTNOST: „každý klíč, který má platformní báze anglicky, má i
 * ostatní deklarované jazyky, neprázdně a se stejnými interpolacemi."
 *
 * Usage:
 *   node scripts/i18n/content-parity-check.mjs
 *   node scripts/i18n/content-parity-check.mjs --json
 *
 * Exit: 0 = parita v pořádku, 1 = nález.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverContentLayers,
  SUPPORTED_LOCALES,
} from "./lib/content-translations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT_DIR = path.join(ROOT, "src/i18n/content");
const SEED_ROOT_DIR = path.join(ROOT, "aisha/db/seed");
const ALLOWLIST_PATH = path.join(ROOT, "scripts/i18n/cognate-allowlist.json");
const CANONICAL = "en";
const JSON_OUT = process.argv.includes("--json");
const VERBOSE = process.argv.includes("--verbose");

/** Vnořený i plochý tvar → ploché tečkové klíče (soubory dnes bývají ploché). */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

/** Interpolace `{{x}}` jako setříděný multiset — pořadí ve větě se lišit smí, sada ne. */
function tokens(value) {
  return [...String(value).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]).sort();
}

/**
 * Allowlist legitimních shod s angličtinou.
 *
 * ⛔ BEZ NĚJ BY BRÁNA MĚŘILA ŠUM: „hodnota == en" NENÍ důkaz nepřeložení.
 * Naměřeno 2026-09-05: všech 13 shod v `extranet.json` byly kognáty nebo kódy
 * — `Finance` je česky i francouzsky Finance, `Status` je německy Status,
 * `USD` je měnový kód, `p50 ms` technická jednotka. Brána, která na tohle
 * křičí, se za týden vypne.
 *
 * ⭐ Každá položka nese DŮVOD (píše ho člověk, ne nástroj) a osiřelá položka
 * bránu zčervená — seznam se tím čistí sám a nemůže zvětšovat mlčení.
 */
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return { entries: [], triaged: new Set() };
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  return {
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    triaged: new Set(Array.isArray(raw.triagedNamespaces) ? raw.triagedNamespaces : []),
  };
}

function allowKey(entries, layerName, namespace, key, locale) {
  return entries.find(
    (e) =>
      e.key === key &&
      (e.namespace ?? namespace) === namespace &&
      (!e.layer || e.layer === layerName) &&
      (!Array.isArray(e.locales) || e.locales.includes(locale)),
  );
}

const findings = [];
const add = (f) => findings.push(f);

const layers = discoverContentLayers(CONTENT_DIR, SEED_ROOT_DIR);
const allow = loadAllowlist();
const usedAllow = new Set();
const summary = [];

for (const layer of layers) {
  const enDir = path.join(layer.contentDir, CANONICAL);
  if (!existsSync(enDir)) {
    // Vrstva bez kanonického jazyka se nedá poměřit — mlčet by znamenalo
    // prohlásit ji za v pořádku, aniž ji kdokoli viděl.
    add({ layer: layer.name, blocking: true, kind: "layer-without-canonical", detail: `chybí ${CANONICAL}/ ve ${layer.sourceLabel}` });
    continue;
  }

  /**
   * ⭐ POŽADOVANÁ SADA JAZYKŮ SE BERE Z DEKLARACE, NE Z TOHO, CO NA DISKU JE.
   *
   * Platformní báze je to, co zdědí KAŽDÁ další implementace — musí umět všechny
   * deklarované jazyky (`SUPPORTED_LOCALES`). Kdyby se sada odvodila ze
   * sjednocení přítomných adresářů, smazání jazyka by bránu ZEZELENILO.
   *
   * Vrstvy `demo` a `implementations/<name>` smějí vozit méně jazyků (nasazení
   * pro dva trhy nemá důvod psát thajsky), ale co vezou, musí být úplné.
   */
  const present = readdirSync(layer.contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SUPPORTED_LOCALES.includes(d.name))
    .map((d) => d.name);
  const required =
    layer.kind === "platform" ? SUPPORTED_LOCALES : [...new Set([CANONICAL, ...present])];

  for (const loc of required) {
    if (!present.includes(loc)) {
      add({ layer: layer.name, locale: loc, blocking: true, kind: "missing-locale-dir", detail: `chybí adresář ${loc}/` });
    }
  }

  const namespaces = readdirSync(enDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  for (const ns of namespaces) {
    const en = flatten(JSON.parse(readFileSync(path.join(enDir, `${ns}.json`), "utf8")));
    const enKeys = Object.keys(en);
    for (const loc of required) {
      if (loc === CANONICAL || !present.includes(loc)) continue;
      const file = path.join(layer.contentDir, loc, `${ns}.json`);
      if (!existsSync(file)) {
        add({ layer: layer.name, locale: loc, namespace: ns, blocking: true, kind: "missing-namespace-file", detail: `chybí ${loc}/${ns}.json (${enKeys.length} klíčů bez překladu)` });
        continue;
      }
      const dict = flatten(JSON.parse(readFileSync(file, "utf8")));
      for (const key of enKeys) {
        // ⛔ PRÁZDNÁ ANGLIČTINA NENÍ CO PŘEKLÁDAT. Prázdný překlad je tu SPRÁVNÁ
        // odpověď, ne vada. Naměřeno 2026-09-05: `questionnaires` má 37 takových
        // klíčů (popisy, které se nezobrazují) — bez téhle věty brána hlásila
        // 185 falešných nálezů, a brána, která křičí na nevinné, se vypne.
        if (String(en[key]).trim() === "") continue;
        if (!(key in dict)) {
          add({ layer: layer.name, locale: loc, namespace: ns, key, blocking: true, kind: "missing-key", detail: `en="${String(en[key]).slice(0, 60)}"` });
          continue;
        }
        const value = dict[key];
        if (String(value).trim() === "") {
          add({ layer: layer.name, locale: loc, namespace: ns, key, blocking: true, kind: "empty-value" });
          continue;
        }
        const a = tokens(en[key]).join("|");
        const b = tokens(value).join("|");
        if (a !== b) {
          add({ layer: layer.name, locale: loc, namespace: ns, key, blocking: true, kind: "interpolation-mismatch", detail: `en{${a}} ≠ ${loc}{${b}}` });
        }
        if (value === en[key]) {
          const hit = allowKey(allow.entries, layer.name, ns, key, loc);
          if (hit) usedAllow.add(`${hit.key}|${loc}`);
          else
            add({
              layer: layer.name, locale: loc, namespace: ns, key,
              kind: "untranslated-copy",
              /**
               * ⭐ FAKT × HEURISTIKA. Chybějící klíč je FAKT a blokuje všude.
               * Shoda s angličtinou je jen INDICIE: mezi nálezy jsou názvy
               * produktů, čísla („18-25“, „65+“), technologie („React,
               * TypeScript“) a hlavně IDENTIFIKÁTORY IKON („Sparkles“,
               * „BarChart“), jejichž „přeložení“ by UI rozbilo. Blokovat
               * heuristikou v doméně, kterou nikdo neprošel, znamená nutit
               * cizí tým k rozhodnutí naslepo — a taková brána se vypne.
               * Proto blokuje jen tam, kde shody PROŠEL člověk.
               */
              blocking: allow.triaged.has(ns),
              detail: `= en "${String(value).slice(0, 40)}" — přelož, nebo doplň do cognate-allowlist.json s důvodem`,
            });
        }
      }
    }
    summary.push({ layer: layer.name, namespace: ns, enKeys: enKeys.length, locales: required.length });
  }
}

/**
 * Osiřelá položka allowlistu = buď překlep, nebo shoda, která už neplatí (někdo
 * přeložil). Ponechat ji by znamenalo držet výjimku, kterou nic nekryje — přesně
 * ten tichý dluh, kvůli kterému allowlisty hnijí.
 */
for (const e of allow.entries) {
  const locales = Array.isArray(e.locales) ? e.locales : SUPPORTED_LOCALES.filter((l) => l !== CANONICAL);
  const orphan = locales.every((l) => !usedAllow.has(`${e.key}|${l}`));
  if (orphan) add({ blocking: true, kind: "orphan-allowlist-entry", key: e.key, detail: `už není shodná s ${CANONICAL} (nebo klíč zmizel) — odeber ji z cognate-allowlist.json` });
  if (!e.reason || !String(e.reason).trim()) add({ blocking: true, kind: "allowlist-entry-without-reason", key: e.key, detail: "položka allowlistu musí nést důvod" });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ findings, summary }, null, 2));
} else {
  console.log("\n🌍 Parita jazyků v content slovnících\n");
  for (const s of summary) console.log(`   ${s.layer}/${s.namespace}: ${s.enKeys} klíčů × ${s.locales} jazyků`);
  if (findings.length === 0) {
    console.log("\n✅ Parita v pořádku.\n");
  } else {
    const byKind = {};
    for (const f of findings) (byKind[f.kind] ??= []).push(f);
    const blockingCount = findings.filter((f) => f.blocking).length;
    console.log("");
    for (const [kind, list] of Object.entries(byKind)) {
      const blocks = list.some((f) => f.blocking);
      const nss = [...new Set(list.map((f) => f.namespace).filter(Boolean))].join(", ");
      console.error(
        `${blocks ? "❌" : "⚠️ "} ${kind}: ${list.length}${blocks ? "" : ` — HLÁŠENO, neblokuje (namespace neprošel revizí: ${nss})`}`,
      );
      /**
       * ⭐ DETAILY JEN K TOMU, CO BLOKUJE. Poradní nálezy jsou dnes stovky
       * (176 kognátů v devíti neprojitých doménách) a vypisovat je při KAŽDÉM
       * běhu `i18n:check` znamená utopit tři blokující řádky ve dvou stech
       * poradních — a naučit lidi výstup přeskakovat. Kdo chce seznam, řekne si
       * o něj (`--verbose`, nebo `--json`).
       */
      if (!blocks && !VERBOSE) {
        console.error(`     (detaily: npm run i18n:content:parity -- --verbose)`);
        continue;
      }
      for (const f of list.slice(0, 20)) {
        const where = [f.layer, f.namespace, f.locale, f.key].filter(Boolean).join("/");
        console.error(`     ${where}${f.detail ? ` — ${f.detail}` : ""}`);
      }
      if (list.length > 20) console.error(`     … a dalších ${list.length - 20}`);
    }
    console.error(
      `\n${blockingCount > 0 ? "❌" : "⚠️ "} Celkem ${findings.length} nález(ů), z toho ${blockingCount} blokujících.\n`,
    );
  }
}

/**
 * ⛔ `process.exit()` NE. Naměřeno 2026-09-05 při mutačním testu: `--json` psané
 * do ROURY se utne (~64 kB), protože `process.exit()` nepočká na dopsání
 * stdout. V terminálu to nebylo vidět, v CI (kde se vždy roura) by se výstup
 * tiše ořízl a diagnostika by lhala. `exitCode` nechá Node doběhnout a spláchnout.
 */
process.exitCode = findings.some((f) => f.blocking) ? 1 : 0;

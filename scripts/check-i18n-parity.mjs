#!/usr/bin/env node
/**
 * i18n parity gate:
 *  1) každý klíč použitý v shellu (t('app.*')) existuje v KAŽDÉ locale KAŽDÉHO overlaye,
 *  2) všechny locales uvnitř overlaye mají IDENTICKÉ sady klíčů (žádný tichý drift překladů).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlayDirOrRequired } from './lib/instance-overlay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = path.join(ROOT, 'apps');
const INSTANCES = path.join(ROOT, 'instances');

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

// Scan EVERY app's src (workbench-shell, …) — each surface's t('app.*')
// literals must be translated in every locale of every overlay.
const used = new Set();
for (const app of readdirSync(APPS).filter((d) => statSync(path.join(APPS, d)).isDirectory())) {
  const src = path.join(APPS, app, 'src');
  // Ask whether it exists rather than catching the failure to look: an app
  // without src/ is a normal case here, not an error being swallowed.
  if (!existsSync(src)) continue;
  for (const f of walk(src)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('(app\.[a-z0-9_.]+)'/g)) used.add(m[1]);
  }
}

// Keys the SHELL never mentions, because the DATABASE supplies them: a block
// envelope carries `title_key` and every column carries `label_key`, and the
// renderer feeds those straight to t(). Scanning only the shells therefore
// checks the smaller half of the contract.
//
// It showed, on the live extranet 2026-07-28: four admin blocks rendered with
// `app.cols.kind`, `app.cols.calls`, `app.units.usd` … as literal column
// headings, because the RPCs emitted label keys that existed in no overlay and
// this gate was structurally unable to see them. It reported "20 used keys
// covered" while ten were missing.
//
// The SQL source of truth is where those keys are written, so that is where
// they are read from.
//
// Two sources, because the keys live in two repos: the RPCs here emit column
// `label_key`s, and the instance-data overlay declares each block's `title_key`.
// The second is only readable when AISHA_INSTANCE_CONFIG_DIR points at that
// checkout — so the coverage is PRINTED rather than assumed. 19 of 29 live
// blocks rendered an untranslated title on 2026-07-28 precisely because nothing
// looked there.
const KEY_SOURCES = [path.join(ROOT, 'aisha/db/sql/functions')];
// Jedny dveře k overlayi. Bez něj tenhle skript měří MÍŇ (title_key bloků
// zůstanou neprohlédnuté) — proto volitelný režim, který to nahlas přizná.
// V CI, kde overlay je, ho AISHA_OVERLAY_REQUIRED=1 povýší na povinný.
const INSTANCE_DIR = overlayDirOrRequired('check-i18n-parity');
if (INSTANCE_DIR) KEY_SOURCES.push(INSTANCE_DIR);

for (const SQL_FUNCTIONS of KEY_SOURCES) {
  if (!existsSync(SQL_FUNCTIONS)) continue;
  for (const f of readdirSync(SQL_FUNCTIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(path.join(SQL_FUNCTIONS, f), 'utf8');
    // 'label_key','app.cols.kind'  /  'title_key','app.blocks.x.title'
    // Not restricted to `app.` — instance-data declares block titles under
    // `block.` and `extranet.` too, and those were exactly the ones nothing
    // checked. Any dotted lower-case key counts.
    for (const m of sql.matchAll(/'(?:label_key|title_key)'\s*,\s*'([a-z][a-z0-9_]*(?:\.[a-z0-9_]*)+)'/g)) {
      // A trailing dot means the SQL BUILDS the key by concatenation
      // ('app.wb.field.' || f.name) — the literal is a prefix, not a key, and
      // demanding a translation for it would be demanding one for a fragment
      // that never reaches t(). The per-field keys it produces are data-driven
      // and cannot be enumerated from the source at all.
      if (m[1].endsWith('.')) continue;
      used.add(m[1]);
    }

    // Second shape, and the one that actually carries block titles: the
    // instance overlay declares them as a POSITIONAL column in
    // `insert into surface_blocks (…, title_key, …) values (…)`. The pair form
    // above never matches it — which is why a first attempt at this check
    // reported the same 47 keys and covered none of the 19 untranslated block
    // titles it was written for. Read the column list, find where title_key
    // sits, take that position out of every tuple.
    for (const ins of sql.matchAll(
      /insert\s+into\s+(?:public\.)?surface_blocks\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi,
    )) {
      const cols = ins[1].split(',').map((c) => c.trim().toLowerCase());
      const at = cols.indexOf('title_key');
      if (at < 0) continue;
      for (const tuple of ins[2].matchAll(/\(([\s\S]*?)\)\s*(?=,\s*\(|$|\s*on\s+conflict)/gi)) {
        // Split on top-level commas only — source_params is jsonb with commas inside.
        const parts = [];
        let depth = 0;
        let cur = '';
        let inStr = false;
        for (let i = 0; i < tuple[1].length; i++) {
          const ch = tuple[1][i];
          if (ch === "'" && tuple[1][i - 1] !== '\\') inStr = !inStr;
          if (!inStr && (ch === '(' || ch === '[')) depth++;
          if (!inStr && (ch === ')' || ch === ']')) depth--;
          if (!inStr && depth === 0 && ch === ',') { parts.push(cur); cur = ''; continue; }
          cur += ch;
        }
        parts.push(cur);
        const raw = (parts[at] ?? '').trim();
        const key = raw.match(/^'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'$/);
        if (key) used.add(key[1]);
      }
    }
    }
}

console.log(
  `i18n: ${used.size} klíčů ke kontrole` +
    (INSTANCE_DIR && existsSync(INSTANCE_DIR)
      ? ` (včetně title_key z ${path.basename(INSTANCE_DIR)})`
      : ' — instanční overlay NEPROHLÉDNUT (AISHA_INSTANCE_CONFIG_DIR nenastaven): title_key bloků není pokryt'),
);

// Keys collected FROM the overlay may also be translated IN the overlay. Without
// this the check was asymmetric: it read an instance's block titles out of the
// instance repo and then demanded they be translated in the GENERIC tree
// (instances/_default/i18n.json), which is exactly the leak split-rule forbids —
// an instance cannot ship a section without writing its own words upstream.
//
// The build agrees: deploy/surface-host/Dockerfile mounts the overlay at
// instances/_overlay and the shell resolves bundle[locale] from THERE, so a key
// translated in the overlay is genuinely covered at runtime.
//
// Protection is unchanged in the direction that matters — a key translated
// NOWHERE still fails. Measured 2026-08-12: five section titles declared in the
// instance overlay, translated in the same overlay, failed this check.
const overlayTranslated = new Set();
if (INSTANCE_DIR && existsSync(INSTANCE_DIR)) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '.git' && entry.name !== 'node_modules') walk(p); continue; }
      if (entry.name !== 'i18n.json') continue;
      try {
        const d = JSON.parse(readFileSync(p, 'utf8'));
        for (const loc of Object.keys(d).filter((k) => !k.startsWith('_'))) {
          for (const k of Object.keys(d[loc] ?? {})) overlayTranslated.add(k);
        }
      } catch (e) {
        // Say it out loud. A dictionary that will not parse silently covers
        // NOTHING, and swallowing that turns "translated in the overlay" into a
        // claim this check cannot back — the exact silent degradation the
        // silent-degradation gate exists to stop.
        console.warn(`i18n: overlay dictionary ${p} is unreadable (${e.message}) — its keys count as untranslated.`);
      }
    }
  };
  walk(INSTANCE_DIR);
  if (overlayTranslated.size) {
    console.log(`i18n: ${overlayTranslated.size} klíčů přeloženo v instančním overlayi — ty generický strom nést nemusí.`);
  }
}

let fail = false;
for (const inst of readdirSync(INSTANCES).filter((d) => statSync(path.join(INSTANCES, d)).isDirectory())) {
  // ⛔ CHYBĚJÍCÍ SLOVNÍK JE NÁLEZ, NE VÝJIMKA. Pád procesu neřekne, KTERÁ
  // instance ho nemá, a vypadá jako porucha nástroje — ne jako vada dat.
  const dictPath = path.join(INSTANCES, inst, 'i18n.json');
  if (!existsSync(dictPath)) {
    fail = true;
    console.error(`FAIL ${inst}: chybí i18n.json — instance bez slovníku nejde ověřit.`);
    continue;
  }
  const dict = JSON.parse(readFileSync(dictPath, 'utf8'));
  const locales = Object.keys(dict).filter((k) => !k.startsWith('_'));
  const base = new Set(Object.keys(dict[locales[0]] ?? {}));
  for (const loc of locales) {
    const have = new Set(Object.keys(dict[loc]));
    const missingUsed = [...used].filter((k) => !have.has(k) && !overlayTranslated.has(k)).sort();
    const drift = [...new Set([...[...base].filter((k) => !have.has(k)), ...[...have].filter((k) => !base.has(k))])].sort();
    if (missingUsed.length) { fail = true; console.error(`FAIL ${inst}/${loc}: chybí použité klíče: ${missingUsed.join(', ')}`); }
    if (drift.length) { fail = true; console.error(`FAIL ${inst}/${loc}: drift vůči ${locales[0]}: ${drift.join(', ')}`); }
  }
  if (!fail) console.log(`OK ${inst}: ${locales.length} locales, ${base.size} klíčů, ${used.size} použitých pokryto`);
}
process.exit(fail ? 1 : 0);

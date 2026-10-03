/**
 * Shared library for the CONTENT translation SoT pipeline.
 *
 * Content translations = the DB-managed `translations` rows that are NOT part of
 * the static frontend i18n (segments/locales). They are runtime/CMS content
 * (hero, products, questionnaires, tests, …) historically dumped out of the DB
 * into `aisha/db/seed/translations/*.sql` ("-- Auto-generated from database").
 *
 * This module makes a file-based tree the single Source of Truth:
 *   src/i18n/content/{locale}/{namespace}.json   →  { "full.key": "value", … }
 * and regenerates the DB seed SQL from it. The frontend `src/i18n/segments/`
 * (app i18n) is a SEPARATE system and is untouched.
 *
 * The DB identity of a row is the (key, namespace, locale) triple; note the i18n
 * KEY is independent of the namespace (e.g. key `community-program.consent.x`
 * lives in namespace `consents`), so a flat key→value map per namespace is the
 * faithful representation.
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import path from "path";
import { porovnej } from "../../lib/razeni.mjs";

// Matches a single VALUES row: 4 single-quoted fields with SQL '' escaping,
// any indentation, optional trailing comma/semicolon. Field order is resolved
// from the INSERT header (see parseSeedSql) because dump files use two orders:
//   (key, locale, namespace, value)   and   (locale, namespace, key, value)
const ROW_RE =
  /^\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)\s*[,;]?\s*$/;
const INSERT_RE =
  /INSERT\s+INTO\s+(?:public\.)?translations\s*\(([^)]+)\)/i;

const SUPPORTED_LOCALES = ["en", "cs", "de", "fr", "ru", "th"];

/** SQL '' → ' */
export function sqlUnescape(s) {
  return s.replace(/''/g, "'");
}
/** ' → '' */
export function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

/**
 * Parse one dump .sql file into rows {key, locale, namespace, value}.
 * Resolves field order from the nearest preceding INSERT header so both
 * column orderings parse correctly.
 */
export function parseSeedSql(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const rows = [];
  let cols = null;
  for (const line of lines) {
    const ins = line.match(INSERT_RE);
    if (ins) {
      cols = ins[1].split(",").map((c) => c.trim().toLowerCase());
      continue;
    }
    const m = line.match(ROW_RE);
    if (!m || !cols) continue;
    const raw = [m[1], m[2], m[3], m[4]];
    const rec = {};
    cols.forEach((c, i) => {
      rec[c] = raw[i] === undefined ? "" : sqlUnescape(raw[i]);
    });
    if (rec.key != null && rec.locale != null && rec.namespace != null && rec.value != null) {
      rows.push({ key: rec.key, locale: rec.locale, namespace: rec.namespace, value: rec.value });
    }
  }
  return rows;
}

/** Parse every *.sql in a dump dir → flat rows array. */
export function parseSeedDir(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    out.push(...parseSeedSql(path.join(dir, f)));
  }
  return out;
}

/**
 * Collapse rows to the effective DB state after ON CONFLICT … DO UPDATE:
 * last write per (namespace, key, locale) wins. Returns a Map keyed by
 * `namespace\u0000key\u0000locale` → value.
 */
export function dedupeRows(rows) {
  const map = new Map();
  for (const r of rows) map.set(`${r.namespace}\u0000${r.key}\u0000${r.locale}`, r.value);
  return map;
}

/** rows → tree[locale][namespace][key] = value (last-wins). */
export function rowsToTree(rows) {
  const tree = {};
  for (const r of rows) {
    ((tree[r.locale] ??= {})[r.namespace] ??= {})[r.key] = r.value;
  }
  return tree;
}

/** Read the content SoT tree from src/i18n/content/{locale}/{namespace}.json. */
export function readContentTree(contentDir, locales = SUPPORTED_LOCALES) {
  const tree = {};
  for (const loc of locales) {
    const locDir = path.join(contentDir, loc);
    if (!existsSync(locDir)) continue;
    tree[loc] = {};
    for (const f of readdirSync(locDir).filter((x) => x.endsWith(".json"))) {
      const ns = f.replace(/\.json$/, "");
      tree[loc][ns] = JSON.parse(readFileSync(path.join(locDir, f), "utf8"));
    }
  }
  return tree;
}

export function discoverContentLayers(contentDir, seedRootDir) {
  const layers = [
    {
      kind: "platform",
      name: "platform",
      contentDir,
      outDir: path.join(seedRootDir, "translations"),
      filename: (namespace) => `${namespace}.sql`,
      sourceLabel: "src/i18n/content/{locale}/{namespace}.json",
    },
  ];

  const demoDir = path.join(contentDir, "demo");
  if (existsSync(demoDir) && statSync(demoDir).isDirectory()) {
    layers.push({
      kind: "demo",
      name: "demo",
      contentDir: demoDir,
      outDir: path.join(seedRootDir, "demo"),
      filename: (namespace) => `20_content_translations_${namespace}.sql`,
      sourceLabel: "src/i18n/content/demo/{locale}/{namespace}.json",
    });
  }

  const implementationsDir = path.join(contentDir, "implementations");
  if (existsSync(implementationsDir) && statSync(implementationsDir).isDirectory()) {
    for (const name of readdirSync(implementationsDir).sort()) {
      const implementationDir = path.join(implementationsDir, name);
      if (!statSync(implementationDir).isDirectory()) continue;
      layers.push({
        kind: "implementation",
        name,
        contentDir: implementationDir,
        outDir: path.join(seedRootDir, "implementations", name),
        filename: (namespace) => `20_content_translations_${namespace}.sql`,
        sourceLabel: `src/i18n/content/implementations/${name}/{locale}/{namespace}.json`,
      });
    }
  }

  return layers;
}

/** Tree → flat rows {key, locale, namespace, value}. */
export function treeToRows(tree) {
  const rows = [];
  for (const loc of Object.keys(tree)) {
    for (const ns of Object.keys(tree[loc])) {
      for (const key of Object.keys(tree[loc][ns])) {
        rows.push({ key, locale: loc, namespace: ns, value: tree[loc][ns][key] });
      }
    }
  }
  return rows;
}

/** Sorted JSON for one {locale, namespace} → stable file content. */
export function stringifyNamespace(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted, null, 2) + "\n";
}

/**
 * Build the deterministic seed SQL for ONE namespace from its rows.
 * Normalised format: schema-less `translations`, column order
 * (key, locale, namespace, value), rows sorted by (key, locale).
 */
export function buildNamespaceSql(
  namespace,
  rows,
  sourceLabel = `src/i18n/content/{locale}/${namespace}.json`,
) {
  const ordered = [...rows].sort(
    (a, b) => porovnej(a.key, b.key) || porovnej(a.locale, b.locale),
  );
  const header =
    `-- ${namespace} translations (${ordered.length} rows)\n` +
    `-- Source of truth: ${sourceLabel.replace("{namespace}", namespace)}\n` +
    `-- Generated by \`npm run i18n:content:build\` — DO NOT EDIT.\n\n` +
    `INSERT INTO translations (key, locale, namespace, value) VALUES\n`;
  const body = ordered
    .map(
      (r, i) =>
        `  ('${sqlEscape(r.key)}', '${r.locale}', '${sqlEscape(r.namespace)}', '${sqlEscape(r.value)}')` +
        (i === ordered.length - 1 ? "" : ","),
    )
    .join("\n");
  return (
    header +
    body +
    `\nON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value;\n`
  );
}

export { SUPPORTED_LOCALES };

#!/usr/bin/env node
/**
 * ONE-TIME migration: lift the DB content translations out of the legacy
 * "-- Auto-generated from database" dump files (aisha/db/seed/translations/*.sql)
 * into the file-based Source of Truth tree:
 *
 *   src/i18n/content/{locale}/{namespace}.json
 *
 * After this, `npm run i18n:content:build` regenerates the seed SQL from the tree
 * (see scripts/i18n/build-content-translations.mjs). The frontend i18n
 * (src/i18n/segments → src/i18n/locales) is a separate system and is untouched.
 *
 * Default = DRY RUN (verify fidelity, write nothing). Pass --write to create the
 * content tree. Always performs an effective-state round-trip check:
 * dump rows (deduped by ON CONFLICT) must equal the tree rows (deduped).
 *
 * Usage:
 *   node scripts/i18n/extract-content-translations.mjs            # dry-run + verify
 *   node scripts/i18n/extract-content-translations.mjs --write    # write content tree
 *
 * @module
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseSeedDir,
  dedupeRows,
  rowsToTree,
  treeToRows,
  stringifyNamespace,
} from "./lib/content-translations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DUMP_DIR = path.join(ROOT, "aisha", "db", "seed", "translations");
const CONTENT_DIR = path.join(ROOT, "src", "i18n", "content");

const write = process.argv.includes("--write");

console.log("\n📤 Extracting DB content translations → content SoT tree\n");

const dumpRows = parseSeedDir(DUMP_DIR);
const tree = rowsToTree(dumpRows);
const treeRows = treeToRows(tree);

// Effective-state round-trip: ON CONFLICT means last-write-wins per
// (namespace, key, locale); the tree dedupes the same way, so the two
// effective states must be identical or we'd be changing/losing data.
const before = dedupeRows(dumpRows);
const after = dedupeRows(treeRows);

const diffs = [];
for (const [k, v] of before) {
  if (!after.has(k)) diffs.push(`LOST   ${k}`);
  else if (after.get(k) !== v) diffs.push(`CHANGED ${k}`);
}
for (const k of after.keys()) if (!before.has(k)) diffs.push(`EXTRA  ${k}`);

// Stats
const locales = Object.keys(tree).sort();
const nsCounts = {};
for (const r of treeRows) nsCounts[r.namespace] = (nsCounts[r.namespace] || 0) + 1;

console.log(`   dump rows parsed:        ${dumpRows.length}`);
console.log(`   effective (deduped):     ${before.size}`);
console.log(`   tree effective (deduped):${after.size}`);
console.log(`   locales:                 ${locales.join(", ")}`);
console.log(`   namespaces (${Object.keys(nsCounts).length}):`);
for (const ns of Object.keys(nsCounts).sort())
  console.log(`       ${ns.padEnd(24)} ${nsCounts[ns]}`);

if (diffs.length) {
  console.error(`\n❌ Round-trip FIDELITY FAILED — ${diffs.length} difference(s):`);
  console.error(diffs.slice(0, 30).join("\n"));
  process.exit(1);
}
console.log(`\n✅ Round-trip fidelity OK — effective DB state preserved exactly.`);

if (!write) {
  console.log("\n(dry-run — pass --write to create src/i18n/content/)\n");
  process.exit(0);
}

let files = 0;
for (const loc of locales) {
  const locDir = path.join(CONTENT_DIR, loc);
  mkdirSync(locDir, { recursive: true });
  for (const ns of Object.keys(tree[loc]).sort()) {
    writeFileSync(path.join(locDir, `${ns}.json`), stringifyNamespace(tree[loc][ns]));
    files++;
  }
}
console.log(`\n✅ Wrote ${files} content SoT file(s) under src/i18n/content/\n`);

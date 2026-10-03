#!/usr/bin/env node
/**
 * Content translation SQL seed parity checker.
 *
 * 0.9.0 keeps static frontend i18n (`src/i18n/segments` -> locales) separate
 * from DB-managed content translations (`src/i18n/content` -> seed SQL). This
 * checker validates the DB content seed side and is layer-aware:
 *
 *   platform       src/i18n/content/{locale}/{namespace}.json
 *                  -> aisha/db/seed/translations/{namespace}.sql
 *   demo           src/i18n/content/demo/{locale}/{namespace}.json
 *                  -> aisha/db/seed/demo/20_content_translations_{namespace}.sql
 *   implementation src/i18n/content/implementations/<name>/{locale}/{namespace}.json
 *                  -> aisha/db/seed/implementations/<name>/20_content_translations_{namespace}.sql
 *
 * The old pre-0.9.0 web segment check intentionally does not run here: web
 * page copy/branding is implementation/template content, not platform app i18n.
 *
 * @module
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildNamespaceSql,
  discoverContentLayers,
  parseSeedSql,
  readContentTree,
  treeToRows,
} from "./lib/content-translations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(ROOT, "src", "i18n", "content");
const SEED_ROOT_DIR = path.join(ROOT, "aisha", "db", "seed");

function isLegacyTranslationDump(filePath) {
  try {
    return parseSeedSql(filePath).length > 0;
  } catch {
    return false;
  }
}

function expectedForLayer(layer) {
  const rows = treeToRows(readContentTree(layer.contentDir));
  const byNamespace = {};
  for (const row of rows) (byNamespace[row.namespace] ??= []).push(row);

  const expected = {};
  for (const namespace of Object.keys(byNamespace).sort()) {
    expected[layer.filename(namespace)] = buildNamespaceSql(
      namespace,
      byNamespace[namespace],
      layer.sourceLabel,
    );
  }
  return { rows, expected };
}

console.log("\nContent translation SQL seed parity check\n");

const layers = discoverContentLayers(CONTENT_DIR, SEED_ROOT_DIR);
const problems = [];
let totalRows = 0;
let totalFiles = 0;

for (const layer of layers) {
  const { rows, expected } = expectedForLayer(layer);
  totalRows += rows.length;
  totalFiles += Object.keys(expected).length;

  const onDisk = existsSync(layer.outDir)
    ? new Set(readdirSync(layer.outDir).filter((file) => file.endsWith(".sql")))
    : new Set();

  console.log(
    `Layer ${layer.kind}:${layer.name} - ${rows.length} rows, ` +
      `${Object.keys(expected).length} SQL file(s)`,
  );

  for (const [file, content] of Object.entries(expected)) {
    const filePath = path.join(layer.outDir, file);
    if (!onDisk.has(file)) {
      problems.push(`${layer.kind}:${layer.name} missing: ${file}`);
      continue;
    }
    if (readFileSync(filePath, "utf8") !== content) {
      problems.push(`${layer.kind}:${layer.name} drift: ${file}`);
    }
  }

  for (const file of onDisk) {
    if (file in expected) continue;
    if (isLegacyTranslationDump(path.join(layer.outDir, file))) {
      problems.push(`${layer.kind}:${layer.name} stale legacy dump: ${file}`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    "\nContent translation seed drift found. Run `npm run i18n:content:build`:\n" +
      problems.map((problem) => `   - ${problem}`).join("\n"),
  );
  console.error(`\n${problems.length} drift(s) found`);
  process.exit(1);
}

console.log(
  `\nContent translation seed up to date: ${totalFiles} file(s), ${totalRows} row(s).\n`,
);

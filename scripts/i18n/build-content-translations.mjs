#!/usr/bin/env node
/**
 * Generate DB content-translation seed SQL from file-based Source of Truth.
 *
 * Layered sources:
 *   src/i18n/content/{locale}/{namespace}.json
 *     -> aisha/db/seed/translations/{namespace}.sql
 *   src/i18n/content/demo/{locale}/{namespace}.json
 *     -> aisha/db/seed/demo/20_content_translations_{namespace}.sql
 *   src/i18n/content/implementations/{name}/{locale}/{namespace}.json
 *     -> aisha/db/seed/implementations/{name}/20_content_translations_{namespace}.sql
 *
 * @module
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  readContentTree,
  treeToRows,
  buildNamespaceSql,
  parseSeedSql,
  discoverContentLayers,
} from "./lib/content-translations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(ROOT, "src", "i18n", "content");
const SEED_ROOT_DIR = path.join(ROOT, "aisha", "db", "seed");

const check = process.argv.includes("--check");

function isLegacyTranslationDump(filePath) {
  try {
    return parseSeedSql(filePath).length > 0;
  } catch {
    return false;
  }
}

function layerExpected(layer) {
  const tree = readContentTree(layer.contentDir);
  const rows = treeToRows(tree);
  const byNs = {};
  for (const r of rows) (byNs[r.namespace] ??= []).push(r);

  const expected = {};
  for (const ns of Object.keys(byNs).sort()) {
    expected[layer.filename(ns)] = buildNamespaceSql(ns, byNs[ns], layer.sourceLabel);
  }
  return { rows, expected };
}

const layers = discoverContentLayers(CONTENT_DIR, SEED_ROOT_DIR);
const layerPlans = layers.map((layer) => ({ layer, ...layerExpected(layer) }));

if (check) {
  const problems = [];
  for (const { layer, expected } of layerPlans) {
    const onDisk = existsSync(layer.outDir)
      ? new Set(readdirSync(layer.outDir).filter((f) => f.endsWith(".sql")))
      : new Set();

    for (const [file, content] of Object.entries(expected)) {
      const p = path.join(layer.outDir, file);
      if (!onDisk.has(file)) problems.push(`${layer.kind}:${layer.name} missing: ${file}`);
      else if (readFileSync(p, "utf8") !== content) {
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

  if (problems.length) {
    console.error(
      `content-translation seed drift - run \`npm run i18n:content:build\`:\n` +
        problems.map((p) => `   - ${p}`).join("\n"),
    );
    process.exit(1);
  }

  const namespaces = layerPlans.reduce((sum, plan) => sum + Object.keys(plan.expected).length, 0);
  console.log(`content-translation seed up to date (${namespaces} layer namespace file(s)).`);
  process.exit(0);
}

let written = 0;
let removed = 0;
for (const { layer, expected } of layerPlans) {
  mkdirSync(layer.outDir, { recursive: true });
  const onDisk = new Set(readdirSync(layer.outDir).filter((f) => f.endsWith(".sql")));

  for (const [file, content] of Object.entries(expected)) {
    writeFileSync(path.join(layer.outDir, file), content);
    written++;
  }

  for (const file of onDisk) {
    if (!(file in expected) && isLegacyTranslationDump(path.join(layer.outDir, file))) {
      rmSync(path.join(layer.outDir, file));
      removed++;
    }
  }
}

console.log(
  `\nGenerated ${written} content-translation seed file(s) from src/i18n/content/` +
    (removed ? ` (removed ${removed} legacy file(s))` : "") +
    `\n`,
);

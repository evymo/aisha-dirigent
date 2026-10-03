#!/usr/bin/env node
/**
 * i18n Segments Builder
 *
 * Merges segment JSON files from src/i18n/segments/{lang}/*.json
 * into compiled locale files at src/i18n/locales/{lang}.json
 *
 * Usage:
 *   node scripts/i18n/segments-build.mjs
 *   npm run i18n:segments:build
 *
 * @module
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEGMENTS_DIR = path.join(ROOT, "src", "i18n", "segments");
const LOCALES_DIR = path.join(ROOT, "src", "i18n", "locales");

const SUPPORTED_LANGS = ["en", "cs", "de", "fr", "ru", "th"];

function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object"
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

mkdirSync(LOCALES_DIR, { recursive: true });

let totalBuilt = 0;

console.log("\n📦 Building locales from segments...\n");

for (const lang of SUPPORTED_LANGS) {
  const langDir = path.join(SEGMENTS_DIR, lang);
  if (!existsSync(langDir)) {
    console.warn(`   ⚠️  Skipping ${lang} (no segments directory)`);
    continue;
  }

  const files = readdirSync(langDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let merged = {};
  for (const file of files) {
    const content = JSON.parse(
      readFileSync(path.join(langDir, file), "utf-8")
    );
    merged = deepMerge(merged, content);
  }

  const outputPath = path.join(LOCALES_DIR, `${lang}.json`);
  const newContent = JSON.stringify(merged, null, 2) + "\n";

  // Check if content changed
  let changed = true;
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, "utf-8");
    changed = existing !== newContent;
  }

  if (changed) {
    writeFileSync(outputPath, newContent);
    const keyCount = JSON.stringify(merged).split('":"').length - 1;
    console.log(
      `   📝 ${lang}.json — ${files.length} segment(s), ~${keyCount} keys`
    );
    totalBuilt++;
  } else {
    console.log(`   ✅ ${lang}.json — no changes`);
  }
}

console.log(
  `\n✅ Done. ${totalBuilt} locale(s) updated, ${SUPPORTED_LANGS.length - totalBuilt} unchanged.\n`
);

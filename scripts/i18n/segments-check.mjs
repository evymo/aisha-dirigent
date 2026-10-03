#!/usr/bin/env node
/**
 * i18n Segments Parity Checker
 *
 * Compares segment files between canonical (en) and other languages.
 * Reports missing keys, extra keys, and segment file mismatches.
 *
 * Usage:
 *   node scripts/i18n/segments-check.mjs
 *   npm run i18n:segments:check
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEGMENTS_DIR = path.join(ROOT, "src", "i18n", "segments");

const CANONICAL_LANG = "en";
const SUPPORTED_LANGS = ["en", "cs", "de", "fr", "ru", "th"];

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

let totalMissing = 0;
let totalExtra = 0;

console.log("\n📊 i18n Segments Parity Report\n");

const canonicalDir = path.join(SEGMENTS_DIR, CANONICAL_LANG);
const canonicalFiles = readdirSync(canonicalDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

console.log(`Canonical: ${CANONICAL_LANG} (${canonicalFiles.length} segments)\n`);

for (const lang of SUPPORTED_LANGS) {
  if (lang === CANONICAL_LANG) continue;

  const langDir = path.join(SEGMENTS_DIR, lang);
  if (!existsSync(langDir)) {
    console.log(`❌ ${lang}: directory missing entirely`);
    continue;
  }

  let langMissing = 0;
  let langExtra = 0;

  for (const file of canonicalFiles) {
    const canonicalPath = path.join(canonicalDir, file);
    const langPath = path.join(langDir, file);

    if (!existsSync(langPath)) {
      const canonicalContent = JSON.parse(
        readFileSync(canonicalPath, "utf-8")
      );
      const keyCount = flattenKeys(canonicalContent).length;
      console.log(`   ❌ ${lang}/${file}: MISSING (${keyCount} keys)`);
      langMissing += keyCount;
      continue;
    }

    const canonicalContent = JSON.parse(
      readFileSync(canonicalPath, "utf-8")
    );
    const langContent = JSON.parse(readFileSync(langPath, "utf-8"));

    const canonicalKeys = new Set(flattenKeys(canonicalContent));
    const langKeys = new Set(flattenKeys(langContent));

    const missing = [...canonicalKeys].filter((k) => !langKeys.has(k));
    const extra = [...langKeys].filter((k) => !canonicalKeys.has(k));

    if (missing.length > 0 || extra.length > 0) {
      console.log(
        `   ⚠️  ${lang}/${file}: -${missing.length} missing, +${extra.length} extra`
      );
      langMissing += missing.length;
      langExtra += extra.length;
    }
  }

  if (langMissing === 0 && langExtra === 0) {
    console.log(`✅ ${lang}: fully in sync`);
  } else {
    console.log(
      `   📊 ${lang} total: ${langMissing} missing, ${langExtra} extra\n`
    );
  }

  totalMissing += langMissing;
  totalExtra += langExtra;
}

console.log(`\n${"─".repeat(40)}`);
console.log(
  `Total: ${totalMissing} missing key(s), ${totalExtra} extra key(s)\n`
);
process.exit(totalMissing > 0 ? 1 : 0);

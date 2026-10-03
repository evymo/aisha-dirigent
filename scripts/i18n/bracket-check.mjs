#!/usr/bin/env node
/**
 * Bracket Placeholder Checker
 *
 * Detects [English text] bracket placeholders in non-English translations.
 * These indicate untranslated strings that were left as placeholders.
 *
 * Usage:
 *   node scripts/i18n/bracket-check.mjs           # Report only
 *   node scripts/i18n/bracket-check.mjs --strict   # Fail if found (CI gate)
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEGMENTS_DIR = path.join(ROOT, "src", "i18n", "segments");

const isStrict = process.argv.includes("--strict");
const CANONICAL_LANG = "en";
const BRACKET_REGEX = /\[[A-Z][^\]]{2,}\]/g;

let totalFound = 0;

console.log("\n🔍 Bracket Placeholder Check\n");

const langs = readdirSync(SEGMENTS_DIR).filter(
  (d) =>
    d !== CANONICAL_LANG &&
    existsSync(path.join(SEGMENTS_DIR, d)) &&
    readdirSync(path.join(SEGMENTS_DIR, d)).some((f) => f.endsWith(".json"))
);

function scanObject(obj, prefix = "") {
  const results = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      const matches = value.match(BRACKET_REGEX);
      if (matches) {
        results.push({ key: fullKey, value, matches });
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      results.push(...scanObject(value, fullKey));
    }
  }
  return results;
}

for (const lang of langs) {
  const langDir = path.join(SEGMENTS_DIR, lang);
  const files = readdirSync(langDir).filter((f) => f.endsWith(".json"));
  let langTotal = 0;

  for (const file of files) {
    const content = JSON.parse(
      readFileSync(path.join(langDir, file), "utf-8")
    );
    const placeholders = scanObject(content);
    if (placeholders.length > 0) {
      if (langTotal === 0) console.log(`📄 ${lang}/`);
      for (const p of placeholders) {
        console.log(`   ${file} → ${p.key}: ${p.matches.join(", ")}`);
        langTotal++;
      }
    }
  }

  if (langTotal > 0) {
    console.log(`   → ${langTotal} placeholder(s) in ${lang}\n`);
    totalFound += langTotal;
  }
}

if (totalFound === 0) {
  console.log("✅ No bracket placeholders found\n");
} else {
  console.log(`\n⚠️  Total: ${totalFound} bracket placeholder(s) found`);
  if (isStrict) {
    console.error("❌ Strict mode: failing due to bracket placeholders\n");
    process.exit(1);
  }
  console.log(
    "   Fix: DEEPL_AUTH_KEY=... npm run i18n:segments:translate-missing -- --retranslate-identical\n"
  );
}

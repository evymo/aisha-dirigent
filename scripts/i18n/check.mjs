#!/usr/bin/env node
/**
 * i18n Gate Check
 *
 * Validates i18n segments: builds locales from segments, checks key parity,
 * detects bracket placeholders, and ensures all languages are in sync.
 *
 * Usage:
 *   node scripts/i18n/check.mjs
 *   npm run i18n:check
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Errors found
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEGMENTS_DIR = path.join(ROOT, "src", "i18n", "segments");
const LOCALES_DIR = path.join(ROOT, "src", "i18n", "locales");

const CANONICAL_LANG = "en";
const SUPPORTED_LANGS = ["en", "cs", "de", "fr", "ru", "th"];

let errors = 0;
let warnings = 0;

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

function loadSegments(lang) {
  const langDir = path.join(SEGMENTS_DIR, lang);
  if (!existsSync(langDir)) return null;

  let merged = {};
  const files = readdirSync(langDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const file of files) {
    const content = JSON.parse(
      readFileSync(path.join(langDir, file), "utf-8")
    );
    merged = deepMerge(merged, content);
  }
  return merged;
}

function findBracketPlaceholders(obj, path = "") {
  const found = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (typeof value === "string" && /\[[A-Z]/.test(value)) {
      found.push({ key: fullPath, value });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      found.push(...findBracketPlaceholders(value, fullPath));
    }
  }
  return found;
}

console.log("\n🌍 i18n Gate Check\n");

// 1. Check segment directories exist
console.log("1️⃣  Checking segment directories...");
for (const lang of SUPPORTED_LANGS) {
  const langDir = path.join(SEGMENTS_DIR, lang);
  if (!existsSync(langDir)) {
    console.error(`   ❌ Missing segment directory: ${lang}/`);
    errors++;
  }
}

// 2. Check segment file parity
console.log("2️⃣  Checking segment file parity...");
const canonicalFiles = readdirSync(path.join(SEGMENTS_DIR, CANONICAL_LANG))
  .filter((f) => f.endsWith(".json"))
  .sort();

for (const lang of SUPPORTED_LANGS) {
  if (lang === CANONICAL_LANG) continue;
  const langDir = path.join(SEGMENTS_DIR, lang);
  if (!existsSync(langDir)) continue;

  const langFiles = readdirSync(langDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const missingFiles = canonicalFiles.filter((f) => !langFiles.includes(f));
  const extraFiles = langFiles.filter((f) => !canonicalFiles.includes(f));

  if (missingFiles.length > 0) {
    console.warn(`   ⚠️  ${lang}: missing segment files: ${missingFiles.join(", ")}`);
    warnings++;
  }
  if (extraFiles.length > 0) {
    console.warn(`   ⚠️  ${lang}: extra segment files: ${extraFiles.join(", ")}`);
    warnings++;
  }
}

// 3. Check key parity
console.log(`3️⃣  Checking key parity against ${CANONICAL_LANG}...`);
const canonicalData = loadSegments(CANONICAL_LANG);
if (!canonicalData) {
  console.error(`   ❌ Cannot load canonical language (${CANONICAL_LANG})`);
  process.exit(1);
}

const canonicalKeys = new Set(flattenKeys(canonicalData));
console.log(`   📊 ${CANONICAL_LANG}: ${canonicalKeys.size} keys`);

for (const lang of SUPPORTED_LANGS) {
  if (lang === CANONICAL_LANG) continue;
  const langData = loadSegments(lang);
  if (!langData) continue;

  const langKeys = new Set(flattenKeys(langData));
  const missing = [...canonicalKeys].filter((k) => !langKeys.has(k));
  const extra = [...langKeys].filter((k) => !canonicalKeys.has(k));

  if (missing.length > 0) {
    console.warn(
      `   ⚠️  ${lang}: ${missing.length} missing key(s) (first 5: ${missing.slice(0, 5).join(", ")})`
    );
    warnings++;
  }
  if (extra.length > 0) {
    console.warn(
      `   ⚠️  ${lang}: ${extra.length} extra key(s) (first 5: ${extra.slice(0, 5).join(", ")})`
    );
    warnings++;
  }
  if (missing.length === 0 && extra.length === 0) {
    console.log(`   ✅ ${lang}: ${langKeys.size} keys (in sync)`);
  }
}

// 4. Check bracket placeholders
console.log("4️⃣  Checking for bracket placeholders...");
for (const lang of SUPPORTED_LANGS) {
  if (lang === CANONICAL_LANG) continue;
  const langData = loadSegments(lang);
  if (!langData) continue;

  const brackets = findBracketPlaceholders(langData);
  if (brackets.length > 0) {
    console.warn(
      `   ⚠️  ${lang}: ${brackets.length} bracket placeholder(s) found`
    );
    brackets.slice(0, 3).forEach((b) => {
      console.warn(`      ${b.key}: "${b.value.substring(0, 60)}..."`);
    });
    warnings++;
  }
}

// 5. Build locales from segments
console.log("5️⃣  Building locales from segments...");
let built = 0;
for (const lang of SUPPORTED_LANGS) {
  const data = loadSegments(lang);
  if (!data) continue;

  const outputPath = path.join(LOCALES_DIR, `${lang}.json`);
  const newContent = JSON.stringify(data, null, 2) + "\n";

  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, "utf-8");
    if (existing === newContent) {
      continue; // No changes
    }
  }

  writeFileSync(outputPath, newContent);
  built++;
  console.log(`   📝 ${lang}.json updated`);
}
if (built === 0) {
  console.log("   ✅ All locales are up to date");
}

// 6. DB content-translation seed parity
console.log("6️⃣  Checking content SQL seed parity...");
try {
  const { execSync } = await import("child_process");
  execSync("node scripts/i18n/sql-seed-check.mjs", {
    cwd: ROOT,
    stdio: "pipe",
  });
  console.log("   ✅ Content SQL seed parity: PASS");
} catch (sqlErr) {
  const output = sqlErr.stdout ? sqlErr.stdout.toString() : "";
  const driftMatch = output.match(/(\d+) drift\(s\) found/);
  const driftCount = driftMatch ? driftMatch[1] : "?";
  console.error(
    `   ❌ Content SQL seed parity: ${driftCount} drift(s) found`
  );
  console.error(
    "      Run: node scripts/i18n/sql-seed-check.mjs for details"
  );
  errors++;
}

// Summary
console.log(
  `\n${errors === 0 ? "✅" : "❌"} i18n check: ${errors} error(s), ${warnings} warning(s)\n`
);
process.exit(errors > 0 ? 1 : 0);

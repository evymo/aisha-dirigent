#!/usr/bin/env node
/**
 * i18n Value Renamer — rename terms in i18n segment VALUES (not keys).
 *
 * Supports language-specific replacement rules with full regex power,
 * designed for Czech declension and other morphologically rich languages.
 *
 * Usage:
 *   node scripts/i18n/rename-value.mjs --config=scripts/i18n/rename-configs/example.json [--dry-run] [--langs=cs,en] [--segments=admin,research]
 *
 * Config JSON format:
 * {
 *   "description": "Rename Study → Cluster",
 *   "rules": {
 *     "*": [
 *       { "from": "Study", "to": "Cluster" },
 *       { "from": "Studies", "to": "Clusters" }
 *     ],
 *     "cs": [
 *       { "from": "studie", "to": "cluster", "note": "nom.sg" },
 *       { "from": "ve clusterůch", "to": "v clusterech", "note": "fix wrong loc.pl" },
 *       { "from": "Klinická clustery", "to": "Klinický cluster", "note": "fem→masc adj" }
 *     ]
 *   }
 * }
 *
 * Rules under "*" apply to all languages. Language-specific rules override.
 * Each rule: { from: string (plain text or /regex/flags), to: string, note?: string }
 * Regex: prefix "from" with "/" and end with "/flags" (e.g., "/\\bStudy\\b/gi").
 *
 * Czech declension reference (masculine inanimate, hard pattern):
 *   sg: cluster (nom/acc), clusteru (gen/dat/loc), clusterem (inst)
 *   pl: clustery (nom/acc), clusterů (gen), clusterům (dat), clusterech (loc), clustery (inst)
 *
 * @module
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";

const SEGMENTS_DIR = "src/i18n/segments";

// ── CLI args ──
const DRY_RUN = process.argv.includes("--dry-run");
const CONFIG_ARG = process.argv.find((a) => a.startsWith("--config="));
const LANGS_ARG = process.argv.find((a) => a.startsWith("--langs="));
const SEGMENTS_ARG = process.argv.find((a) => a.startsWith("--segments="));

if (!CONFIG_ARG) {
  console.error(
    "Usage: node scripts/i18n/rename-value.mjs --config=path/to/config.json [--dry-run] [--langs=cs,en] [--segments=admin]"
  );
  process.exit(1);
}

const configPath = CONFIG_ARG.replace("--config=", "");
if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const langFilter = LANGS_ARG
  ? LANGS_ARG.replace("--langs=", "").split(",").map((v) => v.trim()).filter(Boolean)
  : null;
const segFilter = SEGMENTS_ARG
  ? SEGMENTS_ARG.replace("--segments=", "").split(",").map((v) => v.trim()).filter(Boolean)
  : null;

// ── Helpers ──

/**
 * Parse a rule's "from" field into a regex or plain string replacer.
 * @param {string} from - Plain text or /regex/flags
 * @returns {{ regex: RegExp | null, plain: string | null }}
 */
function parseFrom(from) {
  const regexMatch = from.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    return { regex: new RegExp(regexMatch[1], regexMatch[2]), plain: null };
  }
  return { regex: null, plain: from };
}

/**
 * Apply a single rule to a string value.
 * @param {string} value
 * @param {{ from: string, to: string }} rule
 * @returns {{ result: string, count: number }}
 */
function applyRule(value, rule) {
  const { regex, plain } = parseFrom(rule.from);
  let count = 0;

  if (regex) {
    const matches = value.match(regex);
    count = matches ? matches.length : 0;
    const result = value.replace(regex, rule.to);
    return { result, count };
  }

  // Plain text: replace all occurrences
  let result = value;
  while (result.includes(plain)) {
    result = result.replace(plain, rule.to);
    count++;
    // Safety: if from === to, break
    if (plain === rule.to) break;
  }
  return { result, count };
}

/**
 * Recursively walk JSON object, applying rules to string values.
 * @param {object} obj
 * @param {Array<{ from: string, to: string }>} rules
 * @param {string} path - dot path for reporting
 * @returns {{ obj: object, changes: Array<{ path: string, from: string, to: string }> }}
 */
function walkAndReplace(obj, rules, path = "") {
  const changes = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (typeof value === "string") {
      let current = value;
      for (const rule of rules) {
        const { result, count } = applyRule(current, rule);
        if (count > 0) {
          changes.push({ path: fullPath, from: current, to: result, rule: rule.from });
          current = result;
        }
      }
      if (current !== value) {
        obj[key] = current;
      }
    } else if (typeof value === "object" && value !== null) {
      const nested = walkAndReplace(value, rules, fullPath);
      changes.push(...nested.changes);
    }
  }

  return { obj, changes };
}

// ── Main ──

console.log(`\n🔄 i18n Value Renamer${DRY_RUN ? " (DRY RUN)" : ""}`);
console.log(`   Config: ${configPath}`);
if (config.description) console.log(`   Description: ${config.description}`);
console.log("");

const allLangs = readdirSync(SEGMENTS_DIR).filter((d) => {
  const full = join(SEGMENTS_DIR, d);
  try {
    return readdirSync(full).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
});

const langs = langFilter ? allLangs.filter((l) => langFilter.includes(l)) : allLangs;
let totalChanges = 0;
let totalFiles = 0;

for (const lang of langs) {
  const langDir = join(SEGMENTS_DIR, lang);
  const files = readdirSync(langDir).filter((f) => f.endsWith(".json"));
  const filtered = segFilter
    ? files.filter((f) => segFilter.some((s) => f === `${s}.json`))
    : files;

  // Build rules: global (*) + language-specific
  const globalRules = config.rules?.["*"] || [];
  const langRules = config.rules?.[lang] || [];
  const rules = [...langRules, ...globalRules]; // lang-specific first (higher priority)

  if (rules.length === 0) continue;

  for (const file of filtered) {
    const filePath = join(langDir, file);
    const content = readFileSync(filePath, "utf8");
    const data = JSON.parse(content);

    const { changes } = walkAndReplace(data, rules);

    if (changes.length > 0) {
      totalChanges += changes.length;
      totalFiles++;

      const segment = basename(file, ".json");
      console.log(`  📝 ${lang}/${segment}: ${changes.length} change(s)`);

      if (DRY_RUN) {
        for (const c of changes.slice(0, 10)) {
          const fromSnip = c.from.length > 60 ? c.from.slice(0, 60) + "…" : c.from;
          const toSnip = c.to.length > 60 ? c.to.slice(0, 60) + "…" : c.to;
          console.log(`     ${c.path}: "${fromSnip}" → "${toSnip}"`);
        }
        if (changes.length > 10) {
          console.log(`     ... and ${changes.length - 10} more`);
        }
      }

      if (!DRY_RUN) {
        writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
      }
    }
  }
}

console.log(
  `\n${DRY_RUN ? "🔍 Would change" : "✅ Changed"}: ${totalChanges} value(s) in ${totalFiles} file(s)\n`
);

if (DRY_RUN && totalChanges > 0) {
  console.log("Run without --dry-run to apply changes.\n");
}

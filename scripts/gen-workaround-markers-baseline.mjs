#!/usr/bin/env node
/**
 * Generate baseline snapshot for workaround-markers.gate.test.ts
 * Run: node scripts/gen-workaround-markers-baseline.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { porovnej } from "./lib/razeni.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/tests/gates/workaround-markers.baseline.json");

const SCAN_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "services"),
  path.join(ROOT, "packages"),
  path.join(ROOT, "infra"),
  path.join(ROOT, "supabase"),
];

const FILE_EXT = /\.(ya?ml|sh|ts|tsx|js|jsx|mjs|cjs|sql|json)$/;

const SKIP_DIR_PARTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".aisha",
  "archive",
  "trash",
  "__tests__",
  "tests",
  "test",
  "e2e",
  "fixtures",
  "mocks",
  "playwright-report",
  "test-results",
  "reports",
  ".git",
  "coverage",
  "offline-knowledge",
  "knowledge-extraction",
  "workbench",
]);

const MARKERS = [
  /\bworkaround\b/gi,
  /\bHACK\b(?!ER|ATHON|INTOSH)/g,
  /\bXXX\b(?!X)/g,
  /\bFIXME\b/g,
  /@ts-ignore\b/g,
  /@ts-nocheck\b/g,
];

const SELF_REFS = new Set([
  "src/tests/gates/workaround-markers.gate.test.ts",
  "src/tests/gates/code-hygiene.gate.test.ts",
  "src/tests/gates/silent-degradation.gate.test.ts",
  "scripts/gen-workaround-markers-baseline.mjs",
]);

function shouldSkipPath(rel) {
  const parts = rel.split(path.sep);
  for (const p of parts) if (SKIP_DIR_PARTS.has(p)) return true;
  if (/\.(test|spec)\.[a-z]+$/.test(rel)) return true;
  if (/\.baseline\.json$/.test(rel)) return true;
  if (/(package-lock|bun\.lockb)$/.test(rel)) return true;
  return false;
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`walk: nelze přečíst ${dir}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (shouldSkipPath(rel)) continue;
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && FILE_EXT.test(entry.name)) acc.push(full);
  }
}

const files = [];
for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  walk(dir, files);
}

const perFile = {};
let total = 0;
for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  if (SELF_REFS.has(rel)) continue;
  let content;
  try {
    content = fs.readFileSync(abs, "utf-8");
  } catch (err) {
    console.warn(`read: nelze přečíst ${rel}: ${err.message}`);
    continue;
  }
  let count = 0;
  for (const line of content.split("\n")) {
    for (const re of MARKERS) {
      const m = line.match(re);
      if (m) count += m.length;
    }
  }
  if (count > 0) {
    perFile[rel] = count;
    total += count;
  }
}

const payload = {
  _generated: new Date().toISOString(),
  _note:
    "Baseline for workaround-markers.gate.test.ts. Regenerate after fixing markers: " +
    "`node scripts/gen-workaround-markers-baseline.mjs`. Number must only DECREASE.",
  totalMarkers: total,
  totalFiles: Object.keys(perFile).length,
  perFile: Object.fromEntries(
    Object.entries(perFile).sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : porovnej(a[0], b[0]))),
  ),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`Baseline written: ${OUT}`);
console.log(`  total markers: ${total}`);
console.log(`  total files: ${Object.keys(perFile).length}`);
console.log(`  top 10:`);
for (const [f, c] of Object.entries(perFile)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(`    ${c.toString().padStart(4)}  ${f}`);
}

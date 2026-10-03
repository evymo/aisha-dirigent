/**
 * Auto-fixer for SQL RETURNS TABLE type mismatches.
 *
 * Reads type-checker issues and applies fixes to function SQL files.
 * Only fixes mechanical mismatches (timestamp→timestamptz, text→text[], etc.)
 *
 * Usage: node scripts/db/func-manager/fix-return-types.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { checkAllFunctions, buildSchemaRegistry } from './lib/type-checker.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DRY_RUN = process.argv.includes('--dry-run');

// Enum types — text→enum is OK in RETURNS TABLE, skip
const ENUM_TYPES = new Set();
const enumDir = path.join(ROOT, 'aisha/db/sql/enums');
if (fs.existsSync(enumDir)) {
  for (const file of fs.readdirSync(enumDir)) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(enumDir, file), 'utf-8');
    const m = sql.match(/CREATE\s+TYPE\s+(?:public\.)?(\w+)\s+AS\s+ENUM/i);
    if (m) ENUM_TYPES.add(m[1].toLowerCase());
  }
}

const registry = buildSchemaRegistry(ROOT);
const issues = checkAllFunctions(ROOT, registry);
const typeMismatches = issues.filter(i => i.rule === 'TYPE_MISMATCH');

// Filter to fixable issues only
const fixable = typeMismatches.filter(i => {
  const ret = i.details.returnType.toLowerCase();
  const tbl = i.details.tableType.toLowerCase();
  // text → enum is OK, skip
  if (ret === 'text' && ENUM_TYPES.has(tbl)) return false;
  // Same enum → same, skip
  if (ENUM_TYPES.has(ret) && ret === tbl) return false;
  return true;
});

// Normalize target type for the fix
function normalizeTargetType(tableType) {
  let t = tableType.toLowerCase().trim();
  // TIMESTAMPTZ → timestamp with time zone
  if (t === 'timestamptz') return 'timestamptz';
  if (t === 'timestamp with time zone') return 'timestamptz';
  return t;
}

// Group fixes by file
const byFile = {};
for (const issue of fixable) {
  const filePath = path.join(ROOT, issue.file);
  if (!byFile[filePath]) byFile[filePath] = [];
  byFile[filePath].push(issue);
}

let totalFixed = 0;
let totalFiles = 0;
const errors = [];

for (const [filePath, fileIssues] of Object.entries(byFile)) {
  let sql = fs.readFileSync(filePath, 'utf-8');

  // Find RETURNS TABLE block
  const returnsMatch = sql.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)/i);
  if (!returnsMatch) {
    errors.push(`Cannot find RETURNS TABLE in ${filePath}`);
    continue;
  }

  let returnsBlock = returnsMatch[1];
  let changed = false;

  // Build a unique fix map: column → target type (pick the most specific one)
  const colFixes = new Map();
  for (const issue of fileIssues) {
    const colName = issue.details.column.toLowerCase();
    const targetType = normalizeTargetType(issue.details.tableType);

    // If we already have a fix for this column, prefer array types and more specific
    if (!colFixes.has(colName)) {
      colFixes.set(colName, targetType);
    }
  }

  for (const [colName, targetType] of colFixes) {
    // Match the column declaration in RETURNS TABLE: "colName oldType"
    // Handles multi-word types (timestamp with time zone, double precision, etc.)
    // and array suffix []
    const colPattern = new RegExp(
      `(\\b${colName}\\b)\\s+((?:(?:timestamp|time)\\s+with(?:out)?\\s+time\\s+zone|double\\s+precision|character\\s+varying(?:\\s*\\(\\d+\\))?)\\s*(?:\\[\\])?|\\w+(?:\\s*\\([^)]*\\))?(?:\\s*\\[\\])?)`,
      'i',
    );
    const colMatch = returnsBlock.match(colPattern);
    if (!colMatch) continue;

    const oldType = colMatch[2].trim().toLowerCase();
    const newNorm = targetType;

    // Only fix if the old type actually differs from target
    if (oldType === newNorm) continue;

    // Apply the fix
    returnsBlock = returnsBlock.replace(colPattern, `$1 ${targetType}`);
    changed = true;
    totalFixed++;
  }

  if (changed) {
    // Replace the RETURNS TABLE block in the original SQL
    const newSql = sql.replace(
      /RETURNS\s+TABLE\s*\(([\s\S]*?)\)/i,
      `RETURNS TABLE(${returnsBlock})`,
    );

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would fix ${filePath}`);
    } else {
      fs.writeFileSync(filePath, newSql, 'utf-8');
    }
    totalFiles++;
  }
}

console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Fixed ${totalFixed} column types across ${totalFiles} files`);
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  errors.forEach(e => console.log(`  ${e}`));
}

#!/usr/bin/env node
/**
 * Scan SoT indexes for orphaned columns/tables.
 * Usage: node scripts/db/scan-orphaned-indexes.mjs
 */
import fs from "fs";
import path from "path";

const tablesDir = "aisha/db/sql/tables";
const indexDir = "aisha/db/sql/indexes";

// Load all table columns
const tableCols = {};
for (const f of fs.readdirSync(tablesDir).filter((f) => f.endsWith(".sql"))) {
  const sql = fs.readFileSync(path.join(tablesDir, f), "utf8");
  const tblMatch = sql.match(/CREATE TABLE[^(]+\(([^;]*?\n\);?)/s);
  if (!tblMatch) continue;
  const tableName = f.replace(".sql", "");
  const cols = new Set();
  const body = tblMatch[1];
  for (const line of body.split("\n")) {
    const m = line.match(
      /^\s+(\w+)\s+(uuid|text|int|bool|json|timestamp|numeric|bigint|small|varchar|char|float|double|real|serial|vector|bytea|date|time|inet|cidr|macaddr|tstzrange|oid|name|point|interval)/i
    );
    if (m) cols.add(m[1].toLowerCase());
  }
  tableCols[tableName] = cols;
}

// Check all index files
const orphaned = [];
for (const f of fs.readdirSync(indexDir).filter((f) => f.endsWith(".sql"))) {
  const sql = fs.readFileSync(path.join(indexDir, f), "utf8");
  // Extract table name from ON [public.]table_name
  const tblMatch = sql.match(/ON\s+(?:public\.)?(\w+)/i);
  if (!tblMatch) continue;
  const table = tblMatch[1].toLowerCase();
  // Extract column names from parenthesized list
  const colsMatch = sql.match(/\(([^)]+)\)/);
  if (!colsMatch) continue;
  const idxCols = colsMatch[1]
    .split(",")
    .map((c) => c.trim().replace(/\s+.*/, "").toLowerCase());

  if (!tableCols[table]) {
    orphaned.push(`${f} -> table "${table}" NOT IN SoT`);
    continue;
  }
  for (const col of idxCols) {
    // Skip expression-based index columns
    if (
      !col ||
      col === "lower" ||
      col.startsWith("(") ||
      col === "coalesce" ||
      col === "date_trunc"
    )
      continue;
    if (!tableCols[table].has(col)) {
      orphaned.push(`${f} -> column "${col}" not in table "${table}"`);
    }
  }
}

if (orphaned.length === 0) {
  console.log("✅ No orphaned indexes found");
} else {
  console.error(`❌ Found ${orphaned.length} orphaned index issue(s):`);
  for (const o of orphaned) console.error(`   ${o}`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * DB Manager — SQL Linter
 *
 * Extended SQL source-of-truth linting beyond func-validate.mjs.
 * Checks all SQL categories: functions, tables, policies, triggers, indexes, enums.
 *
 * Usage:
 *   node scripts/db/db-manager/lint.mjs
 *   npm run db-mgr:lint
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha", "db", "sql");

const CATEGORIES = ["functions", "tables", "policies", "triggers", "indexes", "enums", "views"];

let errors = 0;
let warnings = 0;
let checked = 0;

function lint(category, file, content) {
  const issues = [];

  switch (category) {
    case "functions": {
      if (/SECURITY\s+DEFINER/i.test(content) && !/search_path/i.test(content)) {
        issues.push({ severity: "error", msg: "SECURITY DEFINER without SET search_path" });
      }
      if (/GRANT.*TO\s+anon/i.test(content) && !/SECURITY\s+DEFINER/i.test(content)) {
        issues.push({ severity: "error", msg: "GRANT TO anon requires SECURITY DEFINER" });
      }
      if (/\.select\s*\(\s*["']\*["']\s*\)/i.test(content)) {
        issues.push({ severity: "warning", msg: "Uses SELECT * — prefer explicit columns" });
      }
      if (!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE [OR REPLACE] FUNCTION" });
      }
      // COMMENT/REVOKE/GRANT ON FUNCTION without arg type list
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (/^COMMENT\s+ON\s+FUNCTION\s+[\w.]+\s+IS/i.test(trimmed)) {
          issues.push({ severity: "error", msg: "COMMENT ON FUNCTION without arg type list" });
        }
        if (/REVOKE.*ON\s+FUNCTION\s+[\w.]+\s+FROM/i.test(trimmed)) {
          issues.push({ severity: "error", msg: "REVOKE ON FUNCTION without arg type list" });
        }
        if (/^GRANT.*ON\s+FUNCTION\s+[\w.]+\s+TO/i.test(trimmed)) {
          issues.push({ severity: "error", msg: "GRANT ON FUNCTION without arg type list" });
        }
      }
      break;
    }
    case "tables": {
      if (!/CREATE\s+TABLE/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE TABLE" });
      }
      if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(content)) {
        issues.push({ severity: "warning", msg: "Missing ENABLE ROW LEVEL SECURITY" });
      }
      break;
    }
    case "policies": {
      if (!/CREATE\s+POLICY/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE POLICY" });
      }
      break;
    }
    case "triggers": {
      if (!/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE TRIGGER" });
      }
      break;
    }
    case "indexes": {
      if (!/CREATE\s+(UNIQUE\s+)?INDEX/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE INDEX" });
      }
      if (!/^--\s*Index:/m.test(content)) {
        issues.push({ severity: "warning", msg: 'Missing "-- Index:" header marker' });
      }
      break;
    }
    case "enums": {
      if (!/CREATE\s+TYPE.*AS\s+ENUM/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE TYPE ... AS ENUM" });
      }
      break;
    }
    case "views": {
      if (!/CREATE\s+(OR\s+REPLACE\s+)?(VIEW|MATERIALIZED\s+VIEW)/i.test(content)) {
        issues.push({ severity: "error", msg: "Missing CREATE VIEW" });
      }
      break;
    }
  }

  return issues;
}

console.log("🔍 DB Manager — SQL Lint\n");

for (const category of CATEGORIES) {
  const dir = path.join(SQL_DIR, category);
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  for (const file of files) {
    checked++;
    const content = readFileSync(path.join(dir, file), "utf-8");
    const issues = lint(category, file, content);

    for (const issue of issues) {
      if (issue.severity === "error") errors++;
      else warnings++;

      const icon = issue.severity === "error" ? "❌" : "⚠️";
      console.log(`  ${icon} ${category}/${file}: ${issue.msg}`);
    }
  }
}

console.log(`\n📊 Checked ${checked} files across ${CATEGORIES.length} categories`);
console.log(`  ❌ Errors: ${errors}`);
console.log(`  ⚠️  Warnings: ${warnings}`);

if (errors > 0) {
  console.log("\n💡 Fix errors before committing SQL changes.");
  process.exit(1);
}

process.exit(0);

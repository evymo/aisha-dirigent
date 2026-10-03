#!/usr/bin/env node
/**
 * SQL Function Validator
 *
 * Validates SQL function source files in aisha/db/sql/functions/ against
 * coding standards: SECURITY DEFINER with search_path, proper GRANTs,
 * explicit column selection, etc.
 *
 * Usage:
 *   node scripts/db/func-validate.mjs
 *   npm run func:validate
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

/** Tělo bez SQL komentářů — pravidla o kódu nesmí padat na prózu v hlavičce. */
function bezKomentaru(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FUNCTIONS_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`❌ Functions directory not found: ${FUNCTIONS_DIR}`);
  process.exit(1);
}

const files = readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith(".sql"));
let errors = 0;
let warnings = 0;

console.log(`\n🔍 Validating ${files.length} SQL function(s)...\n`);

for (const file of files) {
  const filePath = path.join(FUNCTIONS_DIR, file);
  const content = readFileSync(filePath, "utf-8");
  const issues = [];

  // Check SECURITY DEFINER functions have SET search_path
  if (
    content.includes("SECURITY DEFINER") &&
    !content.includes("search_path")
  ) {
    issues.push({
      severity: "error",
      msg: "SECURITY DEFINER without SET search_path",
    });
  }

  // Check for GRANT TO anon without SECURITY DEFINER
  if (
    content.toLowerCase().includes("grant") &&
    content.toLowerCase().includes("to anon") &&
    !content.includes("SECURITY DEFINER")
  ) {
    issues.push({
      severity: "error",
      msg: "GRANT TO anon requires SECURITY DEFINER",
    });
  }

  // Check for SELECT * in function body
  //
  // Komentáře se odstraňují ZÁMĚRNĚ: pravidlo mluví o KÓDU, a hlavička, která
  // vysvětluje „tahle funkce SELECT * nepoužívá", je dokumentace, ne porušení.
  // Bez toho hlásí detektor tím hlasitěji, čím líp je funkce popsaná — a takové
  // varování se přestane číst (měřeno 2026-08-02 na get_public_service_status).
  if (/SELECT\s+\*/i.test(bezKomentaru(content))) {
    issues.push({
      severity: "warning",
      msg: "Uses SELECT * — prefer explicit columns",
    });
  }

  // Check for REVOKE ALL before GRANT
  if (
    content.toLowerCase().includes("grant execute") &&
    !content.toLowerCase().includes("revoke all")
  ) {
    issues.push({
      severity: "warning",
      msg: "GRANT without REVOKE ALL ON FUNCTION ... FROM PUBLIC",
    });
  }

  // Check for missing LANGUAGE declaration
  if (
    content.includes("CREATE OR REPLACE FUNCTION") &&
    !content.toLowerCase().includes("language ")
  ) {
    issues.push({ severity: "error", msg: "Missing LANGUAGE declaration" });
  }

  // Check for COMMENT/REVOKE/GRANT ON FUNCTION without arg type list
  // (causes "function name is not unique" when overloads exist)
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

  if (issues.length > 0) {
    console.log(`📄 ${file}`);
    for (const issue of issues) {
      const icon = issue.severity === "error" ? "❌" : "⚠️ ";
      console.log(`   ${icon} ${issue.msg}`);
      if (issue.severity === "error") errors++;
      else warnings++;
    }
  }
}

console.log(
  `\n${errors === 0 ? "✅" : "❌"} ${files.length} files checked: ${errors} error(s), ${warnings} warning(s)\n`
);
process.exit(errors > 0 ? 1 : 0);

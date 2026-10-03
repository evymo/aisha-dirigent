#!/usr/bin/env node
/**
 * DB Manager — Access Flow Analyzer
 *
 * Analyzes SQL function security: SECURITY DEFINER patterns, anon grants,
 * auth checks, consent validation, RLS policies, and hook authorization.
 *
 * Generates docs/db-structure/access-flow-report.json
 *
 * Usage:
 *   node scripts/db/db-manager/access.mjs [--static]
 *   npm run db-mgr:access [-- --static]
 *
 * --static: File-based analysis only (no DB connection required)
 *
 * @module
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
// Jeden domov pravidla „rozhoduj o KÓDU, ne o komentářích" (viz sql-comments.mjs).
import { stripSqlComments } from "../lib/sql-comments.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportOutput } from "./lib/reportPaths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha", "db", "sql");
const SRC_DIR = path.join(ROOT, "src");
const { reportDir: REPORT_DIR, reportPath: REPORT_PATH } = resolveReportOutput(
  ROOT,
  "access-flow-report.json",
);

const isStatic = process.argv.includes("--static");

/* ---------- sensitive data table detection ---------- */

const PHI_TABLES = new Set([
  "health_check_ins", "lab_results", "medications", "medical_records",
  "health_goals", "biometric_data", "treatment_plans", "health_metrics",
  "biomarker_readings", "biomarker_results", "subjective_evaluations",
  "health_questionnaire_responses", "diary_entries",
]);

/* ---------- SQL function analysis ---------- */


function analyzeFunctions() {
  const funcDir = path.join(SQL_DIR, "functions");
  if (!existsSync(funcDir)) return [];

  const issues = [];
  const files = readdirSync(funcDir).filter((f) => f.endsWith(".sql"));

  for (const file of files) {
    const content = stripSqlComments(readFileSync(path.join(funcDir, file), "utf-8"));
    const nameMatch = content.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)/i
    );
    const funcName = nameMatch ? nameMatch[1] : file.replace(".sql", "");

    const isSecDefiner = /SECURITY\s+DEFINER/i.test(content);
    // Auth check se hledá v KÓDU, ne v komentářích — naměřeno 2026-09-14: zmínka
    // „auth.uid()" v komentáři uznala za ověřenou i funkci bez jakékoli vazby na
    // volajícího. can_access_story a is_service_role jsou predikáty volajícího
    // stejně jako is_admin_or_staff (is_story_participant ne — bere uživatele parametrem).
    const code = content.replace(/--.*$/gm, "");
    const hasAuthUid = /auth\.uid\(\)|is_admin_or_staff\s*\(|can_access_story\s*\(|is_service_role\s*\(|current_setting\s*\(\s*'request\.jwt\.claim\.role'|get_jwt_role\s*\(/i.test(code);
    const hasSearchPath = /SET\s+search_path/i.test(content);
    const hasAnonGrant = /GRANT\s+EXECUTE.*TO\s+anon/i.test(content);
    const hasAuthenticatedGrant = /GRANT\s+EXECUTE.*TO\s+authenticated/i.test(content);
    const hasClientGrant = hasAnonGrant || hasAuthenticatedGrant;
    const hasConsentCheck = /has_data_sharing_consent/i.test(content);
    const accessesPhi = [...PHI_TABLES].some((t) =>
      new RegExp(`\\b${t}\\b`, "i").test(content)
    );

    // SEC_DEF_ANON_GRANT: SECURITY DEFINER + anon grant on sensitive function
    if (isSecDefiner && hasAnonGrant && accessesPhi) {
      issues.push({
        type: "SEC_DEF_ANON_GRANT",
        severity: "critical",
        function: funcName,
        file,
        message: `SECURITY DEFINER function "${funcName}" grants anon access and touches sensitive data`,
      });
    }

    // SEC_DEF_NO_AUTH: SECURITY DEFINER without auth check
    // Non-PHI functions get warning (best practice)
    // System/trigger functions (trigger_, backfill_, sync_, etc.) get warning even with PHI
    //
    // ⛔ DO 2026-09-12 tu stálo `hasClientGrant && !hasAnonGrant` — tedy INVERZE:
    // funkce dostupná ANONYMOVI (nejširší možná expozice) z nálezu VYPADLA.
    // Anonymní případ pokrýval jen SEC_DEF_ANON_GRANT, který navíc vyžaduje
    // dotek PHI tabulky; co není PHI, nehlásil nikdo. Změřený rozsah díry:
    // 67 funkcí v sql/functions/ bylo SECURITY DEFINER + GRANT anon + bez
    // kontroly, a mezi nimi `get_test_questions_localized`, která vydávala
    // KLÍČ SPRÁVNÝCH ODPOVĚDÍ certifikačního testu komukoli bez účtu.
    // Brána, která se dívá tím úžeji, čím je riziko větší, vyrábí klid.
    if (isSecDefiner && !hasAuthUid && hasClientGrant
        && !/\bRETURNS\s+trigger\b/i.test(content)) {
      // ⛔ SPOUŠTĚČ NENÍ KLIENTSKY VOLATELNÝ. `RETURNS trigger` jde spustit jen z triggeru
      // (přímé volání Postgres odmítne), takže stráž v těle by neměla koho odmítat a grant
      // na `authenticated` je zbytečný, ne díra. Jméno to nepozná — `trigger_` je konvence,
      // kterou `fn_notify_rule_change` nedodržuje; rozhoduje NÁVRATOVÝ TYP.
      const isTrigger = /\bRETURNS\s+trigger\b/i.test(content);
      const isSystemFunc = isTrigger
        || /^(trigger_|backfill_|sync_|calculate_|update_\w+_rankings|cron_|edge_database_)/i.test(funcName);
      issues.push({
        type: "SEC_DEF_NO_AUTH",
        // Závažnost zůstává na PHI ose (aby se nezměnil exit kód analyzátoru,
        // který v CI běží jako samostatný krok). Vymáhá se IDENTITOU: brána
        // security.gate.test.ts porovnává nálezy s revidovaným allowlistem,
        // takže NOVÉ jméno shodí běh, i když je to „jen" warning.
        severity: (accessesPhi && !isSystemFunc) ? "error" : "warning",
        function: funcName,
        file,
        anonGrant: hasAnonGrant,
        message: `SECURITY DEFINER function "${funcName}" has no auth.uid() check${hasAnonGrant ? " AND is callable by anon" : ""}`,
      });
    }

    // SEC_DEF_NO_CONSENT: accesses sensitive data without consent check
    // Only flag when p_user_id is a function PARAMETER (not local variable)
    // Skip if function has self-auth guard (auth.uid() compared to p_user_id = own-data access)
    if (accessesPhi && !hasConsentCheck && isSecDefiner) {
      const argsMatch = content.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?\w+\s*\(([^)]*)\)/is
      );
      const funcArgs = argsMatch ? argsMatch[1] : "";
      const hasUserIdParam = /p_user_id|p_target_user|p_member_id/i.test(funcArgs);
      const hasSelfAuthGuard = hasAuthUid && /auth\.uid\(\)\s*(?:<>|!=|=)\s*p_user_id/i.test(content);
      if (hasUserIdParam && !hasSelfAuthGuard) {
        issues.push({
          type: "SEC_DEF_NO_CONSENT",
          severity: "error",
          function: funcName,
          file,
          message: `Function "${funcName}" accesses sensitive data with user_id param but no consent check`,
        });
      }
    }

    // SEC_DEF_NO_SEARCH_PATH
    if (isSecDefiner && !hasSearchPath) {
      issues.push({
        type: "SEC_DEF_NO_SEARCH_PATH",
        severity: "error",
        function: funcName,
        file,
        message: `SECURITY DEFINER function "${funcName}" missing SET search_path`,
      });
    }
  }

  return issues;
}

/* ---------- RLS analysis ---------- */

function analyzeRls() {
  const tablesDir = path.join(SQL_DIR, "tables");
  const policiesDir = path.join(SQL_DIR, "policies");
  if (!existsSync(tablesDir)) return [];

  const issues = [];

  // Get all tables
  const tableFiles = readdirSync(tablesDir).filter((f) => f.endsWith(".sql"));
  const tableNames = new Set();

  for (const file of tableFiles) {
    const content = readFileSync(path.join(tablesDir, file), "utf-8");
    const nameMatch = content.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/i
    );
    if (nameMatch) tableNames.add(nameMatch[1].toLowerCase());

    // Check if RLS is enabled
    const tableName = nameMatch ? nameMatch[1] : file.replace(".sql", "");
    if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(content)) {
      if (PHI_TABLES.has(tableName.toLowerCase())) {
        issues.push({
          type: "PHI_TABLE_NO_RLS",
          severity: "critical",
          table: tableName,
          file,
          message: `Sensitive data table "${tableName}" does not have RLS enabled`,
        });
      }
    }
  }

  // Check for missing RLS policies
  if (existsSync(policiesDir)) {
    const policyFiles = readdirSync(policiesDir).filter((f) => f.endsWith(".sql"));
    const policyTables = new Set();

    for (const file of policyFiles) {
      const content = readFileSync(path.join(policiesDir, file), "utf-8");
      const tableMatch = content.match(/ON\s+(?:public\.)?(\w+)/i);
      if (tableMatch) policyTables.add(tableMatch[1].toLowerCase());
    }

    for (const phiTable of PHI_TABLES) {
      if (tableNames.has(phiTable) && !policyTables.has(phiTable)) {
        issues.push({
          type: "MISSING_RLS_POLICY",
          severity: "error",
          table: phiTable,
          operation: "ALL",
          message: `Sensitive data table "${phiTable}" exists but has no RLS policy files`,
        });
      }
    }
  }

  return issues;
}

/* ---------- Hook auth analysis ---------- */

function analyzeHookAuth() {
  const hooksDir = path.join(SRC_DIR, "hooks");
  if (!existsSync(hooksDir)) return [];

  const issues = [];

  function scanHooks(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        scanHooks(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;

      const filePath = path.join(dir, entry.name);
      const content = readFileSync(filePath, "utf-8");
      const relPath = path.relative(ROOT, filePath);

      // Check if hook accesses sensitive data via RPC
      // Use underscore-boundary matching to avoid false positives (e.g., "collaboration" matching "lab")
      const rpcCalls = content.match(/\.rpc\(\s*["'](\w+)["']/g) || [];
      const phiRpcs = rpcCalls.filter((call) => {
        const name = call.match(/["'](\w+)["']/)?.[1] || "";
        // Exclude reference data functions — they return public lookup data, not PHI
        if (/reference/i.test(name)) return false;
        return /(^|_)(health|lab|medical|biometric|biomarker|diary|medication)(_|$)/i.test(name);
      });

      if (phiRpcs.length > 0 && !/useAuth|useSession|auth\.uid/i.test(content)) {
        issues.push({
          type: "PHI_HOOK_NO_AUTH",
          severity: "warning",
          hook: relPath,
          message: `Hook "${relPath}" calls sensitive data RPCs but has no visible auth check`,
        });
      }
    }
  }

  scanHooks(hooksDir);
  return issues;
}

/* ---------- Main ---------- */

function main() {
  console.log(`🔐 Access Flow Analyzer${isStatic ? " (static mode)" : ""}\n`);

  const funcIssues = analyzeFunctions();
  const rlsIssues = analyzeRls();
  const hookIssues = analyzeHookAuth();
  const allIssues = [...funcIssues, ...rlsIssues, ...hookIssues];

  const summary = {
    critical: allIssues.filter((i) => i.severity === "critical").length,
    errors: allIssues.filter((i) => i.severity === "error").length,
    warnings: allIssues.filter((i) => i.severity === "warning").length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    analyzer: "db-mgr:access",
    version: "1.0.0",
    mode: isStatic ? "static" : "live",
    summary,
    issues: allIssues,
  };

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf-8");

  console.log(`📊 Results:`);
  console.log(`  Critical: ${summary.critical}`);
  console.log(`  Errors: ${summary.errors}`);
  console.log(`  Warnings: ${summary.warnings}`);
  console.log(`\n📝 Report: ${path.relative(ROOT, REPORT_PATH)}`);

  if (summary.critical > 0) process.exit(2);
  if (summary.errors > 0) process.exit(1);
  process.exit(0);
}

main();

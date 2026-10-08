/**
 * Validation Utilities for Database Schema Tests
 *
 * Inline utilities for Vitest tests - avoids import issues with scripts/ folder.
 *
 * Connectivity is environment-driven (see test-env-probe.ts): tests that need
 * raw psql access skip cleanly when no local PostgreSQL is reachable. Suppression
 * via AISHA_SKIP_DB_TESTS=1 env var.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
  isPgReachable,
  isAppleSilicon,
  checkMlxAvailable,
} from "./test-env-probe";

/**
 * Triggery, které text seedu VYPNE a do konce téhož textu znovu NEZAPNE.
 *
 * ⛔ NAMĚŘENO 2026-09-24: core/00_setup.sql vypínal update_streak_on_health_checkin
 * a zapínal ho až demo/00_prod_users.sql. Produkční profil `instance` demo vrstvu
 * nespouští, takže po KAŽDÉM nasazení zůstal trigger na produkci vypnutý (tgenabled
 * = 'D'). Pár vypni/zapni proto musí ležet v JEDNOM souboru — žádné skládání
 * profilů ho pak nerozdělí.
 */
export function vypnuteTriggeryBezZapnuti(sql: string): string[] {
  const bezKomentaru = sql.replace(/--.*$/gm, "");
  const udalosti = [...bezKomentaru.matchAll(/\b(DISABLE|ENABLE)\s+TRIGGER\s+("?[A-Za-z0-9_]+"?)/gi)];
  const vypnute = new Set<string>();
  for (const [, akce, jmeno] of udalosti) {
    const t = jmeno.replace(/"/g, "").toLowerCase();
    if (akce.toUpperCase() === "DISABLE") vypnute.add(t);
    else vypnute.delete(t);
  }
  return [...vypnute].sort();
}

// =============================================================================
// Source of Truth Configuration
// =============================================================================

/**
 * Tabulky projektových dat. Platforma do nich NESEEDUJE nic (rozhodnutí majitele
 * 2026-09-24): v centrálním repu nesmí zůstat data žádného projektu — ani
 * anonymizovaná, ani přečíslovaná. Instance si obsah dodá ve vlastní vrstvě
 * (aisha/db/seed/instance/), e2e má syntetické fixture jen v seed.e2e.sql.
 *
 * ⛔ Proč: seed nesl produkční identifikátory reálného nájemce; jejich
 * přečíslování (#1061) shodilo nasazení každé existující DB (duplicitní přirozené
 * klíče). Data, která platforma nevkládá, nemohou kolidovat.
 */
export const PROJEKTOVE_TABULKY = [
  "products", "hero_slides", "featured_products",
  "studies", "study_consent_items", "study_consent_requirements", "study_questionnaires",
  "study_registrations", "study_consultants", "consent_templates", "consents",
  "data_sharing_consents", "distribution_protocols",
  "notification_campaigns", "notification_campaign_schedules",
  "subscription_packages", "memberships", "token_config", "token_reward_rules", "achievements",
  "question_blocks", "questionnaire_blocks",
  "test_questions", "invitations", "partner_certifications",
  "shipment_settings", "news_articles",
  "dosing_logs", "health_check_ins",
] as const;

/**
 * `questionnaires` je SMÍŠENÁ tabulka: nese kotvy funkcí platformy, na které se
 * aplikace odkazuje id (src/lib/studyRegistrationSchema.ts), a jinak obsah
 * instance. Seed do ní smí vložit JEN tyto kotvy.
 */
export const KOTVY_DOTAZNIKU_PLATFORMY = [
  "00000000-0000-0000-0000-000000000001", // study-registration
  "00000000-0000-0000-0000-000000000002", // QUALIFICATION-TEST
] as const;

export const SOURCE_OF_TRUTH = {
  /**
   * Canonical paths for database artifacts
   */
  paths: {
    migrations: "aisha/db/migrations",
    seed: "aisha/db/seed.compiled.sql",
    seedModules: "aisha/db/seed",
    types: "src/integrations/db/types.ts",
    rpc: "aisha/db/migrations", // RPC functions are in migrations
    security: "docs/security",
    backup: "docs/db-backup-check",
  },

  /**
   * Expected record counts after seed.
   *
   * Two semantics, enforced in schema-validation-v2.test.ts:
   *   - value > 0  → FLOOR. Reference/demo data grows over time (instance +
   *                  demo externalization), so the count is a minimum, not a
   *                  fixed total.
   *   - value = 0  → EXACT. These tables are seeded by NO profile and must stay
   *                  empty — the "no PHI / no user-generated data in the seed"
   *                  invariant. ONLY genuinely-never-seeded tables belong here.
   *
   */
  expectedCounts: {
    // FLOOR: platforma sama (seed-admin + jeho role) a dokumentace platformy.
    profiles: 1,
    user_roles: 1,
    archive_documents: 2,
    // EXACT 0: žádný profil je neseeduje — PHI se do seedu nesmí dostat.
    lab_results: 0,
    questionnaire_responses: 0,
    // EXACT 0: projektová data — platforma se instaluje s prázdnými
    // doménovými tabulkami, obsah si dodá instance ve své vrstvě.
    ...Object.fromEntries(PROJEKTOVE_TABULKY.map((t) => [t, 0])),
  },

  /**
   * Tables that should have seed INSERT statements.
   *
   * NOTE: This intentionally excludes user-generated sensitive data tables
   * (e.g. health_check_ins, dosing_logs, lab_results, questionnaire_responses).
   * Projektové tabulky (PROJEKTOVE_TABULKY) sem nepatří: platforma je neseeduje
   * vůbec; syntetická data pro e2e žijí jen v seed.e2e.sql.
   */
  seedRequiredInsertTables: [
    "roles",
    "permissions",
    "supported_languages",
    "system_config",
    "profiles",
    "user_roles",
  ],

  /**
   * Critical tables that MUST have RLS enabled
   */
  criticalTables: [
    "profiles",
    "health_check_ins",
    "dosing_logs",
    "lab_results",
    "user_roles",
    "consents",
    "data_sharing_consents",
    "questionnaire_responses",
    "study_registrations",
  ],

  /**
   * Required RPC functions for the application
   */
  requiredRpcFunctions: [
    "get_my_health_check_ins_audited",
    "get_my_lab_results_audited",
    "get_my_dosing_logs_audited",
    "has_role",
    "is_admin_or_staff",
    "get_user_permissions",
  ],

  /**
   * Required enum types
   */
  requiredEnums: [
    "app_role",
    "consent_type",
    "study_type",
    "registration_status",
  ],
} as const;

// =============================================================================
// Path Utilities
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

export function getAbsolutePath(relativePath: string): string {
  return path.join(WORKSPACE_ROOT, relativePath);
}

// =============================================================================
// PSQL Utilities
// =============================================================================

/**
 * Common psql args. Built once from env-probe constants so that callers don't
 * need to thread connection details through. Uses execFile (no shell) to
 * avoid command-injection risk if env vars are tainted.
 */
function buildPsqlArgs(extra: string[]): string[] {
  return ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, ...extra];
}

export function psqlQuery(query: string): string {
  try {
    return execFileSync("psql", buildPsqlArgs(["-t", "-A", "-c", query]), {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    }).trim();
  } catch (error) {
    throw new Error(`PSQL query failed: ${error}`);
  }
}

/**
 * Run a single query under a specific role and return the scalar text result.
 *
 * The role is assumed at CONNECTION TIME via the `role` GUC (PGOPTIONS), NOT via
 * an in-band `SET ROLE <role>; <query>` string. psql ≥15 echoes the `SET`
 * command tag into stdout when `-c` carries multiple statements, so the broken
 * form returns `"SET\n<value>"` and corrupts scalar parsing (e.g. parseFloat →
 * NaN). Verified on the runner's exact client: `psql -t -A -c "SET ROLE x;
 * SELECT 42"` → `SET\n42`, while `PGOPTIONS=-c role=x psql -t -A -c "SELECT 42"`
 * → `42`. Connecting with the role already active yields one tuple and no tag —
 * an identical privilege posture to `SET ROLE` (session role, no JWT claim),
 * but version-independent.
 *
 * The role is validated against a strict identifier pattern: PGOPTIONS is passed
 * via the spawn env (no shell), but a value with whitespace could smuggle extra
 * `-c` switches, so reject anything outside `[a-z_][a-z0-9_]*`.
 */
export function psqlQueryAs(role: string, query: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`psqlQueryAs: invalid role name '${role}'`);
  }
  try {
    return execFileSync("psql", buildPsqlArgs(["-t", "-A", "-c", query]), {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD, PGOPTIONS: `-c role=${role}` },
    }).trim();
  } catch (error) {
    throw new Error(`PSQL query (as ${role}) failed: ${error}`);
  }
}

export function psqlMultiline(sql: string): string {
  // pid + random suffix: parallel vitest workers calling this in the same
  // millisecond used to collide on the same file and corrupt each other's SQL
  // (observed as `syntax error at or near ")"` from a half-overwritten script).
  const tempFile = path.join(
    "/tmp",
    `psql-temp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.sql`,
  );
  try {
    fs.writeFileSync(tempFile, sql);
    return execFileSync("psql", buildPsqlArgs(["-f", tempFile]), {
      encoding: "utf-8",
      timeout: 60000,
      // ⛔ Výchozí strop výstupu je 1 MB. Dotazy nad pg_proc vrací těla VŠECH
      // funkcí (dnes > 1 800) a strop přetekly — test padal na `spawnSync psql
      // ENOBUFS`, tedy na velikosti katalogu, ne na tom, co měří.
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    });
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

// =============================================================================
// Database Queries
// =============================================================================

export interface TableRlsStatus {
  schemaname: string;
  tablename: string;
  rowsecurity: boolean;
}

export async function getTablesWithRlsStatus(): Promise<TableRlsStatus[]> {
  const result = psqlQuery(`
    SELECT schemaname, tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public'
  `);
  
  return result.split("\n").filter(Boolean).map(line => {
    const [schemaname, tablename, rowsecurity] = line.split("|");
    return { schemaname, tablename, rowsecurity: rowsecurity === "t" };
  });
}

export interface SchemaColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

export async function getTableSchema(tableName: string): Promise<SchemaColumn[]> {
  const result = psqlQuery(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${tableName}'
  `);
  
  return result.split("\n").filter(Boolean).map(line => {
    const [column_name, data_type, is_nullable] = line.split("|");
    return { column_name, data_type, is_nullable };
  });
}

export interface RpcFunction {
  routine_name: string;
  routine_type: string;
}

export async function getRpcFunctions(): Promise<RpcFunction[]> {
  const result = psqlQuery(`
    SELECT routine_name, routine_type
    FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
  `);
  
  return result.split("\n").filter(Boolean).map(line => {
    const [routine_name, routine_type] = line.split("|");
    return { routine_name, routine_type };
  });
}

export interface EnumType {
  typname: string;
  values: string[];
}

export async function getEnumTypes(): Promise<EnumType[]> {
  const result = psqlQuery(`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typtype = 'e'
    GROUP BY t.typname
  `);
  
  return result.split("\n").filter(Boolean).map(line => {
    const [typname, values] = line.split("|");
    // Parse PostgreSQL array format: {val1,val2,val3}
    const parsedValues = values
      .replace(/^{|}$/g, "")
      .split(",")
      .map(v => v.trim().replace(/"/g, ""));
    return { typname, values: parsedValues };
  });
}

export interface RlsPolicy {
  tablename: string;
  policyname: string;
  cmd: string;
}

export async function getRlsPolicies(tableName: string): Promise<RlsPolicy[]> {
  const result = psqlQuery(`
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = '${tableName}'
  `);
  
  if (!result) return [];
  
  return result.split("\n").filter(Boolean).map(line => {
    const [tablename, policyname, cmd] = line.split("|");
    return { tablename, policyname, cmd };
  });
}

export async function getTableCounts(
  tables: string[],
  /**
   * ISO čas, do kterého se řádky počítají (sloupec created_at). Zahazovací DB ho
   * předává v AISHA_TESTDB_SEED_AT = okamžik po seedu, před prvním testem, takže
   * se měří SEED, ne přechodné fixtury souběžných testů. Tabulka bez created_at
   * se počítá celá.
   */
  vznikloDo?: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const hranice = vznikloDo && !Number.isNaN(Date.parse(vznikloDo)) ? new Date(vznikloDo).toISOString() : null;

  for (const table of tables) {
    try {
      const maCreatedAt = hranice !== null && psqlQuery(
        `SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}' AND column_name = 'created_at'`,
      ) === "1";
      const filtr = maCreatedAt ? ` WHERE created_at <= '${hranice}'::timestamptz` : "";
      const result = psqlQuery(`SELECT COUNT(*) FROM "${table}"${filtr}`);
      counts[table] = parseInt(result, 10) || 0;
    } catch {
      counts[table] = 0;
    }
  }
  
  return counts;
}

// =============================================================================
// Dry Run Validation
// =============================================================================

export interface DryRunResult {
  success: boolean;
  error?: string;
  rowsAffected?: number;
}

export async function dryRunSeed(seedPath: string): Promise<DryRunResult> {
  const seedContent = fs.readFileSync(seedPath, "utf-8");
  
  // Wrap seed in transaction that will be rolled back
  const wrappedSql = `
    BEGIN;
    ${seedContent}
    ROLLBACK;
  `;
  
  try {
    psqlMultiline(wrappedSql);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export interface SyntaxValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateSqlSyntax(
  filePath: string
): Promise<SyntaxValidationResult> {
  const sql = fs.readFileSync(filePath, "utf-8");
  
  // Use EXPLAIN to check syntax without execution
  // Or wrap in transaction and immediately rollback
  const testSql = `
    BEGIN;
    ${sql}
    ROLLBACK;
  `;
  
  try {
    psqlMultiline(testSql);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Backup comparison helper removed (was reading docs/db-backup-check JSON
// snapshots, a pre-rebrand DB-tooling artifact). Drift detection now
// lives in aisha-deploy-flow Phase 1 (drift_state table + observer).

// =============================================================================
// AI Validation Availability Check (MLX - Native Apple Silicon)
//
// Delegated to test-env-probe.ts to keep capability detection in one place.
// =============================================================================

export { isAppleSilicon };

export function isMlxInstalled(): boolean {
  return checkMlxAvailable().available;
}

export function checkAIAvailability(): {
  available: boolean;
  reason: string;
  model: string | null;
} {
  const { available, reason } = checkMlxAvailable();
  return {
    available,
    reason,
    model: available ? "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit" : null,
  };
}

// =============================================================================
// ORDER BY Validation for Ordering Columns
// =============================================================================

export interface OrderingColumn {
  table_name: string;
  column_name: string;
  column_default: string | null;
  is_nullable: string;
}

/**
 * Get all tables with sort_order or display_order columns
 */
export async function getTablesWithOrderingColumns(): Promise<OrderingColumn[]> {
  // Only BASE TABLEs can carry a column DEFAULT. VIEWs project an ordering
  // column from an underlying table (e.g. cohort_questionnaires.display_order)
  // and structurally cannot have a DEFAULT — flagging them is a category error.
  // The join to information_schema.tables scopes the detector to real tables.
  const result = psqlQuery(`
    SELECT c.table_name, c.column_name, c.column_default, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name  = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('sort_order', 'display_order')
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.column_name
  `);
  
  if (!result) return [];
  
  return result.split("\n").filter(Boolean).map(line => {
    const [table_name, column_name, column_default, is_nullable] = line.split("|");
    return { 
      table_name, 
      column_name, 
      column_default: column_default || null,
      is_nullable 
    };
  });
}

export interface RpcFunctionDetail {
  proname: string;
  prosrc: string;
  referenced_tables: string[];
  has_order_by: boolean;
  order_by_clause: string | null;
  uses_ordering_column: boolean;
}

/**
 * Get all RPC functions that SELECT from tables with ordering columns
 * and check if they have proper ORDER BY
 */
export async function getRpcFunctionsWithOrderingAnalysis(
  tablesWithOrdering: string[]
): Promise<RpcFunctionDetail[]> {
  // Build regex pattern for table matching
  const tablePattern = tablesWithOrdering.join("|");
  
  const result = psqlMultiline(`
    SELECT 
      proname,
      prosrc,
      -- Whitespace-tolerant: SQL is aligned with 'ORDER  BY' (two spaces) in
      -- several functions; a literal '%ORDER BY%' LIKE misses those and
      -- false-flags an already-ordered function. Match ORDER<ws+>BY via regex.
      CASE WHEN prosrc ~* 'ORDER[[:space:]]+BY' THEN 'true' ELSE 'false' END as has_order,
      substring(prosrc FROM 'ORDER[[:space:]]+BY[^;]{0,100}') as order_clause
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prosrc ~* 'RETURN[[:space:]]+QUERY'
      AND prosrc ~ '(${tablePattern})'
    ORDER BY proname;
  `);
  
  const lines = result.split("\n").filter(line => line.includes("|") && !line.includes("---"));
  
  return lines.map(line => {
    const parts = line.split("|").map(p => p.trim());
    const [proname, prosrc, has_order, order_clause] = parts;
    
    // Find which tables this function references
    const referenced_tables = tablesWithOrdering.filter(t => 
      prosrc?.includes(t) || prosrc?.includes(`"${t}"`)
    );
    
    // Check if ORDER BY uses sort_order or display_order
    const uses_ordering_column = order_clause ? 
      /sort_order|display_order/.test(order_clause) : false;
    
    return {
      proname: proname || "",
      prosrc: prosrc || "",
      referenced_tables,
      has_order_by: has_order === "true",
      order_by_clause: order_clause || null,
      uses_ordering_column,
    };
  }).filter(f => f.proname && f.referenced_tables.length > 0);
}

/**
 * Comprehensive ORDER BY validation result
 */
export interface OrderByValidationResult {
  table: string;
  column: string;
  has_default: boolean;
  default_value: string | null;
  functions_using_table: Array<{
    name: string;
    has_order_by: boolean;
    uses_correct_column: boolean;
    order_clause: string | null;
  }>;
  issues: string[];
}

/**
 * Complete validation of all ordering columns and their RPC functions
 */
export async function validateOrderByCompleteness(): Promise<OrderByValidationResult[]> {
  const results: OrderByValidationResult[] = [];
  
  // Get all tables with ordering columns
  const orderingColumns = await getTablesWithOrderingColumns();
  const tablesWithOrdering = [...new Set(orderingColumns.map(c => c.table_name))];
  
  // Get all RPC functions that reference these tables
  const rpcFunctions = await getRpcFunctionsWithOrderingAnalysis(tablesWithOrdering);
  
  // Group by table and analyze
  for (const col of orderingColumns) {
    const issues: string[] = [];
    
    // Check DEFAULT value
    const has_default = col.column_default !== null && col.column_default !== "";
    if (!has_default) {
      issues.push(`Missing DEFAULT value for ${col.table_name}.${col.column_name}`);
    }
    
    // Find functions that use this table
    const functionsUsingTable = rpcFunctions
      .filter(f => f.referenced_tables.includes(col.table_name))
      .map(f => {
        // Check if this function's ORDER BY uses the correct column
        const uses_correct = f.order_by_clause ? 
          f.order_by_clause.includes(col.column_name) : false;
        
        if (f.has_order_by && !uses_correct) {
          // Has ORDER BY but doesn't use sort_order/display_order
          // This might be intentional (e.g., ORDER BY created_at for audit)
          // Only flag if it's a get_/list_ function that returns multiple rows
          if (/^(get_|list_)/.test(f.proname) && 
              !f.order_by_clause?.includes("created_at") &&
              !f.order_by_clause?.includes("updated_at")) {
            issues.push(
              `Function ${f.proname} has ORDER BY but doesn't use ${col.column_name}: ${f.order_by_clause}`
            );
          }
        }
        
        if (!f.has_order_by && /^(get_|list_)/.test(f.proname)) {
          issues.push(`Function ${f.proname} references ${col.table_name} but has no ORDER BY`);
        }
        
        return {
          name: f.proname,
          has_order_by: f.has_order_by,
          uses_correct_column: uses_correct,
          order_clause: f.order_by_clause,
        };
      });
    
    results.push({
      table: col.table_name,
      column: col.column_name,
      has_default,
      default_value: col.column_default,
      functions_using_table: functionsUsingTable,
      issues,
    });
  }
  
  return results;
}

/**
 * SINGLE_ROW_RPCS — `get_/list_` functions that RETURN SETOF/TABLE but yield
 * AT MOST ONE ROW, so an ORDER BY would be meaningless.
 *
 * Each entry was verified by reading the function body: it either filters by a
 * primary/unique key, returns a per-user singleton (profile / wallet), or is a
 * groupless aggregate / scalar projection (exactly one summary row).
 *
 * This EXPLICIT, reviewed allowlist replaces two prior fuzzy heuristics in the
 * ORDER BY gate: the `<= 40` tolerance baseline and the name-pattern exceptions
 * (`_stats`, `_count`, ...). The name patterns were unsafe — e.g.
 * `get_study_registrations_count_admin` matches `_count` yet is genuinely
 * multi-row (GROUP BY study_id). A new `get_/list_` function that returns
 * multiple rows MUST add ORDER BY or be added here with a justification; there
 * is no silent tolerance band.
 */
export const SINGLE_ROW_RPCS: ReadonlySet<string> = new Set<string>([
  // ── Filtered by a primary / unique key → at most one row ──────────────────
  "get_active_workflow_for_context",
  "get_agent_catalog_entry",
  "get_agent_run",
  "get_ai_trigger_admin",
  "get_ai_workflow_admin",
  "get_appointment_review",
  "get_archive_document_by_slug_localized",
  "get_my_study_consultant_application",
  "get_my_study_rating",
  "get_news_article_admin",
  "get_news_article_by_slug",
  "get_order_review_by_order",
  "get_partner_access_for_edge",
  "get_public_product_by_slug",
  "get_story_general_matrix_room",
  "get_story_ptt_room",
  "get_study_detail",
  "get_web_page_admin",
  // p_step_id je PK kroku; tělo skládá JEDEN řádek (RETURN QUERY bez FROM přes sady).
  "get_workflow_step_detail",
  // ── Per-user singleton (profile / wallet / completeness) ──────────────────
  "get_health_document_download_info_audited",
  "get_health_document_for_analysis_audited",
  "get_my_phi_profile_prefill_audited",
  "get_my_profile_completeness",
  "get_my_profile_contact_prefill_audited",
  "get_my_profile_phi",
  "get_my_profile_preferences_audited",
  "get_my_profile_visibility",
  "get_my_wallet_balance",
  "get_profile_completeness",
  // ── Groupless aggregate / scalar projection → one summary row ─────────────
  "get_admin_pending_counts",
  "get_autonomy_enforcement_rules",
  "get_partner_story_stats",
  "get_playwright_runs_health_summary",
  "get_storyloop_admin_overview",
  "get_voucher_analytics_admin",
]);

/**
 * Get ALL RPC functions and check for ORDER BY patterns
 */
export async function getAllRpcFunctionsOrderByStatus(): Promise<Array<{
  name: string;
  returns_multiple: boolean;
  has_order_by: boolean;
  order_clause: string | null;
  issue: string | null;
}>> {
  const result = psqlMultiline(`
    SELECT 
      proname,
      proretset,
      -- Whitespace-tolerant ORDER BY / RETURN QUERY match (see note in
      -- getRpcFunctionsWithOrderingAnalysis): aligned 'ORDER  BY' (2 spaces)
      -- must not be mistaken for "no ORDER BY".
      CASE WHEN prosrc ~* 'ORDER[[:space:]]+BY' THEN 'true' ELSE 'false' END as has_order,
      substring(prosrc FROM 'ORDER[[:space:]]+BY[^;]{0,80}') as order_clause
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prosrc ~* 'RETURN[[:space:]]+QUERY'
    ORDER BY proname;
  `);
  
  const lines = result.split("\n").filter(line => 
    line.includes("|") && !line.includes("---") && !line.includes("proname")
  );
  
  return lines.map(line => {
    const parts = line.split("|").map(p => p.trim());
    const [name, proretset, has_order, order_clause] = parts;
    
    const returns_multiple = proretset === "t";
    const has_order_by = has_order === "true";
    
    // Functions returning sets (SETOF/TABLE) should have ORDER BY
    let issue: string | null = null;
    if (returns_multiple && !has_order_by && /^(get_|list_)/.test(name || "")) {
      issue = "Returns multiple rows but has no ORDER BY";
    }
    
    return {
      name: name || "",
      returns_multiple,
      has_order_by,
      order_clause: order_clause || null,
      issue,
    };
  }).filter(f => f.name);
}


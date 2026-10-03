/**
 * Security Gate Tests
 * 
 * Tyto testy fungují jako CI gate - pokud selžou, build neprojde.
 * Spouští se pomocí: npm run test:gates
 * 
 * Kontrolují:
 * 1. sensitive data funkce nemají anon grant
 * 2. sensitive data tabulky mají RLS
 * 3. Parametry RPC volání odpovídají DB funkcím
 * 4. Consent checks v user funkcích
 * 5. Source of Truth konzistence (SQL ↔ TypeScript ↔ Frontend)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { getReportPath } from '../helpers/reportPaths';
import {
  isKnownAnonGrantFunction,
  isKnownNoAuthFunction,
  isKnownNoConsentFunction,
  isKnownPhiTableNoRls,
  isKnownMissingRlsPolicy,
  isKnownHookNoAuth,
  isKnownWrongParamFunction,
  isKnownMissingParamFunction,
} from './security-known-issues';

const PROJECT_ROOT = process.cwd();

// Helper pro spuštění analyzátorů
async function runAnalyzer(command: string, useStatic = false): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const args = ['run', command];
    // Pro access a flow analyzátory přidáme --static pro souborovou analýzu
    if (useStatic && (command.includes('access') || command.includes('flow'))) {
      args.push('--', '--static');
    }
    const child = spawn('npm', args, {
      cwd: PROJECT_ROOT,
      shell: true,
      env: {
        ...process.env,
        AISHA_DB_URL: process.env.AISHA_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        SUPABASE_DB_ALLOW_INSECURE_SSL_FAILOVER: 'true',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr, code: 124 });
    }, 60000);
  });
}

// Helper pro načtení JSON reportu
function loadReport(filename: string): Record<string, unknown> | null {
  const path = getReportPath(filename);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

type AnalyzerIssue = {
  type: string;
  severity: 'critical' | 'error' | 'warning' | 'info' | string;
  function?: string;
  table?: string;
  operation?: string;
  hook?: string;
};

function getIssues(report: Record<string, unknown> | null): AnalyzerIssue[] {
  if (!report) return [];
  const issues = (report as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as AnalyzerIssue[]) : [];
}

function isKnownAccessIssue(issue: AnalyzerIssue): boolean {
  switch (issue.type) {
    case 'SEC_DEF_ANON_GRANT':
      return isKnownAnonGrantFunction(issue.function || '');
    case 'SEC_DEF_NO_AUTH':
      return isKnownNoAuthFunction(issue.function || '');
    case 'SEC_DEF_NO_CONSENT':
      return isKnownNoConsentFunction(issue.function || '');
    case 'PHI_TABLE_NO_RLS':
      return isKnownPhiTableNoRls(issue.table || '');
    case 'MISSING_RLS_POLICY':
      return isKnownMissingRlsPolicy(issue.table || '', issue.operation || '');
    case 'PHI_HOOK_NO_AUTH':
      return isKnownHookNoAuth(issue.hook || '');
    default:
      return false;
  }
}

function countBySeverity(issues: AnalyzerIssue[], severity: 'critical' | 'error'): number {
  return issues.filter((i) => i.severity === severity).length;
}

type SourceTruthDetail = {
  type: string;
  severity: 'critical' | 'error' | 'warning' | 'info' | string;
  file?: string;
  line?: number;
  function?: string;
  param?: string;
  // Report může obsahovat i jiná pole (sqlFile, message, etc.)
  [key: string]: unknown;
};

function getSourceTruthIssues(report: Record<string, unknown> | null): SourceTruthDetail[] {
  if (!report) return [];

  // New format (2026-01+): { issues: {critical/errors/...}, details: [...] }
  const details = (report as { details?: unknown }).details;
  if (Array.isArray(details)) {
    return details as SourceTruthDetail[];
  }

  // Back-compat: { issues: [...] }
  const issues = (report as { issues?: unknown }).issues;
  if (Array.isArray(issues)) {
    return issues as SourceTruthDetail[];
  }

  return [];
}

describe('Security Gates', () => {
  let accessReport: Record<string, unknown> | null = null;
  let flowReport: Record<string, unknown> | null = null;
  let sourceReport: Record<string, unknown> | null = null;

  beforeAll(async () => {
    // Source Truth analyzer nepotřebuje DB - můžeme spustit vždy
    const sourcePath = getReportPath('source-truth-report.json');
    const maxAge = 5 * 60 * 1000; // 5 minut
    const now = Date.now();

    const sourceStat = existsSync(sourcePath) ? statSync(sourcePath) : null;
    if (!sourceStat || now - sourceStat.mtimeMs > maxAge) {
      console.log('🔄 Running source-truth analyzer (file-based, no DB needed)...');
      await runAnalyzer('db-mgr:source');
    }
    sourceReport = loadReport('source-truth-report.json');

    // ⛔ ACCESS ANALYZÁTOR NEPOTŘEBUJE DB — běží jako `--static` nad soubory.
    // Do 2026-09-12 ho shazoval blanketní `if (CI && !AISHA_DB_URL) return;`
    // o dva řádky níž: `AISHA_DB_URL` je v ci.yml JEN v cold-start lane, ne
    // v lane `test:gates`, kde tahle brána běží. Výsledkem bylo, že tři testy
    // označené CRITICAL v CI vypsaly varování a PROŠLY — porovnání nálezů
    // s revidovaným allowlistem se tedy nikdy nevymáhalo tam, kde na tom
    // záleží. Načtení proto patří NAD ten guard.
    const accessPath = getReportPath('access-flow-report.json');
    const accessStat = existsSync(accessPath) ? statSync(accessPath) : null;
    if (!accessStat || now - accessStat.mtimeMs > maxAge) {
      console.log('🔄 Running access-flow analyzer (static/file-based)...');
      await runAnalyzer('db-mgr:access', true);
    }
    accessReport = loadReport('access-flow-report.json');

    // DB-dependent analyzers - skip v CI bez DB
    if (process.env.CI && !process.env.AISHA_DB_URL) {
      console.log('⚠️ Skipping DB-dependent gates - no database connection in CI');
      return;
    }

    const flowPath = getReportPath('flow-consistency-report.json');
    const flowStat = existsSync(flowPath) ? statSync(flowPath) : null;

    if (!flowStat || now - flowStat.mtimeMs > maxAge) {
      console.log('🔄 Running flow-consistency analyzer (static/file-based)...');
      await runAnalyzer('db-mgr:flow', true);
    }

    flowReport = loadReport('flow-consistency-report.json');
  }, 120000); // 2 minute timeout for beforeAll

  afterAll(() => {
    // Cleanup if needed
  });

  describe('Sensitive Data Function Security', () => {
    test('CRITICAL: No anon grants on sensitive data functions', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; function?: string }> }).issues || [];
      const anonGrants = issues.filter(i => i.type === 'SEC_DEF_ANON_GRANT');
      
      // Filter out known issues
      const newAnonGrants = anonGrants.filter(i => !isKnownAnonGrantFunction(i.function || ''));

      if (newAnonGrants.length > 0) {
        const funcs = newAnonGrants.map(i => i.function).join(', ');
        console.error(`🔴 NEW sensitive data functions with anon grant: ${funcs}`);
      }
      
      if (anonGrants.length > newAnonGrants.length) {
        console.warn(`⚠️ ${anonGrants.length - newAnonGrants.length} known anon grants tracked in security-known-issues.ts`);
      }

      expect(newAnonGrants.length, 
        `Found ${newAnonGrants.length} NEW sensitive data functions with anon EXECUTE grant. ` +
        `Run: npm run db-mgr:access for details.`
      ).toBe(0);
    });

    test('CRITICAL: SECURITY DEFINER functions have auth checks', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; function?: string }> }).issues || [];
      const noAuth = issues.filter(i => i.type === 'SEC_DEF_NO_AUTH');

      // Filter out known exceptions
      const newNoAuth = noAuth.filter(i => !isKnownNoAuthFunction(i.function || ''));

      expect(newNoAuth.length,
        `Found ${newNoAuth.length} NEW SECURITY DEFINER functions without auth checks. ` +
        `Functions: ${newNoAuth.map(i => i.function).join(', ')}`
      ).toBe(0);
    });

    test('ERROR: User data functions have consent checks', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; function?: string }> }).issues || [];
      const noConsent = issues.filter(i => i.type === 'SEC_DEF_NO_CONSENT');
      
      // Filter out known exceptions
      const newNoConsent = noConsent.filter(i => !isKnownNoConsentFunction(i.function || ''));

      expect(newNoConsent.length,
        `Found ${newNoConsent.length} NEW user data functions without consent check. ` +
        `Functions: ${newNoConsent.map(i => i.function).join(', ')}`
      ).toBe(0);
    });
  });

  describe('RLS Policy Security', () => {
    test('CRITICAL: All sensitive data tables have RLS enabled', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; table?: string }> }).issues || [];
      const noRls = issues.filter(i => i.type === 'PHI_TABLE_NO_RLS');
      
      // Filter out known issues
      const newNoRls = noRls.filter(i => !isKnownPhiTableNoRls(i.table || ''));

      if (newNoRls.length > 0) {
        const tables = newNoRls.map(i => i.table).join(', ');
        console.error(`🔴 NEW sensitive data tables without RLS: ${tables}`);
      }
      
      if (noRls.length > newNoRls.length) {
        console.warn(`⚠️ ${noRls.length - newNoRls.length} known sensitive data tables without RLS tracked in security-known-issues.ts`);
      }

      expect(newNoRls.length,
        `Found ${newNoRls.length} NEW sensitive data tables without RLS policies. ` +
        `Tables: ${newNoRls.map(i => i.table).join(', ')}`
      ).toBe(0);
    });

    test('CRITICAL: No anonymous access to sensitive data tables', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; table?: string }> }).issues || [];
      const anonAccess = issues.filter(i => i.type === 'PHI_TABLE_ANON_ACCESS');

      expect(anonAccess.length,
        `Found ${anonAccess.length} sensitive data tables allowing anonymous access. ` +
        `Tables: ${anonAccess.map(i => i.table).join(', ')}`
      ).toBe(0);
    });

    test('ERROR: sensitive data tables have complete RLS policies', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; table?: string; operation?: string; severity: string }> }).issues || [];
      const missingPolicies = issues.filter(i => 
        i.type === 'MISSING_RLS_POLICY' && i.severity === 'error'
      );
      
      // Filter out known exceptions
      const newMissingPolicies = missingPolicies.filter(i => 
        !isKnownMissingRlsPolicy(i.table || '', i.operation || '')
      );

      expect(newMissingPolicies.length,
        `Found ${newMissingPolicies.length} NEW missing RLS policies on sensitive data tables. ` +
        `Run: npm run db-mgr:access for details.`
      ).toBe(0);
    });
  });

  // ============================================================================
  // Source of Truth Consistency (File-Based, No DB Required)
  // ============================================================================
  describe('Source of Truth Consistency', () => {
    test('CRITICAL: Frontend RPC calls match SQL function signatures', () => {
      if (!sourceReport) {
        console.warn('⚠️ Source report not available, skipping test');
        return;
      }

      const issues = getSourceTruthIssues(sourceReport);
      // Filter out mobile-app issues (separate project with its own validation)
      // Report uses 'location' field, not 'file'
      const wrongParams = issues.filter(i => 
        i.type === 'WRONG_PARAM' && 
        i.severity === 'error' &&
        !String(i.location ?? '').includes('mobile-app/')
      );

      // Filter out known param mismatches (pre-existing production code)
      const newWrongParams = wrongParams.filter(i => !isKnownWrongParamFunction(i.function || ''));

      if (newWrongParams.length > 0) {
        const details = newWrongParams.slice(0, 10).map(i => 
          `${i.location} - ${i.function}() expects different params (got: ${i.parameter ?? i.param})`
        ).join('\n  ');
        console.error(`🔴 Wrong parameters in frontend RPC calls:\n  ${details}`);
        if (newWrongParams.length > 10) {
          console.error(`  ... and ${newWrongParams.length - 10} more`);
        }
      }

      if (wrongParams.length > newWrongParams.length) {
        console.warn(`⚠️ ${wrongParams.length - newWrongParams.length} known param mismatches tracked in security-known-issues.ts`);
      }

      expect(newWrongParams.length,
        `Found ${newWrongParams.length} NEW frontend RPC calls with wrong parameter names. ` +
        `These WILL FAIL at runtime! Run: npm run db-mgr:source for details.`
      ).toBe(0);
    });

    test('CRITICAL: All required parameters are provided in frontend calls', () => {
      if (!sourceReport) {
        console.warn('⚠️ Source report not available, skipping test');
        return;
      }

      const issues = getSourceTruthIssues(sourceReport);
      const missingParams = issues.filter(i => i.type === 'MISSING_REQUIRED_PARAM' && i.severity === 'error');

      // Filter out known missing param functions (pre-existing production code)
      const newMissingParams = missingParams.filter(i => !isKnownMissingParamFunction(i.function || ''));

      if (newMissingParams.length > 0) {
        const details = [...new Set(newMissingParams.map(i => i.function))].slice(0, 10).join(', ');
        console.error(`🔴 Functions missing required params: ${details}`);
      }

      if (missingParams.length > newMissingParams.length) {
        console.warn(`⚠️ ${missingParams.length - newMissingParams.length} known missing-param issues tracked in security-known-issues.ts`);
      }

      expect(newMissingParams.length,
        `Found ${newMissingParams.length} NEW RPC calls missing required parameters. ` +
        `Run: npm run db-mgr:source for details.`
      ).toBe(0);
    });

    test('ERROR: sensitive data user data functions have consent checks', () => {
      if (!sourceReport) {
        console.warn('⚠️ Source report not available, skipping test');
        return;
      }

      const issues = getSourceTruthIssues(sourceReport);
      const noConsent = issues.filter(i => i.type === 'PHI_NO_CONSENT_CHECK');

      if (noConsent.length > 0) {
        const funcs = [...new Set(noConsent.map(i => i.function))].join(', ');
        console.error(`🔴 sensitive data functions without consent check: ${funcs}`);
      }

      expect(noConsent.length,
        `Found ${noConsent.length} sensitive data user data functions without consent validation. ` +
        `These functions access OTHER users' data and MUST call has_data_sharing_consent(). ` +
        `Run: npm run db-mgr:source for details.`
      ).toBe(0);
    });

    test('ERROR: TypeScript RPC types match SQL function signatures', () => {
      if (!sourceReport) {
        console.warn('⚠️ Source report not available, skipping test');
        return;
      }

      const issues = getSourceTruthIssues(sourceReport);
      const typeMismatches = issues.filter(i => 
        (i.type === 'TS_TYPE_MISMATCH' || i.type === 'TS_PARAM_MISMATCH') && i.severity === 'error'
      );

      expect(typeMismatches.length,
        `Found ${typeMismatches.length} mismatches between SQL functions and TypeScript types. ` +
        `Run: npm run db:types:refresh:local to regenerate types.`
      ).toBe(0);
    });

    test('WARNING: SQL functions should have TypeScript type definitions', () => {
      if (!sourceReport) {
        console.warn('⚠️ Source report not available, skipping test');
        return;
      }

      const issues = getSourceTruthIssues(sourceReport);
      const missingTypes = issues.filter(i => i.type === 'MISSING_TS_TYPE' && i.severity === 'warning');

      // This is a warning, not a blocker - log but don't fail
      if (missingTypes.length > 0) {
        const funcs = [...new Set(missingTypes.map(i => i.function))].slice(0, 10).join(', ');
        console.warn(`⚠️ ${missingTypes.length} SQL functions without TypeScript types: ${funcs}...`);
        console.warn('   Run: npm run db:types:refresh:local to generate missing types.');
      }

      // Soft limit - warn if more than 50 functions are missing types
      if (missingTypes.length > 50) {
        console.warn(`⚠️ High number of untyped functions (${missingTypes.length}). Consider running type generation.`);
      }
    });
  });

  describe('Data Flow Consistency', () => {
    test('CRITICAL: No wrong parameters in RPC calls', () => {
      if (!flowReport) {
        console.warn('⚠️ Flow report not available, skipping test');
        return;
      }

      const issues = (flowReport as { issues: Array<{ type: string; function?: string; file?: string; line?: number }> }).issues || [];
      const wrongParams = issues.filter(i => i.type === 'WRONG_PARAM');

      if (wrongParams.length > 0) {
        const details = wrongParams.map(i => `${i.file}:${i.line} → ${i.function}`).join('\n  ');
        console.error(`🔴 Wrong parameters in RPC calls:\n  ${details}`);
      }

      expect(wrongParams.length,
        `Found ${wrongParams.length} RPC calls with wrong parameters. ` +
        `Run: npm run db-mgr:flow for details.`
      ).toBe(0);
    });

    test('ERROR: All required RPC parameters are provided', () => {
      if (!flowReport) {
        console.warn('⚠️ Flow report not available, skipping test');
        return;
      }

      const issues = (flowReport as { issues: Array<{ type: string; function?: string }> }).issues || [];
      const missingParams = issues.filter(i => i.type === 'MISSING_REQUIRED_PARAM');

      expect(missingParams.length,
        `Found ${missingParams.length} RPC calls missing required parameters. ` +
        `Functions: ${[...new Set(missingParams.map(i => i.function))].join(', ')}`
      ).toBe(0);
    });

    test('ERROR: sensitive data hooks have auth checks', () => {
      if (!accessReport) {
        console.warn('⚠️ Access report not available, skipping test');
        return;
      }

      const issues = (accessReport as { issues: Array<{ type: string; hook?: string; function?: string }> }).issues || [];
      const noAuth = issues.filter(i => i.type === 'PHI_HOOK_NO_AUTH');
      
      // Filter out known exceptions
      const newNoAuth = noAuth.filter(i => !isKnownHookNoAuth(i.hook || ''));

      expect(newNoAuth.length,
        `Found ${newNoAuth.length} NEW hooks calling sensitive data functions without auth check. ` +
        `Hooks: ${[...new Set(newNoAuth.map(i => i.hook))].join(', ')}`
      ).toBe(0);
    });
  });

  describe('Security Summary', () => {
    test('Summary: Total critical issues should be 0', () => {
      const sourceCritical = countBySeverity(getIssues(sourceReport), 'critical');
      const flowCritical = countBySeverity(getIssues(flowReport), 'critical');

      const accessCriticalIssues = getIssues(accessReport)
        .filter((i) => i.severity === 'critical')
        .filter((i) => !isKnownAccessIssue(i));

      const totalCritical = sourceCritical + accessCriticalIssues.length + flowCritical;

      expect(totalCritical,
        `Found ${totalCritical} critical security issues across all analyzers. ` +
        `Run: npm run db-mgr:source && npm run db-mgr:access && npm run db-mgr:flow for details.`
      ).toBe(0);
    });

    test('Summary: Total error issues should be 0', () => {
      const sourceErrors = countBySeverity(getIssues(sourceReport), 'error');
      const flowErrors = countBySeverity(getIssues(flowReport), 'error');

      const accessErrorIssues = getIssues(accessReport)
        .filter((i) => i.severity === 'error')
        .filter((i) => !isKnownAccessIssue(i));

      const totalErrors = sourceErrors + accessErrorIssues.length + flowErrors;

      expect(totalErrors,
        `Found ${totalErrors} error-level issues across all analyzers. ` +
        `Run: npm run db-mgr:source && npm run db-mgr:access && npm run db-mgr:flow for details.`
      ).toBe(0);
    });
  });

  // ============================================================================
  // SQL Function Static Analysis (File-Based, No DB Required)
  // ============================================================================
  describe('SQL Function Security (Static)', () => {
    const SQL_FUNCTIONS_DIR = join(PROJECT_ROOT, 'aisha/db/sql/functions');
    
    // Helper/trigger functions that don't need GRANT (called internally)
    const KNOWN_INTERNAL_FUNCTIONS = new Set([
      'audit_journal_set_action.sql',
      'calculate_next_reminder_time.sql',
      'check_admin_exists.sql',
      'check_admin_section_permission.sql',
      'check_api_rate_limit.sql',
      'check_product_access.sql',
      'cleanup_expired_sms_otp_codes.sql',
      'convert_currency_amount.sql',
      'ensure_leaderboard_periods.sql',
      'handle_new_user.sql',
      'handle_order_payment_completed.sql',
      'has_section_access.sql',
      'is_certified_partner.sql',
      'is_consultant_for_registration.sql',
      'is_consultant_for_user.sql',
      'is_study_consultant.sql',
      'sync_checkin_to_metrics.sql',
      'trg_update_training_dataset_counts.sql',
      'trigger_auto_create_story_on_registration.sql',
      'trigger_check_achievements.sql',
      'trigger_update_streak_on_activity.sql',
      'trigger_update_streak_on_reminder_completion.sql',
      'update_member_diary_updated_at.sql',
      'update_updated_at_column.sql',
      'update_user_wallet_balance.sql',
      'get_due_reminders_for_notification.sql',
      'get_pending_questionnaires_for_notifications.sql',
      'get_question_blocks_for_context.sql',
      'get_translation_value_with_fallback.sql',
    ]);

    test('CRITICAL: All GRANT TO anon functions have SECURITY DEFINER', () => {
      if (!existsSync(SQL_FUNCTIONS_DIR)) {
        console.warn('⚠️ SQL functions directory not found, skipping test');
        return;
      }

      const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));
      const violations: string[] = [];

      for (const file of files) {
        const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');
        const hasAnonGrant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+.*\s+TO\s+anon/i.test(content);
        const hasSecurityDefiner = /SECURITY\s+DEFINER/i.test(content);
        // Přijatý tvar: `public` na začátku, nebo zpevněný `pg_catalog, public, …` (definer funkce trezoru).
        const hasSetSearchPath = /SET\s+search_path\s*(TO|=)\s*(['"]?pg_catalog['"]?\s*,\s*)?['"]?public/i.test(content);

        if (hasAnonGrant && !hasSecurityDefiner) {
          violations.push(`${file}: GRANT TO anon but missing SECURITY DEFINER`);
        }
        if (hasSecurityDefiner && !hasSetSearchPath) {
          violations.push(`${file}: SECURITY DEFINER but missing SET search_path`);
        }
      }

      if (violations.length > 0) {
        console.error('🔴 Security violations in SQL functions:');
        violations.forEach(v => console.error(`   - ${v}`));
      }

      expect(violations.length,
        `Found ${violations.length} SQL functions with security issues. ` +
        `All anon-accessible functions MUST have SECURITY DEFINER with SET search_path.`
      ).toBe(0);
    });

    test('INFO: Functions without GRANT should be helper/trigger functions', () => {
      if (!existsSync(SQL_FUNCTIONS_DIR)) {
        console.warn('⚠️ SQL functions directory not found, skipping test');
        return;
      }

      const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));
      const unexpectedNoGrant: string[] = [];

      for (const file of files) {
        const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');
        const hasGrant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION/i.test(content);
        
        if (!hasGrant && !KNOWN_INTERNAL_FUNCTIONS.has(file)) {
          // Check if it's a trigger or helper pattern
          const isTrigger = /^trigger_|_trigger\.sql$|RETURNS\s+TRIGGER/i.test(file + content);
          const isHelper = /^(is_|has_|check_|calculate_|convert_|ensure_|update_|handle_|cleanup_|validate_|get_.*_for_)/i.test(file);
          
          if (!isTrigger && !isHelper) {
            unexpectedNoGrant.push(file);
          }
        }
      }

      // This is informational - log but don't fail
      if (unexpectedNoGrant.length > 0) {
        console.warn(`⚠️ ${unexpectedNoGrant.length} functions without GRANT that may need review:`);
        unexpectedNoGrant.slice(0, 10).forEach(f => console.warn(`   - ${f}`));
        if (unexpectedNoGrant.length > 10) {
          console.warn(`   ... and ${unexpectedNoGrant.length - 10} more`);
        }
      }
    });
  });
});

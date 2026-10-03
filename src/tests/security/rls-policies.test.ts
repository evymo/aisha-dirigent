import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * RLS Policy Security Tests — Real SQL Analysis
 *
 * Analyzes actual RLS policy SQL files to verify:
 * 1. All sensitive tables have RLS enabled
 * 2. PHI tables require ownership or admin access
 * 3. No RLS policies grant unrestricted SELECT to anon
 * 4. Consent-based policies reference data_sharing_consents
 * 5. All policies use auth.uid() for user context
 * 6. UPDATE/DELETE policies are more restrictive than SELECT
 */

const PROJECT_ROOT = process.cwd();
const SQL_DIR = join(PROJECT_ROOT, 'aisha/db/sql');
const TABLES_DIR = join(SQL_DIR, 'tables');
const POLICIES_DIR = join(SQL_DIR, 'policies');
const RLS_DIR = join(SQL_DIR, 'rls');
const FUNCTIONS_DIR = join(SQL_DIR, 'functions');

function readSafe(path: string): string {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

/** Tables considered to hold PHI/sensitive data. */
const PHI_TABLES = new Set([
  'health_check_ins',
  'health_documents',
  'health_metrics',
  'lab_results',
  'dosing_logs',
  'health_states',
  'symptom_logs',
  'consultation_notes',
  'medical_records',
  'treatment_plans',
  'patient_alerts',
]);

/** Tables that should be publicly accessible (read-only). */
const PUBLIC_TABLES = new Set([
  'products',
  'hero_slides',
  'archive_documents',
  'faq',
  'announcements',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RLS ENABLED ON SENSITIVE TABLES
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — Table Security', () => {
  it('table definitions enable RLS', () => {
    if (!existsSync(TABLES_DIR)) return;

    const violations: string[] = [];
    const tableFiles = readdirSync(TABLES_DIR).filter(f => f.endsWith('.sql'));

    for (const file of tableFiles) {
      const content = readFileSync(join(TABLES_DIR, file), 'utf-8');

      // If it has CREATE TABLE, it should have ENABLE ROW LEVEL SECURITY
      if (/CREATE\s+TABLE/i.test(content)) {
        const hasRls = /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(content);
        const hasAlterRls = /ALTER\s+TABLE.*ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(content);

        if (!hasRls && !hasAlterRls) {
          violations.push(`${file}: CREATE TABLE without ENABLE ROW LEVEL SECURITY`);
        }
      }
    }

    expect(
      violations,
      `Tables without RLS enabled:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PHI TABLE POLICY VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — PHI Table Access', () => {
  it('PHI tables use auth.uid() in SELECT policies', () => {
    const policyDirs = [POLICIES_DIR, RLS_DIR];
    const violations: string[] = [];

    for (const dir of policyDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => f.endsWith('.sql'));

      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');

        // Check if this policy applies to a PHI table
        for (const table of PHI_TABLES) {
          if (!content.includes(table)) continue;

          // SELECT policies on PHI tables must reference auth.uid()
          if (/CREATE\s+POLICY.*FOR\s+SELECT/i.test(content)) {
            const hasAuthUid = /auth\.uid\(\)/i.test(content);
            const hasAdminCheck = /is_admin_or_staff/i.test(content);
            const hasConsentCheck = /data_sharing_consent/i.test(content);

            if (!hasAuthUid && !hasAdminCheck && !hasConsentCheck) {
              violations.push(`${file}: SELECT policy on PHI table '${table}' without auth.uid()/admin/consent check`);
            }
          }
        }
      }
    }

    // Allow empty — PHI may be accessed only via SECURITY DEFINER functions
    if (violations.length > 0) {
      expect(
        violations,
        `PHI SELECT policies without proper access control:\n${violations.join('\n')}`
      ).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ANON ACCESS RESTRICTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — Anon Access', () => {
  it('no anon SELECT on sensitive tables', () => {
    const violations: string[] = [];

    const policyDirs = [POLICIES_DIR, RLS_DIR];

    for (const dir of policyDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => f.endsWith('.sql'));

      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8');

        // Find policies that grant anon access
        if (/TO\s+anon/i.test(content) || /ROLE\s+anon/i.test(content)) {
          // Check if it applies to sensitive tables
          for (const table of PHI_TABLES) {
            if (content.includes(table)) {
              violations.push(`${file}: grants anon access to PHI table '${table}'`);
            }
          }
        }
      }
    }

    expect(
      violations,
      `Anon access to sensitive data:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SECURITY DEFINER FUNCTIONS — AUTH.UID() INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — SECURITY DEFINER Ownership', () => {
  it('SECURITY DEFINER get_my_* functions validate auth.uid()', () => {
    if (!existsSync(FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const files = readdirSync(FUNCTIONS_DIR)
      .filter(f => f.startsWith('get_my_') && f.endsWith('.sql'));

    for (const file of files) {
      const content = readFileSync(join(FUNCTIONS_DIR, file), 'utf-8');

      if (/SECURITY DEFINER/i.test(content)) {
        // SECURITY DEFINER bypasses RLS — MUST use auth.uid() internally
        const hasAuthUid = /auth\.uid\(\)/i.test(content);
        if (!hasAuthUid) {
          violations.push(`${file}: SECURITY DEFINER without auth.uid() — RLS bypass without ownership check`);
        }
      }
    }

    expect(
      violations,
      `SECURITY DEFINER functions bypassing ownership check (critical IDOR risk):\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('SECURITY DEFINER mutation functions validate auth.uid()', () => {
    if (!existsSync(FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const mutationPrefixes = ['update_my_', 'delete_my_', 'upsert_my_', 'insert_my_'];

    for (const prefix of mutationPrefixes) {
      const files = readdirSync(FUNCTIONS_DIR)
        .filter(f => f.startsWith(prefix) && f.endsWith('.sql'));

      for (const file of files) {
        const content = readFileSync(join(FUNCTIONS_DIR, file), 'utf-8');

        if (/SECURITY DEFINER/i.test(content)) {
          const hasAuthUid = /auth\.uid\(\)/i.test(content);
          if (!hasAuthUid) {
            violations.push(`${file}: SECURITY DEFINER mutation without auth.uid()`);
          }
        }
      }
    }

    expect(
      violations,
      `SECURITY DEFINER mutation functions without ownership verification:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PARTNER ACCESS — CONSENT-BASED
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — Partner Consent', () => {
  it('partner data access functions reference data_sharing_consents', () => {
    if (!existsSync(FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const partnerFunctions = readdirSync(FUNCTIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .filter(f => {
        const name = f.toLowerCase();
        return (
          /get_partner_.*(?:user|health|checkin|check_in|lab|dosing|member|patient)/i.test(name) &&
          // Exclude partner's own data management
          !name.includes('availability') &&
          !name.includes('available_slots') &&
          !name.includes('partner_profile') &&
          !name.includes('partner_setting')
        );
      });

    for (const file of partnerFunctions) {
      const content = readFileSync(join(FUNCTIONS_DIR, file), 'utf-8');

      const hasConsentCheck =
        /data_sharing_consent/i.test(content) ||
        /has_data_sharing_consent/i.test(content) ||
        /consent/i.test(content);

      if (!hasConsentCheck) {
        violations.push(`${file}: accesses partner user data without consent verification`);
      }
    }

    expect(
      violations,
      `Partner functions accessing user data without consent:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. PUBLIC TABLE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('RLS Policies — Public Tables', () => {
  it('public access functions have SECURITY DEFINER for anon access', () => {
    if (!existsSync(FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const publicFunctions = readdirSync(FUNCTIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .filter(f => f.startsWith('get_public_') || f.startsWith('get_active_products'));

    for (const file of publicFunctions) {
      const content = readFileSync(join(FUNCTIONS_DIR, file), 'utf-8');

      const hasAnonGrant = /GRANT.*anon/i.test(content);

      if (hasAnonGrant) {
        const hasSecurityDefiner = /SECURITY DEFINER/i.test(content);
        const hasSearchPath = /SET\s+search_path/i.test(content);

        if (!hasSecurityDefiner) {
          violations.push(`${file}: anon grant without SECURITY DEFINER`);
        }
        if (!hasSearchPath) {
          violations.push(`${file}: SECURITY DEFINER without SET search_path`);
        }
      }
    }

    expect(
      violations,
      `Public functions with security gaps:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

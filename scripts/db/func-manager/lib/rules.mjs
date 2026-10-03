/**
 * Function Category Definitions & Validation Rules
 *
 * Provides category metadata, anon-access policy, and reusable validation rules
 * for the func-manager pipeline.
 *
 * @module scripts/db/func-manager/lib/rules
 */

// ---------------------------------------------------------------------------
// FUNCTION_CATEGORIES
// ---------------------------------------------------------------------------

/**
 * Category definitions with expected security posture.
 */
export const FUNCTION_CATEGORIES = {
  ADMIN: {
    expectedSecurity: 'DEFINER',
    requiresAudit: true,
    requiresRoleCheck: true,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  AUDITED: {
    expectedSecurity: 'DEFINER',
    requiresAudit: true,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  MY_READ: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  MY_WRITE: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  PATIENT: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: true,
    allowedGrants: ['authenticated'],
  },
  PARTNER: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  CONSULTANT: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  PUBLIC: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['anon', 'authenticated'],
  },
  HELPER: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  TRIGGER: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: [],
  },
  SYSTEM: {
    expectedSecurity: 'INVOKER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: [],
  },
  LOGGING: {
    expectedSecurity: 'DEFINER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
  OTHER: {
    expectedSecurity: 'INVOKER',
    requiresAudit: false,
    requiresRoleCheck: false,
    requiresConsentCheck: false,
    allowedGrants: ['authenticated'],
  },
};

// ---------------------------------------------------------------------------
// VALIDATION_RULES
// ---------------------------------------------------------------------------

/** Sensitive / PHI tables that must not be queried with SELECT * */
const PHI_TABLES = [
  'health_check_ins', 'lab_results', 'dosing_logs', 'profiles',
  'questionnaire_responses', 'consents', 'health_documents',
  'health_metrics', 'clinical_assessments',
];

/**
 * Reusable validation rules.
 * Each rule exposes `check(sql, metadata) → boolean`.
 * Returns **true** when the rule PASSES (no violation).
 */
export const VALIDATION_RULES = {
  DEFINER_SEARCH_PATH: {
    severity: 'error',
    message: 'SECURITY DEFINER functions must SET search_path',
    check(sql, meta) {
      if (meta.security !== 'DEFINER') return true;
      return /SET\s+search_path/i.test(sql);
    },
  },

  AUDIT_INSERT: {
    severity: 'warning',
    message: 'AUDITED functions should have audit INSERT',
    check(sql, meta) {
      if (meta.category !== 'AUDITED') return true;
      return (
        /INSERT\s+INTO\s+audit_journal\b/i.test(sql) ||
        /write_audit_journal\s*\(/i.test(sql) ||
        /record_audit_log\s*\(/i.test(sql)
      );
    },
  },

  NO_SELECT_STAR_PHI: {
    severity: 'error',
    message: 'No SELECT * on sensitive data tables',
    check(sql) {
      for (const table of PHI_TABLES) {
        const re = new RegExp(
          `SELECT\\s+\\*\\s+FROM\\s+(?:public\\.)?${table}\\b`,
          'i',
        );
        if (re.test(sql)) return false;
      }
      return true;
    },
  },

  REVOKE_BEFORE_GRANT: {
    severity: 'warning',
    message: 'GRANT should be preceded by REVOKE ALL',
    check(sql) {
      if (!/GRANT\s+EXECUTE/i.test(sql)) return true; // no GRANT → N/A
      return /REVOKE\s+ALL/i.test(sql);
    },
  },
};

// ---------------------------------------------------------------------------
// canHaveAnonAccess
// ---------------------------------------------------------------------------

/** Name patterns that are safe for anonymous access */
const PUBLIC_PATTERNS = [
  /^get_public_/,
  /^get_products$/,
  /^get_certified_/,
  /^get_translations$/,
  /^get_supported_/,
  /^is_email_/,
  /^get_hero_/,
  /^get_testimonials$/,
  /^get_faq$/,
];

/** Name patterns that MUST NOT be anonymously accessible */
const SENSITIVE_PATTERNS = [
  /admin/,
  /user/,
  /health/,
  /consent/,
  /\bmy_/,
  /patient/,
  /dosing/,
  /lab_result/,
];

/**
 * Determine whether a function may be granted to `anon`.
 *
 * @param {string} funcName
 * @param {string} sql — full SQL source
 * @returns {{ allowed: boolean; reason: string }}
 */
export function canHaveAnonAccess(funcName, sql) {
  // 1. SQL-level anon guard overrides name-based patterns
  if (sql && /auth\.uid\(\)\s+IS\s+NULL/i.test(sql)) {
    return { allowed: true, reason: 'HAS_ANON_GUARD' };
  }

  // 2. Public name patterns → allowed
  for (const re of PUBLIC_PATTERNS) {
    if (re.test(funcName)) {
      return { allowed: true, reason: 'PUBLIC_PATTERN' };
    }
  }

  // 3. Sensitive name patterns → denied
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(funcName)) {
      return { allowed: false, reason: 'SENSITIVE_PATTERN' };
    }
  }

  // 4. Default deny
  return { allowed: false, reason: 'DEFAULT_DENY' };
}

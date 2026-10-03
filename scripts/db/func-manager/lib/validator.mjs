/**
 * Function Validator
 *
 * Validates PostgreSQL function definitions against security and coding rules.
 * Uses category metadata and validation rules from rules.mjs.
 *
 * @module scripts/db/func-manager/lib/validator
 */

import { FUNCTION_CATEGORIES, VALIDATION_RULES } from './rules.mjs';

// ---------------------------------------------------------------------------
// validateFunction
// ---------------------------------------------------------------------------

/**
 * Validate a single function against all applicable rules.
 *
 * @param {object} func — function metadata object (from parser + grants)
 * @param {string} func.name
 * @param {string} func.sql
 * @param {string} func.security — "DEFINER" | "INVOKER"
 * @param {boolean} func.hasSearchPath
 * @param {boolean} func.hasAuditInsert
 * @param {boolean} func.hasRoleCheck
 * @param {boolean} func.hasConsentCheck
 * @param {string} func.category
 * @param {object} [func.grants]
 * @returns {{ valid: boolean; issues: Array<{ rule: string; severity: string; message: string; fix?: object }> }}
 */
export function validateFunction(func) {
  const {
    name,
    sql = '',
    security,
    hasSearchPath,
    hasAuditInsert,
    hasRoleCheck,
    hasConsentCheck,
    category,
    grants,
  } = func;

  const issues = [];
  const catConfig = FUNCTION_CATEGORIES[category];

  // 1. SECURITY_MISMATCH — only for high-security categories
  const securityCategories = ['ADMIN', 'AUDITED', 'PATIENT', 'MY_READ', 'MY_WRITE'];
  if (
    catConfig?.expectedSecurity &&
    security !== catConfig.expectedSecurity &&
    securityCategories.includes(category)
  ) {
    issues.push({
      severity: 'error',
      rule: 'SECURITY_MISMATCH',
      message: `${category} function expected SECURITY ${catConfig.expectedSecurity} but has ${security}`,
    });
  }

  // 2. MISSING_SEARCH_PATH — DEFINER without SET search_path
  if (security === 'DEFINER' && !hasSearchPath) {
    issues.push({
      severity: 'error',
      rule: 'MISSING_SEARCH_PATH',
      message: `SECURITY DEFINER function ${name} missing SET search_path`,
    });
  }

  // 3. ANON_ACCESS_FORBIDDEN — anon grant on restricted category
  if (grants?.anon) {
    if (!catConfig?.allowedGrants?.includes('anon')) {
      issues.push({
        severity: 'error',
        rule: 'ANON_ACCESS_FORBIDDEN',
        message: `${category} function ${name} should not have anon GRANT`,
        fix: {
          type: 'revoke_anon',
          sql: `REVOKE EXECUTE ON FUNCTION ${name} FROM anon;`,
        },
      });
    }
  }

  // 4. TRIGGER_HAS_GRANTS — triggers should not be user-callable
  if (category === 'TRIGGER' && (grants?.authenticated || grants?.anon)) {
    issues.push({
      severity: 'warning',
      rule: 'TRIGGER_HAS_GRANTS',
      message: `Trigger function ${name} should not have user-facing GRANTs`,
    });
  }

  // 5. MISSING_AUDIT — AUDITED functions must INSERT into audit_journal
  if (category === 'AUDITED' && !hasAuditInsert) {
    issues.push({
      severity: 'warning',
      rule: 'MISSING_AUDIT',
      message: `AUDITED function ${name} missing audit INSERT`,
    });
  }

  // 6. MISSING_ROLE_CHECK — ADMIN functions need authorization guard
  if (category === 'ADMIN' && !hasRoleCheck) {
    issues.push({
      severity: 'warning',
      rule: 'MISSING_ROLE_CHECK',
      message: `ADMIN function ${name} missing role check`,
    });
  }

  // 7. MISSING_CONSENT_CHECK — PATIENT functions need consent verification
  if (category === 'PATIENT' && !hasConsentCheck) {
    issues.push({
      severity: 'warning',
      rule: 'MISSING_CONSENT_CHECK',
      message: `PATIENT function ${name} missing consent check`,
    });
  }

  // 8. Generic VALIDATION_RULES (from rules.mjs)
  for (const [ruleName, rule] of Object.entries(VALIDATION_RULES)) {
    if (!rule.check(sql, func)) {
      issues.push({
        severity: rule.severity,
        rule: ruleName,
        message: rule.message,
      });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

// ---------------------------------------------------------------------------
// validateAllFunctions
// ---------------------------------------------------------------------------

/**
 * Validate an array of functions and aggregate results.
 *
 * @param {object[]} funcs — array of function metadata objects
 * @returns {{ total: number; valid: number; errors: number; byCategory: object; issues: object[] }}
 */
export function validateAllFunctions(funcs) {
  const byCategory = {};
  const allIssues = [];
  let validCount = 0;
  let errorCount = 0;

  for (const func of funcs) {
    const result = validateFunction(func);
    const cat = func.category || 'OTHER';

    if (!byCategory[cat]) {
      byCategory[cat] = { total: 0, valid: 0, errors: 0 };
    }
    byCategory[cat].total++;

    if (result.valid) {
      validCount++;
      byCategory[cat].valid++;
    } else {
      errorCount++;
      byCategory[cat].errors++;
    }

    allIssues.push({
      name: func.name,
      category: cat,
      issues: result.issues,
    });
  }

  return {
    total: funcs.length,
    valid: validCount,
    errors: errorCount,
    byCategory,
    issues: allIssues,
  };
}

// ---------------------------------------------------------------------------
// generateFixScript
// ---------------------------------------------------------------------------

/**
 * Collect all fixable issues and produce a single SQL migration script.
 * Returns `null` when there are no auto-fixable issues.
 *
 * @param {{ issues: Array<{ name: string; category: string; issues: Array<{ fix?: { sql: string } }> }> }} validationResults
 * @returns {string | null}
 */
export function generateFixScript(validationResults) {
  const fixes = [];

  for (const entry of validationResults.issues || []) {
    for (const issue of entry.issues || []) {
      if (issue.fix?.sql) {
        fixes.push(issue.fix.sql);
      }
    }
  }

  if (fixes.length === 0) return null;

  return [
    '-- AUTO-GENERATED FIX SCRIPT',
    `-- Generated at: ${new Date().toISOString()}`,
    '',
    ...fixes,
    '',
  ].join('\n');
}

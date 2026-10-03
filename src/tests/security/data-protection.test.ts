import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { zdrojBezKomentaru } from '../lib/bez-komentaru';

/**
 * Real Data Protection Tests
 *
 * Statically analyzes source code for:
 * 1. Zod schema validation on all RPC mutation hooks
 * 2. File upload security (MIME type validation in storage operations)
 * 3. Filename sanitization in upload paths
 * 4. Input length bounds in RPC parameters
 * 5. Sensitive data column protection (explicit column lists, no SELECT *)
 * 6. Audit trail completeness on sensitive data operations
 */

const PROJECT_ROOT = process.cwd();
const HOOKS_DIR = join(PROJECT_ROOT, 'src/hooks');
const SQL_FUNCTIONS_DIR = join(PROJECT_ROOT, 'aisha/db/sql/functions');
const SCHEMAS_DIR = join(PROJECT_ROOT, 'src/schemas');
const LIB_SCHEMAS_DIR = join(PROJECT_ROOT, 'src/lib/schemas');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSafe(path: string): string {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function collectTsFiles(dir: string): Array<{ relPath: string; content: string }> {
  if (!existsSync(dir)) return [];
  const results: Array<{ relPath: string; content: string }> = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      // ⛔ KONTROLY SE PTAJÍ KÓDU, NE PRÓZY (naměřeno 2026-09-02).
      //
      // Sbírají se jen .ts/.tsx, takže zabělit komentáře je tu bezpečné
      // (u YAML/SQL by nebylo — `//` tam komentář neuvozuje).
      results.push({
        relPath: relative(PROJECT_ROOT, full),
        content: zdrojBezKomentaru(readFileSync(full, 'utf-8')),
      });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ZOD SCHEMA VALIDATION ON MUTATION HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — Schema Validation', () => {
  it('Zod schemas exist for data validation', () => {
    const schemaDirs = [SCHEMAS_DIR, LIB_SCHEMAS_DIR];
    const schemaFiles: string[] = [];

    for (const dir of schemaDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
      schemaFiles.push(...files);
    }

    expect(
      schemaFiles.length,
      'At least one Zod schema file should exist in src/schemas/ or src/lib/schemas/'
    ).toBeGreaterThan(0);
  });

  it('mutation hooks with user input use schema validation or type-safe RPC', () => {
    if (!existsSync(HOOKS_DIR)) return;

    const hookFiles = readdirSync(HOOKS_DIR)
      .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
      .filter(f => !f.startsWith('index'));

    const mutationHooks = hookFiles.filter(f => {
      const content = readSafe(join(HOOKS_DIR, f));
      return /useMutation/.test(content);
    });

    // Mutation hooks should pass data through RPC (which has server-side validation)
    // or use Zod/schema validation before sending
    const violations: string[] = [];
    const ALLOWLIST = new Set<string>([
      // Reviewed: no user-provided payloads or no data mutation payload to validate.
      'useAdminGuard.ts',
      'useAuthActions.ts', // Auth actions delegate to Keycloak OIDC — no user payload validation needed.
      'useConsentAuditLogger.ts',
      'useDocumentSignedUrl.ts',
      'useVoucher.ts',
    ]);

    for (const f of mutationHooks) {
      const content = readSafe(join(HOOKS_DIR, f));

      // Check if it uses RPC (type-safe via Supabase)
      const usesRpc = /\.rpc\s*\(/.test(content);
      // Or has schema validation
      const hasValidation = /\.parse\(|\.safeParse\(|schema|Schema|zodResolver/i.test(content);
      // Or uses Supabase auth or OIDC auth (which has its own validation)
      const usesAuth = /supabase\.auth\.|@\/integrations\/auth/i.test(content);
      // Or uses edge function invoke
      const usesEdge = /\.functions\.invoke/i.test(content);

      if (!usesRpc && !hasValidation && !usesAuth && !usesEdge && !ALLOWLIST.has(f)) {
        violations.push(f);
      }
    }

    expect(
      violations,
      `Security-critical: mutation hooks without validation path (add Zod validation, RPC, or reviewed allowlist entry):\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FILE UPLOAD SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — File Upload Security', () => {
  it('upload hooks validate file MIME types', () => {
    if (!existsSync(HOOKS_DIR)) return;

    const uploadHooks = readdirSync(HOOKS_DIR)
      .filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')))
      .filter(f => /upload/i.test(f));

    for (const f of uploadHooks) {
      const content = readSafe(join(HOOKS_DIR, f));

      const hasUpload = /\.upload\s*\(|\.storage/i.test(content);
      if (!hasUpload) continue;

      const hasMimeCheck =
        /content.?type|mime.?type|file\.type|accept/i.test(content) ||
        /ALLOWED_.*TYPE|allowedMime|validTypes|fileTypes/i.test(content);

      expect(
        hasMimeCheck,
        `Upload hook ${f} should validate file MIME types before uploading`
      ).toBe(true);
    }
  });

  it('storage policies exist for upload buckets', () => {
    const storagePoliciesDir = join(PROJECT_ROOT, 'aisha/db/sql/storage');
    if (!existsSync(storagePoliciesDir)) {
      console.warn('⚠️ No storage policies directory found');
      return;
    }

    const policyFiles = readdirSync(storagePoliciesDir).filter(f => f.endsWith('.sql'));
    expect(
      policyFiles.length,
      'Storage policies should exist for upload security'
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SENSITIVE DATA FUNCTIONS — EXPLICIT COLUMNS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — Security-Critical Rules', () => {
  it('SQL functions do not use SELECT * in data-returning functions', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));

    // `SELECT * FROM jsonb_array_elements(...)` / `unnest(...)` / `string_to_array(...)`
    // and similar set-returning functions are NOT real table scans — the
    // "*" refers to the single synthetic column the SRF emits. Skipping them
    // keeps the security gate focused on actual table SELECT * which is the
    // pattern that can leak unintended columns.
    const SET_RETURNING_FNS = [
      'jsonb_array_elements',
      'jsonb_array_elements_text',
      'jsonb_each',
      'jsonb_each_text',
      'json_array_elements',
      'json_array_elements_text',
      'json_each',
      'unnest',
      'string_to_array',
      'regexp_split_to_table',
      'generate_series',
    ];

    for (const file of files) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      // Extract CTE names defined in this file. CTEs introduce a name that is
      // NOT a real table — `SELECT *` on a CTE cannot leak unintended columns
      // because the CTE is closed-form (its column set is fully defined in
      // the same file the auditor reads). The pattern matches both
      // `WITH name AS (` and the multi-CTE comma-separated `, name AS (`.
      const cteNames = new Set<string>();
      for (const m of content.matchAll(/(?:WITH|,)\s+(\w+)\s+AS\s*\(/gi)) {
        cteNames.add(m[1].toLowerCase());
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('--')) continue;

        // Match SELECT * FROM <next-token>. Anything that is a set-returning
        // function call (token followed by `(`) is allowed.
        const m = line.match(/SELECT\s+\*\s+FROM\s+([\w.]+)\s*(\()?/i);
        if (!m) continue;

        const target = m[1];
        const isFunctionCall = Boolean(m[2]);
        const bareName = target.includes('.') ? target.split('.').pop()! : target;
        if (isFunctionCall && SET_RETURNING_FNS.includes(bareName)) continue;
        // SELECT * on a CTE defined in the same file is closed-form — no leak risk.
        if (cteNames.has(bareName.toLowerCase())) continue;

        violations.push(`${file}:${i + 1}`);
      }
    }

    expect(
      violations,
      `Security-critical: SQL functions must avoid SELECT * on real tables (use explicit columns).\nViolations:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

describe('Data Protection — Informational Hygiene Rules', () => {
  it('SQL functions do not use SELECT * in data-returning functions', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));

    for (const file of files) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('--')) continue;

        // Same filter as the security-critical test — drop set-returning fns.
        const m = line.match(/SELECT\s+\*\s+FROM\s+([\w.]+)\s*(\()?/i);
        if (!m) continue;
        if (m[2]) continue; // any function call → skip

        violations.push(`${file}:${i + 1}`);
      }
    }

    // Informational summary for developers (the security-critical check above enforces failure).
    if (violations.length > 0) {
      console.info(
        `ℹ️ Found ${violations.length} SELECT * occurrences on real tables (see security-critical test for failing list).`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AUDIT TRAIL COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — Audit Trail', () => {
  /** Tables containing sensitive data that require audited access. */
  const PHI_TABLE_PATTERNS = [
    'health_check_ins',
    'health_documents',
    'health_metrics',
    'lab_results',
    'dosing_logs',
    'health_states',
    'symptom_logs',
  ];

  it('functions accessing PHI tables have _audited suffix or audit_journal insert', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const files = readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith('.sql'));
    const AUDIT_ALLOWLIST = new Set<string>([
      // Reviewed operational jobs; not user-initiated read paths.
      'backfill_user_streaks.sql',
      'update_leaderboard_rankings.sql',
    ]);

    for (const file of files) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      // Check if this function reads from PHI tables
      const accessesPhi = PHI_TABLE_PATTERNS.some(table =>
        new RegExp(`FROM\\s+(?:public\\.)?${table}\\b`, 'i').test(content)
      );

      if (!accessesPhi) continue;

      // Function must either be _audited or contain audit_journal insert
      const isAudited = file.includes('_audited');
      const hasAuditInsert = /INSERT\s+INTO\s+(?:public\.)?audit_journal/i.test(content) ||
                            /write_audit_journal/i.test(content);
      const isTrigger = /RETURNS\s+TRIGGER/i.test(content) || file.startsWith('trigger_');
      const isHelper = file.startsWith('is_') || file.startsWith('has_') || file.startsWith('check_');
      const isSync = file.includes('sync_') || file.includes('calculate_');

      if (!isAudited && !hasAuditInsert && !isTrigger && !isHelper && !isSync && !AUDIT_ALLOWLIST.has(file)) {
        violations.push(`${file}: accesses PHI data but has no audit trail`);
      }
    }

    expect(
      violations,
      `Security-critical: PHI access must be audited (_audited suffix, audit_journal insert, or reviewed allowlist exception):\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RPC-ONLY DATA ACCESS IN FRONTEND
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — RPC-Only Access', () => {
  // Přímý přístup na tabulku: `.from('tabulka')`, ale ne `storage.from('bucket')`.
  //
  // ⛔ DŘÍV SE KOMENTÁŘE PŘESKAKOVALY PO ŘÁDCÍCH, A TO NESTAČILO
  // (naměřeno 2026-09-02). Podmínka zněla „řádek po ořezu začíná `//` nebo
  // `*`" — chytila komentář na SAMOSTATNÉM řádku a pokračování blokového
  // komentáře, ale minula dva případy, které hlásily FALEŠNÝ NÁLEZ:
  //
  //   const x = 1; // dřív klient.from('users')     ← komentář na konci řádku
  //   /* dřív: klient.from('users') */              ← první řádek bloku
  //
  // Komentáře se proto strhávají už při čtení souboru (collectTsFiles)
  // a řádkové přeskakování zmizelo — po zabělení by bylo mrtvé.
  //
  // POZN.: popis je v ŘÁDKOVÝCH komentářích schválně. V blokovém by druhý
  // příklad musel obsahovat `*/`, což by komentář ukončilo uprostřed věty —
  // a obejít to neviditelnou mezerou znamená chybu `no-irregular-whitespace`.
  const VZOR_PRIMEHO_PRISTUPU = /(?<!storage\.)\bfrom\s*\(\s*['"]/;

  /**
   * Čísla řádků (od 1), kde hook sahá na tabulku přímo.
   *
   * Zabělení komentářů si dělá sama, i když jí `collectTsFiles` předává text
   * už zabělený — je idempotentní, a díky tomu je funkce ověřitelná fixturou
   * (viz testy pod kontrolou). Bez toho seamu by fixtura testovala pomůcku,
   * ne tuhle kontrolu.
   */
  function najdiPrimyPristup(obsah: string): number[] {
    const radky = zdrojBezKomentaru(obsah).split('\n');
    const nalezy: number[] = [];

    for (let i = 0; i < radky.length; i++) {
      if (!VZOR_PRIMEHO_PRISTUPU.test(radky[i])) continue;

      // Okolí rozhodne, jestli jde o úložiště (bucket), ne o tabulku.
      const okoli = radky.slice(Math.max(0, i - 3), Math.min(radky.length, i + 3)).join('\n');
      const jeUloziste = /\.storage\b|\.upload\(|\.download\(|\.getPublicUrl\(|\.remove\(|\.list\(/.test(okoli);

      if (!jeUloziste) nalezy.push(i + 1);
    }

    return nalezy;
  }

  it('hooks do not use .from() for direct table access', () => {
    const hookFiles = collectTsFiles(HOOKS_DIR);
    const violations: string[] = [];

    /** Known exceptions — re-exports, barrel files, storage hooks. */
    const EXCEPTIONS = new Set([
      'src/hooks/index.ts',
    ]);

    /** Hooks that legitimately use .from() for Supabase Storage (not tables). */
    const STORAGE_HOOKS = [
      'useProductImageUpload',
      'useTrackingDocuments',
      'useDocumentUpload',
      'useFileUpload',
      'useAvatarUpload',
      'useImageUpload',
      'useStorage',
    ];

    for (const file of hookFiles) {
      if (EXCEPTIONS.has(file.relPath)) continue;
      if (file.relPath.includes('/tests/') || file.relPath.includes('.test.')) continue;

      // Skip storage hooks — .from() is for bucket access, not table access
      const isStorageHook = STORAGE_HOOKS.some(h => file.relPath.includes(h));
      if (isStorageHook) continue;

      // Match klient.from("table") patterns
      // but only non-storage chains (storage uses .upload, .download, .getPublicUrl)
      for (const radek of najdiPrimyPristup(file.content)) {
        violations.push(`${file.relPath}:${radek} — direct .from() table access`);
      }
    }

    expect(
      violations,
      `Hooks using direct table access instead of RPC:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  // ⛔ NAPSÁNO ČERVENÉ proti dřívějšímu přeskakování po řádcích
  // (naměřeno 2026-09-02). To znalo jen komentář na SAMOSTATNÉM řádku;
  // druhý a třetí případ níž hlásily falešný nález.
  describe('najdiPrimyPristup — ptá se kódu, ne prózy', () => {
    it('najde skutečný přímý přístup', () => {
      expect(najdiPrimyPristup(`const { data } = await klient.from('users').select();`)).toEqual([1]);
    });

    it('nehlásí komentář na KONCI řádku', () => {
      expect(najdiPrimyPristup(`const x = 1; // dřív to bylo klient.from('users')`)).toEqual([]);
    });

    it('nehlásí PRVNÍ řádek blokového komentáře', () => {
      expect(najdiPrimyPristup(`/* dřív: klient.from('users') */\nconst x = 1;`)).toEqual([]);
    });

    it('nehlásí komentář na samostatném řádku (uměl už dřív)', () => {
      expect(najdiPrimyPristup(`// klient.from('users')`)).toEqual([]);
    });

    it('přístup na úložiště není přístup na tabulku', () => {
      expect(najdiPrimyPristup(`await klient.storage.from('avatars').upload(cesta, soubor);`)).toEqual([]);
    });

    it('čísla řádků zůstávají po zabělení platná', () => {
      expect(najdiPrimyPristup(`// pozn.\n\nawait klient.from('users').select();`)).toEqual([3]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CONSENT-BASED DATA ACCESS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Protection — Consent-Based Access', () => {
  it('partner data access functions that read USER health data check consent', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];

    // Only flag functions where a partner reads USER data (health, check_ins, lab, dosing)
    // NOT partner's own profile/availability management
    const partnerFunctions = readdirSync(SQL_FUNCTIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .filter(f => {
        const name = f.toLowerCase();
        // Must be partner accessing USER data, not partner's OWN data
        return (
          (/partner/.test(name) && /(?:user|health|checkin|check_in|lab|dosing|member|patient)/.test(name)) &&
          // Exclude partner's own data management
          !name.includes('availability') &&
          !name.includes('available_slots') &&
          !name.includes('partner_profile') &&
          !name.includes('partner_setting') &&
          !name.includes('partner_dashboard') &&
          !name.includes('partner_subscription') &&
          // Exclude platform admin operations
          !name.includes('claim_user') &&
          !name.includes('unclaimed_users') &&
          !name.includes('permissions') &&
          !name.includes('app_permissions')
        );
      });

    for (const file of partnerFunctions) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      const hasConsentCheck =
        /has_data_sharing_consent/i.test(content) ||
        /data_sharing_consents/i.test(content) ||
        /consent/i.test(content);

      const isAdminOnly = /is_admin_or_staff/i.test(content) && !/practitioner/i.test(content);

      if (!hasConsentCheck && !isAdminOnly) {
        violations.push(`${file}: partner data access without consent check`);
      }
    }

    expect(
      violations,
      `Partner access functions without consent validation:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

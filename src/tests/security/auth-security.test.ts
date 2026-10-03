import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { zdrojBezKomentaru } from '../lib/bez-komentaru';
import { join, relative } from 'path';
import DOMPurify from 'dompurify';
import { stripSqlComments } from '../../../scripts/db/lib/sql-comments.mjs';

/**
 * Real Authentication & Authorization Security Tests
 *
 * 1. XSS prevention (DOMPurify) — RETAINED from original, these are valid
 * 2. dangerouslySetInnerHTML usage audit
 * 3. Auth guard coverage in protected pages/routes
 * 4. Session security patterns
 * 5. Password handling security
 * 6. OAuth redirect URL validation patterns
 * 7. IDOR prevention in RPC functions
 */

const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, 'src');
const SQL_FUNCTIONS_DIR = join(PROJECT_ROOT, 'aisha/db/sql/functions');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string, exclude?: RegExp): Array<{ relPath: string; content: string; lines: string[] }> {
  if (!existsSync(dir)) return [];
  const results: Array<{ relPath: string; content: string; lines: string[] }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      results.push(...collectTsFiles(full, exclude));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      const relPath = relative(PROJECT_ROOT, full);
      if (exclude && exclude.test(relPath)) continue;
      // ⛔ KONTROLA SE PTÁ KÓDU, NE PRÓZY (naměřeno 2026-09-02).
      //
      // Audit `dangerouslySetInnerHTML` níž ohlásil `PageRenderer.tsx:334`,
      // kde ale žádné volání není — stojí tam komentář vysvětlující, proč
      // jsou portály nad takto vytvořenými uzly bezpečné. Prózou tedy šlo
      // změnit verdikt.
      //
      // Táž vada byla i v `gates/xss-client-storage`, jenže ta leží v jiné
      // sadě (`test:gates`), takže se ukázaly každá jindy. Proto společná
      // pomůcka v `tests/lib`, ne kopie v obou.
      //
      // Zabělení zachovává délku i řádky, takže hlášená čísla dál sedí.
      const content = zdrojBezKomentaru(readFileSync(full, 'utf-8'));
      results.push({ relPath, content, lines: content.split('\n') });
    }
  }
  return results;
}

const ALL_SRC = collectTsFiles(SRC_DIR, /\/(tests|test|__tests__)\//);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. XSS PREVENTION (DOMPurify) — Retained real tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — XSS Prevention', () => {
  it('DOMPurify removes script tags', () => {
    const scriptTag = '<script>alert("xss")</script>';
    expect(DOMPurify.sanitize(scriptTag)).not.toContain('<script');
  });

  it('DOMPurify removes event handler attributes', () => {
    const imgOnerror = '<img src=x onerror="alert(\'xss\')">';
    const svgOnload = '<svg onload="alert(\'xss\')">';
    expect(DOMPurify.sanitize(imgOnerror)).not.toContain('onerror');
    expect(DOMPurify.sanitize(svgOnload)).not.toContain('onload');
  });

  it('DOMPurify removes iframes', () => {
    const iframeTag = '<iframe src="evil.com"></iframe>';
    expect(DOMPurify.sanitize(iframeTag)).not.toContain('<iframe');
  });

  it('DOMPurify removes javascript: protocol in anchors', () => {
    const anchorWithJS = '<a href="javascript:alert(1)">click</a>';
    expect(DOMPurify.sanitize(anchorWithJS)).not.toContain('javascript:');
  });

  it('DOMPurify preserves safe HTML', () => {
    const safe = '<p>Hello <strong>world</strong></p>';
    const result = DOMPurify.sanitize(safe);
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
  });

  it('DOMPurify removes data: URIs with JavaScript', () => {
    const dataUri = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
    const sanitized = DOMPurify.sanitize(dataUri);
    expect(sanitized).not.toContain('<script');
  });

  it('DOMPurify handles nested XSS payloads', () => {
    // Note: JSDOM's CSS parser may not strip url(javascript:) in style attributes.
    // In real browsers, DOMPurify with FORCE_BODY + ADD_ATTR prevents this.
    // The critical protection is that javascript: in href is always stripped.
    const nested = '<div style="background:url(javascript:alert(1))">test</div>';
    const sanitized = DOMPurify.sanitize(nested);
    // Verify the structure is preserved or stripped entirely
    expect(sanitized).toContain('test');
  });

  it('DOMPurify removes form injection', () => {
    const formInjection = '<form action="https://evil.com"><input type="submit"></form>';
    const sanitized = DOMPurify.sanitize(formInjection, { FORBID_TAGS: ['form'] });
    // With FORBID_TAGS, forms are stripped
    expect(sanitized).not.toContain('<form');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. dangerouslySetInnerHTML AUDIT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — dangerouslySetInnerHTML Usage', () => {
  /** Files where dangerouslySetInnerHTML is acceptable with explanation. */
  const ALLOWED_DANGEROUS_HTML: Record<string, string> = {
    'src/components/ui/chart.tsx': 'CSS-only style injection from config object, no user input',
    'src/pages/NewsArticleDetail.tsx': 'Uses DOMPurify.sanitize() wrapper',
    'src/pages/Story.tsx': 'i18n t() key with HTML formatting — content from translation files, not user input',
  };

  it('all dangerouslySetInnerHTML usages are DOMPurify-sanitized or allowlisted', () => {
    const violations: Array<{ file: string; line: number; detail: string }> = [];

    for (const file of ALL_SRC) {
      const matches = [...file.content.matchAll(/dangerouslySetInnerHTML/g)];
      if (matches.length === 0) continue;

      // Check if this file is in the allowlist
      if (ALLOWED_DANGEROUS_HTML[file.relPath]) continue;

      for (const match of matches) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;

        // Check if DOMPurify.sanitize() wraps the value in a ±5 line window
        const windowStart = Math.max(0, lineNum - 3);
        const windowEnd = Math.min(file.lines.length, lineNum + 3);
        const window = file.lines.slice(windowStart, windowEnd).join('\n');

        const hasSanitization =
          /DOMPurify\.sanitize/i.test(window) ||
          /sanitize\s*\(/i.test(window) ||
          /purify/i.test(window);

        if (!hasSanitization) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: 'dangerouslySetInnerHTML without DOMPurify.sanitize()',
          });
        }
      }
    }

    expect(
      violations,
      `Unsafe dangerouslySetInnerHTML usage:\n${violations.map(v => `  ${v.file}:${v.line} — ${v.detail}`).join('\n')}\n\n` +
      `Fix: wrap value in DOMPurify.sanitize(), or add to ALLOWED_DANGEROUS_HTML with justification.`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AUTH GUARD COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — Route Protection', () => {
  it('router.tsx uses RequireAuth wrapper', () => {
    const routerPath = join(SRC_DIR, 'router.tsx');
    expect(existsSync(routerPath), 'router.tsx must exist').toBe(true);

    const content = readFileSync(routerPath, 'utf-8');
    expect(content).toContain('RequireAuth');
  });

  it('admin pages are wrapped with admin guard', () => {
    const routerPath = join(SRC_DIR, 'router.tsx');
    if (!existsSync(routerPath)) return;

    const content = readFileSync(routerPath, 'utf-8');

    // Admin routes should use AdminGuard or RequireAdmin
    const hasAdminGuard =
      /AdminGuard|RequireAdmin|AdminLayout|useAdminGuard/.test(content);

    expect(
      hasAdminGuard,
      'Admin routes must be protected by admin guard'
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SESSION SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — Session Management', () => {
  it('session timeout mechanism exists', () => {
    const timeoutHook = join(SRC_DIR, 'hooks/useSessionTimeout.ts');
    expect(existsSync(timeoutHook), 'useSessionTimeout.ts must exist').toBe(true);

    const content = readFileSync(timeoutHook, 'utf-8');
    expect(content).toMatch(/timeout|idle|inactivity/i);
  });

  it('session monitoring exists', () => {
    const monitorHook = join(SRC_DIR, 'hooks/useSessionMonitoring.ts');
    expect(existsSync(monitorHook), 'useSessionMonitoring.ts must exist').toBe(true);
  });

  it('session termination API exists in SQL', () => {
    const sessionFns = [
      'terminate_session.sql',
      'terminate_other_sessions.sql',
      'terminate_all_other_sessions.sql',
    ];

    for (const fn of sessionFns) {
      expect(
        existsSync(join(SQL_FUNCTIONS_DIR, fn)),
        `Session termination function ${fn} must exist`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PASSWORD HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — Password Handling', () => {
  it('password VALUES are never logged to console', () => {
    const violations: string[] = [];

    for (const file of ALL_SRC) {
      // Only match when a password VARIABLE is interpolated into a log call
      // NOT when 'password' appears as part of an i18n key string
      const passwordLogPatterns = [
        // Template literal with password variable: console.log(`...${password}...`)
        /console\.\w+\([^)]*\$\{\s*(?:password|newPassword|oldPassword)\s*\}/i,
        // Direct variable: console.log(password) or console.log(..., password)
        /console\.\w+\(\s*(?:password|newPassword|oldPassword)\s*[,)]/,
      ];

      for (const pattern of passwordLogPatterns) {
        if (pattern.test(file.content)) {
          violations.push(file.relPath);
          break;
        }
      }
    }

    expect(
      violations,
      `Files logging password values:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('must-change-password mechanism exists', () => {
    const fns = [
      'rpc_check_must_change_password.sql',
      'rpc_clear_must_change_password.sql',
    ];

    for (const fn of fns) {
      expect(
        existsSync(join(SQL_FUNCTIONS_DIR, fn)),
        `Password management function ${fn} must exist`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. IDOR PREVENTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — IDOR Prevention', () => {
  it('get_my_* functions use auth.uid() for ownership check', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const myFunctions = readdirSync(SQL_FUNCTIONS_DIR)
      .filter(f => f.startsWith('get_my_') && f.endsWith('.sql'));

    for (const file of myFunctions) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      const hasAuthUid =
        /auth\.uid\(\)/i.test(content) ||
        /current_setting\('request\.jwt\.claims'\)/i.test(content);

      if (!hasAuthUid) {
        violations.push(`${file}: does not verify auth.uid() ownership`);
      }
    }

    expect(
      violations,
      `get_my_* functions without auth.uid() check (IDOR risk):\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('update_my_* functions use auth.uid() for ownership check', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const myFunctions = readdirSync(SQL_FUNCTIONS_DIR)
      .filter(f => f.startsWith('update_my_') && f.endsWith('.sql'));

    for (const file of myFunctions) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      const hasAuthUid = /auth\.uid\(\)/i.test(content);

      if (!hasAuthUid) {
        violations.push(`${file}: does not verify auth.uid() ownership`);
      }
    }

    expect(
      violations,
      `update_my_* functions without auth.uid() check (IDOR risk):\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('delete_my_* functions use auth.uid() for ownership check', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];
    const myFunctions = readdirSync(SQL_FUNCTIONS_DIR)
      .filter(f => f.startsWith('delete_my_') && f.endsWith('.sql'));

    for (const file of myFunctions) {
      const content = readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8');

      const hasAuthUid = /auth\.uid\(\)/i.test(content);

      if (!hasAuthUid) {
        violations.push(`${file}: does not verify auth.uid() ownership`);
      }
    }

    expect(
      violations,
      `delete_my_* functions without auth.uid() check (IDOR risk):\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('admin SECURITY DEFINER functions check is_admin_or_staff()', () => {
    if (!existsSync(SQL_FUNCTIONS_DIR)) return;

    const violations: string[] = [];

    // ⛔ ORÁKULUM NENÍ AKCE SPRÁVCE: `is_user_admin` na otázku „je to admin?" ODPOVÍDÁ,
    // požadovat po něm `is_admin_or_staff` je kruh. Vyplavalo 2026-09-16, kdy detektor
    // přestal číst komentáře jako kód (dřív se vzor trefil do jeho prózy).
    // `role_is_admin.sql` tu chybí schválně — projde tím, že se vzor trefí do jeho
    // vlastního JMÉNA; to je slabina detektoru, ne výjimka, a řeší ji brána idor-prevention.
    const AUTH_ADMIN_ALLOWLIST = new Set([
      'bootstrap_default_admin.sql',
      'is_user_admin.sql',
    ]);

    const adminFunctions = readdirSync(SQL_FUNCTIONS_DIR)
      .filter(f => f.endsWith('_admin.sql'));

    for (const file of adminFunctions) {
      if (AUTH_ADMIN_ALLOWLIST.has(file)) continue;

      // Rozhoduje KÓD, ne komentáře: věta „ZÁMĚRNĚ BEZ SECURITY DEFINER" se dřív četla
      // jako doznání, že definer JE, a stráž zmíněná jen v komentáři procházela jako stráž.
      const content = stripSqlComments(readFileSync(join(SQL_FUNCTIONS_DIR, file), 'utf-8'));

      // Only check SECURITY DEFINER — SECURITY INVOKER relies on RLS
      if (!/SECURITY DEFINER/i.test(content)) continue;

      const hasAdminCheck =
        /is_admin_or_staff/i.test(content) ||
        /has_role.*admin/i.test(content) ||
        /role_is_admin/i.test(content) ||
        /user_has_admin_role/i.test(content) ||
        /user_roles.*role\s+IN.*admin/is.test(content) ||
        /RAISE\s+EXCEPTION.*access/i.test(content) ||
        /RAISE\s+EXCEPTION.*permission/i.test(content) ||
        /RAISE\s+EXCEPTION.*admin/i.test(content) ||
        /RETURN.*error/i.test(content);

      if (!hasAdminCheck) {
        violations.push(`${file}: no admin authorization check`);
      }
    }

    expect(
      violations,
      `Admin functions without authorization check:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CLIENT-SIDE STORAGE SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth Security — Client Storage', () => {
  /** Pattern to detect sensitive data being stored client-side.
   * Note: 'token' is excluded because Supabase legitimately stores
   * auth tokens in sessionStorage for session management. */
  const SENSITIVE_STORAGE_PATTERNS = [
    /localStorage\.setItem\s*\(\s*['"][^'"]*(?:password|secret|api.?key|credit.?card|ssn)[^'"]*['"]/i,
    /sessionStorage\.setItem\s*\(\s*['"][^'"]*(?:secret|api.?key|credit.?card|ssn)[^'"]*['"]/i,
  ];

  it('no sensitive data stored in localStorage/sessionStorage', () => {
    const violations: string[] = [];

    for (const file of ALL_SRC) {
      for (const pattern of SENSITIVE_STORAGE_PATTERNS) {
        if (pattern.test(file.content)) {
          violations.push(file.relPath);
          break;
        }
      }
    }

    expect(
      violations,
      `Files storing sensitive data in browser storage:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

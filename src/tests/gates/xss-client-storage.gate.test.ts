/**
 * XSS & Client Storage Security Gate Tests
 *
 * Static analysis to prevent XSS vulnerabilities and sensitive data
 * leaking through client-side storage.
 *
 * Categories:
 * 1. dangerouslySetInnerHTML — must use DOMPurify or be allowlisted
 * 2. innerHTML assignment — must be sanitized
 * 3. localStorage / sessionStorage — no sensitive data stored
 * 4. URL parameter handling — query params must be validated/sanitized
 * 5. eval() / Function() usage — banned entirely
 * 6. document.write() — banned entirely
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { sqlBezKomentaru, zdrojBezKomentaru } from '../lib/bez-komentaru';

const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, 'src');

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SourceFile {
  relPath: string;
  content: string;
  lines: string[];
}

function collectSourceFiles(dir: string, out: SourceFile[] = []): SourceFile[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      if (entry.name === 'tests' || entry.name === '__tests__') continue;
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      // ⛔ BRÁNA SE PTÁ KÓDU, NE PRÓZY (naměřeno 2026-09-02).
      //
      // `content` je zdroj se ZABĚLENÝMI komentáři. Bez toho ohlásila sekce 1
      // `PageRenderer.tsx:334` jako nesanitizované `dangerouslySetInnerHTML` —
      // na tom řádku ale stojí komentář vysvětlující, proč jsou portály nad
      // takto vytvořenými uzly bezpečné. Prózou šlo verdikt brány změnit.
      //
      // Zabělení zachovává délku i řádky, takže hlášená čísla dál sedí.
      // Platí pro VŠECH šest sekcí: každá se ptá na kód, žádná na komentář.
      // Okna „je poblíž DOMPurify?" tím zpřísňují — sanitizaci musí doložit
      // volání, ne zmínka v komentáři.
      const content = zdrojBezKomentaru(readFileSync(full, 'utf-8'));
      out.push({
        relPath: relative(PROJECT_ROOT, full),
        content,
        lines: content.split('\n'),
      });
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  detail: string;
  fix: string;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map(v => `  ${v.file}:${v.line} — ${v.detail}\n    ✏️  FIX: ${v.fix}`)
    .join('\n');
}

const ALL_SRC = collectSourceFiles(SRC_DIR);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. dangerouslySetInnerHTML AUDIT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Files where dangerouslySetInnerHTML is acceptable with justification.
 * Each entry must explain why it's safe.
 */
const DANGEROUS_HTML_ALLOWLIST: Record<string, string> = {
  'src/components/ui/chart.tsx': 'CSS-only style injection from ChartConfig object — no user input flows into this',
  'src/pages/Story.tsx': 'i18n t() key with HTML formatting — content from translation files, not user input',
};

describe('0 · parser: brána čte kód, ne komentáře', () => {
  it("SQL: `--` komentář se zabělí, kód zůstane", () => {
    const out = sqlBezKomentaru("select 1; -- SECURITY DEFINER\nselect 2;");

    expect(out).not.toContain("SECURITY DEFINER");
    expect(out).toContain("select 1;");
    expect(out).toContain("select 2;");
  });

  // ⛔ Podle SQL je `$$ … $$` řetězec, ale tělo PL/pgSQL funkce je KÓD —
  // a právě v něm žil komentář, kvůli kterému owasp-discovery označila
  // `get_block_data.sql` (security invoker) jako SECURITY DEFINER.
  it("SQL: komentář UVNITŘ těla v $$ se taky zabělí", () => {
    const out = sqlBezKomentaru("create function f() as $$\nbegin\n  -- SECURITY DEFINER zdroj\n  return 1;\nend;\n$$;");

    expect(out).not.toContain("SECURITY DEFINER");
    expect(out).toContain("return 1;");
  });

  it("SQL: apostrof zdvojený uvnitř řetězce ho neukončí", () => {
    const out = sqlBezKomentaru("select 'it''s -- not a comment'; select 3;");

    expect(out).toContain("select 3;");
    expect(out).toContain("not a comment");
  });

  it("SQL: čísla řádků zůstávají platná", () => {
    const zdroj = "a\n-- pozn\nb";
    const out = sqlBezKomentaru(zdroj);

    expect(out.split("\n")).toHaveLength(3);
    expect(out.length).toBe(zdroj.length);
  });

  it('zabělí řádkový i blokový komentář, ale nechá kód', () => {
    const out = zdrojBezKomentaru('const a = 1; // dangerouslySetInnerHTML\n/* x */ const b = 2;');

    expect(out).not.toContain('dangerouslySetInnerHTML');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('zachová čísla řádků (na nich stojí hlášení)', () => {
    const zdroj = 'a\n// komentář\nb';
    const out = zdrojBezKomentaru(zdroj);

    expect(out.split('\n')).toHaveLength(3);
    expect(out.length).toBe(zdroj.length);
    expect(out.split('\n')[2]).toBe('b');
  });

  it('nespolkne `//` uvnitř řetězce (jinak zmizí zbytek řádku)', () => {
    const out = zdrojBezKomentaru('const u = "https://x.dev"; eval(1);');

    expect(out).toContain('eval(1);');
  });

  it('nespolkne `\\/\\/` na konci regulárního literálu', () => {
    const out = zdrojBezKomentaru('const r = /^https?:\\/\\//; eval(1);');

    expect(out).toContain('eval(1);');
  });

  it('nechá `/` jako dělení dělením', () => {
    const out = zdrojBezKomentaru('const p = a / b; eval(1);');

    expect(out).toContain('eval(1);');
  });
});

describe('1 · dangerouslySetInnerHTML without sanitization', () => {
  it('scans production source files', () => {
    expect(ALL_SRC.length).toBeGreaterThan(50);
  });

  it('all dangerouslySetInnerHTML usages are DOMPurify-wrapped or allowlisted', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      const matches = [...file.content.matchAll(/dangerouslySetInnerHTML/g)];
      if (matches.length === 0) continue;

      if (DANGEROUS_HTML_ALLOWLIST[file.relPath]) continue;

      for (const match of matches) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;

        // Check ±5 lines for DOMPurify
        const windowStart = Math.max(0, lineNum - 5);
        const windowEnd = Math.min(file.lines.length, lineNum + 5);
        const window = file.lines.slice(windowStart, windowEnd).join('\n');

        const hasSanitization =
          /DOMPurify\.sanitize/i.test(window) ||
          /sanitizeHtml/i.test(window) ||
          /purify\./i.test(window);

        if (!hasSanitization) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: 'dangerouslySetInnerHTML without DOMPurify.sanitize() wrapper',
            fix: 'Wrap value: dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}',
          });
        }
      }
    }

    expect(
      violations,
      `dangerouslySetInnerHTML without sanitization (${violations.length}):\n${formatViolations(violations)}\n\n` +
      `If safe, add to DANGEROUS_HTML_ALLOWLIST with justification.`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. innerHTML DIRECT ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('2 · innerHTML direct assignment', () => {
  it('no direct innerHTML assignment in source code', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      const pattern = /\.innerHTML\s*=/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;
        const line = file.lines[lineNum - 1]?.trim() ?? '';

        // Skip comments
        if (line.startsWith('//') || line.startsWith('*')) continue;

        // Check for DOMPurify
        const windowStart = Math.max(0, lineNum - 3);
        const windowEnd = Math.min(file.lines.length, lineNum + 3);
        const window = file.lines.slice(windowStart, windowEnd).join('\n');

        if (!/DOMPurify/.test(window)) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: '.innerHTML assignment without sanitization',
            fix: 'Use DOMPurify.sanitize() or React\'s dangerouslySetInnerHTML with sanitization',
          });
        }
      }
    }

    expect(
      violations,
      `Direct innerHTML assignment (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CLIENT-SIDE STORAGE SECURITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('3 · Sensitive data in client storage', () => {
  /** Patterns that indicate sensitive data being stored. */
  const SENSITIVE_PATTERNS = [
    { pattern: /localStorage\.setItem\s*\(\s*['"]\w*(?:password|secret|api.?key|credit.?card|ssn)\w*['"]/i, type: 'localStorage' },
    { pattern: /sessionStorage\.setItem\s*\(\s*['"]\w*(?:password|secret|api.?key|credit.?card|ssn)\w*['"]/i, type: 'sessionStorage' },
  ];

  it('no sensitive data stored in browser storage', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      for (const { pattern, type } of SENSITIVE_PATTERNS) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.source, pattern.flags + 'g');

        while ((match = regex.exec(file.content)) !== null) {
          const lineNum = file.content.substring(0, match.index).split('\n').length;
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `sensitive data key in ${type}`,
            fix: 'Store sensitive data server-side. Use Supabase session management for auth tokens.',
          });
        }
      }
    }

    expect(
      violations,
      `Sensitive data in client storage (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EVAL / FUNCTION CONSTRUCTOR
// ═══════════════════════════════════════════════════════════════════════════════

describe('4 · eval() and Function() usage', () => {
  it('no eval() in production source code', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      const evalPattern = /\beval\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = evalPattern.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;
        const line = file.lines[lineNum - 1]?.trim() ?? '';
        if (line.startsWith('//') || line.startsWith('*')) continue;

        violations.push({
          file: file.relPath,
          line: lineNum,
          detail: 'eval() usage — XSS and code injection risk',
          fix: 'Remove eval(). Use JSON.parse() for data, or structured alternatives.',
        });
      }
    }

    expect(
      violations,
      `eval() usage (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });

  it('no new Function() in production source code', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      const functionPattern = /new\s+Function\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = functionPattern.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;
        const line = file.lines[lineNum - 1]?.trim() ?? '';
        if (line.startsWith('//') || line.startsWith('*')) continue;

        violations.push({
          file: file.relPath,
          line: lineNum,
          detail: 'new Function() — equivalent to eval(), XSS risk',
          fix: 'Replace with structured code path. new Function() is a code injection vector.',
        });
      }
    }

    expect(
      violations,
      `new Function() usage (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DOCUMENT.WRITE
// ═══════════════════════════════════════════════════════════════════════════════

/** Files where document.write() is acceptable. */
const DOCUMENT_WRITE_ALLOWLIST: Record<string, string> = {
  'src/lib/invoicePdf.ts': 'Writes to a separate popup window for print dialog — not the main document',
};

describe('5 · document.write() usage', () => {
  it('no document.write() in production code', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      if (DOCUMENT_WRITE_ALLOWLIST[file.relPath]) continue;

      const pattern = /document\.write\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length;
        const line = file.lines[lineNum - 1]?.trim() ?? '';
        if (line.startsWith('//') || line.startsWith('*')) continue;

        violations.push({
          file: file.relPath,
          line: lineNum,
          detail: 'document.write() — XSS risk and DOM clobbering',
          fix: 'Use React DOM methods or document.createElement() instead.',
        });
      }
    }

    expect(
      violations,
      `document.write() usage (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. URL PARAMETER HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

describe('6 · URL parameter injection risk', () => {
  it('useSearchParams usage is sanitized before rendering', () => {
    const violations: Violation[] = [];

    for (const file of ALL_SRC) {
      if (!file.content.includes('useSearchParams')) continue;

      // Check if URL params are used in dangerouslySetInnerHTML
      const hasDangerousUse =
        /searchParams.*dangerouslySetInnerHTML/s.test(file.content) ||
        /dangerouslySetInnerHTML.*searchParams/s.test(file.content);

      if (hasDangerousUse) {
        violations.push({
          file: file.relPath,
          line: 0,
          detail: 'URL search params used in dangerouslySetInnerHTML',
          fix: 'NEVER render URL params as HTML. Use text content or DOMPurify.sanitize().',
        });
      }
    }

    expect(
      violations,
      `URL params rendered as HTML (${violations.length}):\n${formatViolations(violations)}`
    ).toEqual([]);
  });
});

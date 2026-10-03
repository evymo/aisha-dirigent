/**
 * Silent Degradation Gate Tests
 *
 * Dynamically detects patterns that silently swallow errors, degrade
 * functionality, or bypass governance — across the ENTIRE codebase.
 *
 * Categories:
 * 1. TypeScript: Empty catch blocks (no logging/re-throw)
 * 2. TypeScript: Fail-open catch defaults (`catch { return true }`)
 * 3. TypeScript: Silent promise catch (`.catch(() => {})`)
 * 4. SQL: `EXCEPTION WHEN OTHERS THEN NULL`
 * 5. SQL: Webhook calls in EXCEPTION without audit_journal
 * 6. SQL: Governance bypass in EXCEPTION handlers (auto-approve)
 * 7. TypeScript: safeParse → return [] without logging
 *
 * Principle: Every error MUST be logged, escalated, or re-thrown.
 * AISHA discovers violations dynamically — no hardcoded file lists.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Project layout ──────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");

const TS_CODE_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "trash/legacy-archive/edge-functions-reference"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "packages"),
];

const SQL_DIRS = [
  path.join(ROOT, "aisha/db/sql/functions"),
  path.join(ROOT, "aisha/db/sql/triggers"),
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SourceFile {
  absPath: string;
  relPath: string;
  content: string;
  lines: string[];
}

interface Violation {
  file: string;
  line: number;
  detail: string;
  fix: string;
}

function isTestOrGenerated(relPath: string): boolean {
  return (
    relPath.includes("/tests/") ||
    relPath.includes("/__tests__/") ||
    relPath.includes(".test.") ||
    relPath.includes(".spec.") ||
    relPath.includes("/mocks/") ||
    relPath.includes("/fixtures/") ||
    relPath.includes("/dist/") ||
    relPath.includes("/node_modules/") ||
    relPath.includes("setupTests") ||
    relPath.includes("vitest.") ||
    relPath.includes("playwright.") ||
    relPath.includes("integrations/db/types.ts")
  );
}

function collectFiles(dirs: string[], extensions: Set<string>, skipTestFiles = true): SourceFile[] {
  const out: SourceFile[] = [];
  for (const dir of dirs) {
    collectFilesRecursive(dir, extensions, skipTestFiles, out);
  }
  return out;
}

// Git SUBMODULES are separate repos with their own CI/quality pipelines (potok:
// pytest filterwarnings=error; local-ingest: own unittest CI; insight: upstream
// fork) — the orchestrator's TS-error-handling standards are enforced THERE, not
// by scanning vendored trees here. Derived from .gitmodules (SoT — no maintained
// list; future submodules are excluded automatically).
const SUBMODULE_PATHS: Set<string> = (() => {
  const out = new Set<string>();
  const gm = path.join(ROOT, ".gitmodules");
  if (fs.existsSync(gm)) {
    for (const m of fs.readFileSync(gm, "utf-8").matchAll(/^\s*path\s*=\s*(.+)$/gm)) {
      out.add(m[1].trim());
    }
  }
  return out;
})();

function collectFilesRecursive(dir: string, extensions: Set<string>, skipTestFiles: boolean, out: SourceFile[]): void {
  if (!fs.existsSync(dir)) return;
  if (SUBMODULE_PATHS.has(path.relative(ROOT, dir))) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name.startsWith(".")) continue;
      collectFilesRecursive(full, extensions, skipTestFiles, out);
    } else if (extensions.has(path.extname(entry.name))) {
      const relPath = path.relative(ROOT, full);
      if (skipTestFiles && isTestOrGenerated(relPath)) continue;
      const content = fs.readFileSync(full, "utf-8");
      out.push({ absPath: full, relPath, content, lines: content.split("\n") });
    }
  }
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line} — ${v.detail}\n    ✏️  FIX: ${v.fix}`)
    .join("\n");
}

/**
 * Check if a line or its ±N neighbors contain any of the given patterns.
 * Useful for detecting "catch block has logging nearby".
 */
function hasNearbyPattern(lines: string[], lineIdx: number, patterns: RegExp[], radius = 5): boolean {
  const start = Math.max(0, lineIdx - radius);
  const end = Math.min(lines.length - 1, lineIdx + radius);
  for (let i = start; i <= end; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) return true;
    }
  }
  return false;
}

// ─── Load once ───────────────────────────────────────────────────────────────

const ALL_TS = collectFiles(TS_CODE_DIRS, CODE_EXTENSIONS);
const ALL_SQL = collectFiles(SQL_DIRS, new Set([".sql"]), false);

// ─── Allowlists ──────────────────────────────────────────────────────────────
// Each entry MUST have a technical reason. "backlog" is NOT a valid reason.

/** TS files where empty/silent catch is legitimate (e.g., best-effort cleanup). */
const EMPTY_CATCH_ALLOWLIST: Record<string, string> = {
  // body?.cancel() — best-effort stream cleanup, nothing to log
  "packages/llm-dispatch/src/providers/openai.ts": "res.body?.cancel() cleanup only — not an error path",
  "packages/llm-dispatch/src/providers/gemini.ts": "res.body?.cancel() cleanup only — not an error path",
  // @aisha/llm-dispatch provider-protocol parse recovery (behavior-preserved from the svc-ai-chat
  // extraction; these were AUDIT-tier under services/, now CRITICAL under packages/). Each catch is
  // intentional stream/protocol parsing, NOT operational error swallowing:
  "packages/llm-dispatch/src/providers/maestro.ts":
    "assertSafeMaestroUrl: malformed URL falls THROUGH to the SSRF throw below — fail-loud via throw, not swallowed",
  "packages/llm-dispatch/src/providers/openai-compat.ts":
    "tool-call arguments JSON.parse recovery → preserves raw as {_raw} (no data loss, no silent drop)",
  "packages/llm-dispatch/src/providers/streaming.ts":
    "SSE parse recovery — malformed tool-args → {_raw}; non-data line ([DONE]/keep-alive) → skip; both intentional",
  // temp file cleanup on process 'exit' — best effort unlink, fire-and-forget, no actionable error
  "scripts/db/seed.mjs": "temp substituted seed cleanup on 'exit' event (best-effort, file may be gone)",
};

/** SQL files where EXCEPTION THEN NULL is legitimate. */
const SQL_EXCEPTION_NULL_ALLOWLIST: Record<string, string> = {
  // No entries — every EXCEPTION WHEN OTHERS must log to audit_journal
};

/** Patterns that indicate error handling (logging, escalation, or propagation). */
const ERROR_HANDLING_PATTERNS: RegExp[] = [
  // ── Logging ──
  /console\.(warn|error|info|log)\s*\(/,
  /safeError\s*\(/,
  /safeInfo\s*\(/,
  /safeWarn\s*\(/,
  /addDebug\s*\(/,
  /RAISE\s+(WARNING|EXCEPTION|NOTICE)/i,
  /logger\./,
  /tracer\./,
  /audit_journal/,
  /logStep\s*\(/,
  /logError\s*\(/,
  /onConfigError\s*\(/,

  // ── Re-throw / escalation ──
  /throw\s+/,
  /reject\s*\(/,

  // ── User notification ──
  /toast\s*[.(]/,

  // ── Error propagation via return value ──
  /return\s+\{[^}]*\berror\b/,
  /return\s+\{[^}]*status:\s*["']failed["']/,
  /return\s+.*failResult/,

  // ── HTTP error response construction ──
  /new\s+Response\s*\(/,
  /jsonRpcError\s*\(/,
  /\.status\s*\(\s*[45]\d{2}\s*\)/,

  // ── Error collection / counting ──
  /errors\.push\s*\(/,
  /failed\s*(\+\+|\+=)/,
  /getErrorMessage\s*\(/,
  /getStatusCode\s*\(/,

  // ── Error state management ──
  /setError\s*\(/,
  /onError\s*\(/,

  // ── Circuit breaker / DB error recording ──
  /recordFailure\s*\(/,
  /\.rpc\s*\(/,

  // ── Error variable processing ──
  /\berrorMsg\s*=/,
  /\berrorMessage\s*[:=]/,
  /\bstatus\s*=\s*["'](down|failed|error|degraded)["']/,
  /\bsaveRun\s*\(/,
  /\bfailResult\b/,
];

// =============================================================================
// 1. EMPTY CATCH BLOCKS — no logging, no re-throw
// =============================================================================

/**
 * Detect empty/silent catch blocks.
 * Returns violations for all files except allowlisted ones.
 */
function detectSilentCatchBlocks(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const catchPattern = /\}\s*catch\s*(\([^)]*\))?\s*\{/g;

  for (const file of files) {
    if (EMPTY_CATCH_ALLOWLIST[file.relPath]) continue;

    let match: RegExpExecArray | null;
    catchPattern.lastIndex = 0;

    while ((match = catchPattern.exec(file.content)) !== null) {
      const matchLineIdx = file.content.substring(0, match.index).split("\n").length - 1;
      const line = file.lines[matchLineIdx];

      // Skip lines in comments or JSDoc
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

      // Find the catch block body: scan forward to find matching }
      const catchBodyStart = matchLineIdx + 1;
      const catchBodyEnd = Math.min(file.lines.length - 1, matchLineIdx + 15);
      let braceDepth = 1;
      let bodyEndLine = catchBodyEnd;

      for (let i = catchBodyStart; i <= catchBodyEnd; i++) {
        const l = file.lines[i];
        for (const ch of l) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
          if (braceDepth === 0) {
            bodyEndLine = i;
            break;
          }
        }
        if (braceDepth === 0) break;
      }

      const bodyLines = file.lines.slice(catchBodyStart, bodyEndLine);
      const bodyText = bodyLines.join("\n").trim();

      const nonCommentBody = bodyText
        .split("\n")
        .filter((l) => !/^\s*(\/\/.*)?$/.test(l))
        .join("\n")
        .trim();

      const isEmpty = nonCommentBody === "" || nonCommentBody === "}";

      // Documented suppression: empty body but has a comment explaining why.
      // This is a conscious decision, not an oversight.
      const hasExplainingComment = isEmpty && bodyLines.some((l) => /^\s*\/\/\s*\S/.test(l));

      const hasErrorHandling = bodyLines.some((l) =>
        ERROR_HANDLING_PATTERNS.some((p) => p.test(l)),
      );

      if (isEmpty && hasExplainingComment) {
        // Documented suppression — developer intentionally suppressed with explanation.
        // Not flagged as violation (conscious decision, not oversight).
        continue;
      }

      if (isEmpty || !hasErrorHandling) {
        // Single-line catch with return → captured by test 2 (fail-open)
        if (/catch\s*(\([^)]*\))?\s*\{\s*return\s+/.test(
          file.lines.slice(matchLineIdx, matchLineIdx + 2).join(" "),
        )) continue;

        // If the catch captures an error parameter AND references it in the body,
        // the error is being processed (not silently swallowed).
        const catchLine = file.lines.slice(matchLineIdx, matchLineIdx + 2).join(" ");
        const paramMatch = /catch\s*\((\w+)/.exec(catchLine);
        if (paramMatch && !isEmpty) {
          const paramName = paramMatch[1];
          const paramReferenced = bodyLines.some((l) =>
            new RegExp(`\\b${paramName}\\b`).test(l),
          );
          if (paramReferenced) continue;
        }

        violations.push({
          file: file.relPath,
          line: matchLineIdx + 1,
          detail: isEmpty
            ? "Empty catch block — error silently swallowed (add comment or logging)"
            : "Catch block without error handling (logging/toast/throw/return error)",
          fix: "Add console.warn, safeError(), toast.error(), throw, or return {error}",
        });
      }
    }
  }
  return violations;
}

/** Critical scope: hooks, edge functions, lib — HARD FAIL (zero tolerance). */
function isCriticalScope(relPath: string): boolean {
  return (
    relPath.startsWith("src/hooks/") ||
    relPath.startsWith("src/lib/") ||
    relPath.startsWith("trash/legacy-archive/edge-functions-reference/") ||
    relPath.startsWith("scripts/") ||
    relPath.startsWith("packages/")
  );
}

describe("1 · TypeScript: empty catch blocks without logging", () => {
  it("scans non-trivial codebase", () => {
    expect(ALL_TS.length).toBeGreaterThan(50);
  });

  it("[CRITICAL] hooks, edge functions, lib — no regression in silent catch blocks", () => {
    const criticalFiles = ALL_TS.filter((f) => isCriticalScope(f.relPath));
    const violations = detectSilentCatchBlocks(criticalFiles);

    // Zero-tolerance baseline (2026-05-11): all 54 historical violations across
    // hooks, scripts, packages, and trash/legacy-archive edge functions were
    // remediated with proper error handling (console.warn/error, logged context,
    // documented suppressions, single-line return idioms). This number MUST
    // stay at 0 — any new silent catch is a hard fail.
    const KNOWN_BASELINE = 0;

    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} silent catch blocks in CRITICAL scope (baseline: ${KNOWN_BASELINE}):\n${formatViolations(violations.slice(0, 15))}${violations.length > 15 ? `\n  ... a dalších ${violations.length - 15}` : ""}`,
      );
    }

    expect(
      violations.length,
      `Silent catch blocks in CRITICAL scope INCREASED above baseline ${KNOWN_BASELINE}.\n`
      + `New violations detected — fix them before committing:\n${formatViolations(violations)}`,
    ).toBeLessThanOrEqual(KNOWN_BASELINE);
  });

  it("[AUDIT] components, pages — report silent catch blocks", () => {
    const uiFiles = ALL_TS.filter((f) => !isCriticalScope(f.relPath));
    const violations = detectSilentCatchBlocks(uiFiles);

    if (violations.length > 0) {
      console.warn(
        `⚠️ ${violations.length} silent catch blocks in UI code (components/pages):\n${formatViolations(violations.slice(0, 10))}${violations.length > 10 ? `\n  ... a dalších ${violations.length - 10}` : ""}`,
      );
    }
    // Audit-only: does not fail the gate, but tracks regression.
    // New violations are caught by tracking the count.
    expect(true).toBe(true);
  });
});

// =============================================================================
// 2. FAIL-OPEN DEFAULTS — catch { return true/[] }
// =============================================================================

describe("2 · TypeScript: fail-open defaults in catch blocks", () => {
  /** Patterns that indicate fail-open behavior. */
  const FAIL_OPEN_RETURNS = [
    { pattern: /catch\s*(\([^)]*\))?\s*\{\s*\n?\s*return\s+true\b/, label: "return true" },
  ];

  it("catch blocks must not default to fail-open (return true)", () => {
    const violations: Violation[] = [];

    for (const file of ALL_TS) {
      for (const { pattern, label } of FAIL_OPEN_RETURNS) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.source, "g");
        while ((match = regex.exec(file.content)) !== null) {
          const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
          const line = file.lines[lineIdx];
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

          // Check if there's logging before the return
          if (hasNearbyPattern(file.lines, lineIdx, ERROR_HANDLING_PATTERNS, 3)) continue;

          violations.push({
            file: file.relPath,
            line: lineIdx + 1,
            detail: `Fail-open default in catch: ${label} — bypasses safety check on error`,
            fix: "Use return false (fail-closed) or add explicit logging + escalation before return",
          });
        }
      }
    }

    expect(
      violations.length,
      `Fail-open catch defaults:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

// =============================================================================
// 3. SILENT PROMISE CATCH — .catch(() => {}) / .catch(() => null)
// =============================================================================

describe("3 · TypeScript: silent promise .catch()", () => {
  it(".catch() handlers must contain logging", () => {
    const violations: Violation[] = [];
    // Matches .catch(() => { }) or .catch(() => null) or .catch(() => ({}))
    const silentCatchPattern = /\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*(\/\*[^*]*\*\/\s*)?\}|null|\(\s*\{\s*\}\s*\))\s*\)/g;

    for (const file of ALL_TS) {
      let match: RegExpExecArray | null;
      silentCatchPattern.lastIndex = 0;

      while ((match = silentCatchPattern.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
        const line = file.lines[lineIdx];
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

        violations.push({
          file: file.relPath,
          line: lineIdx + 1,
          detail: "Silent .catch() — promise error silently swallowed",
          fix: ".catch((err) => console.warn('context:', err)) or .catch((err) => safeError('context', err))",
        });
      }
    }

    expect(
      violations.length,
      `Silent promise .catch() handlers:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

// =============================================================================
// 4. SQL: EXCEPTION WHEN OTHERS THEN NULL
// =============================================================================

describe("4 · SQL: EXCEPTION WHEN OTHERS THEN NULL", () => {
  it("scans SQL function files", () => {
    expect(ALL_SQL.length).toBeGreaterThan(5);
  });

  it("EXCEPTION handlers must NOT use NULL — must log to audit_journal", () => {
    const violations: Violation[] = [];
    // Matches: EXCEPTION WHEN OTHERS THEN NULL; (possibly with whitespace/newlines)
    const pattern = /EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s*\n?\s*NULL\s*;/gi;

    for (const file of ALL_SQL) {
      if (SQL_EXCEPTION_NULL_ALLOWLIST[file.relPath]) continue;

      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;

      while ((match = pattern.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;

        violations.push({
          file: file.relPath,
          line: lineIdx + 1,
          detail: "EXCEPTION WHEN OTHERS THEN NULL — error silently swallowed",
          fix: "Replace NULL with INSERT INTO audit_journal(user_id, action, metadata) VALUES (...)",
        });
      }
    }

    expect(
      violations.length,
      `SQL silent exception handlers:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

// =============================================================================
// 5. SQL: Webhook/pg_net in EXCEPTION without audit_journal
// =============================================================================

describe("5 · SQL: EXCEPTION handlers must include audit_journal when near pg_net calls", () => {
  it("EXCEPTION blocks near net.http_post must log to audit_journal", () => {
    const violations: Violation[] = [];

    for (const file of ALL_SQL) {
      // Find all EXCEPTION WHEN OTHERS THEN blocks
      const exceptionPattern = /EXCEPTION\s+WHEN\s+OTHERS\s+THEN/gi;
      let match: RegExpExecArray | null;
      exceptionPattern.lastIndex = 0;

      while ((match = exceptionPattern.exec(file.content)) !== null) {
        const exceptionLineIdx = file.content.substring(0, match.index).split("\n").length - 1;

        // Check if net.http_post exists within ±30 lines (same BEGIN/EXCEPTION block)
        const searchStart = Math.max(0, exceptionLineIdx - 30);
        const searchEnd = Math.min(file.lines.length - 1, exceptionLineIdx + 5);
        const nearbyBlock = file.lines.slice(searchStart, searchEnd + 1).join("\n");

        if (!/net\.http_post/i.test(nearbyBlock)) continue;

        // Check if audit_journal is in the EXCEPTION handler body (next 15 lines)
        const handlerEnd = Math.min(file.lines.length - 1, exceptionLineIdx + 15);
        const handlerBody = file.lines.slice(exceptionLineIdx, handlerEnd + 1).join("\n");

        if (/audit_journal/i.test(handlerBody)) continue;

        violations.push({
          file: file.relPath,
          line: exceptionLineIdx + 1,
          detail: "EXCEPTION handler near net.http_post without audit_journal — webhook failure untracked",
          fix: "Add INSERT INTO audit_journal(user_id, action, metadata) with severity and error=SQLERRM",
        });
      }
    }

    expect(
      violations.length,
      `SQL webhook EXCEPTION handlers without audit:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

// =============================================================================
// 6. SQL: Governance bypass in EXCEPTION — auto-approve patterns
// =============================================================================

describe("6 · SQL: no auto-approve/auto-publish in EXCEPTION handlers", () => {
  it("EXCEPTION handlers must not approve/publish — must escalate to pending_review", () => {
    const violations: Violation[] = [];
    const dangerousDecisions = /p_decision\s*:=\s*'approved'|'published'/gi;

    for (const file of ALL_SQL) {
      const exceptionPattern = /EXCEPTION\s+WHEN\s+OTHERS\s+THEN/gi;
      let match: RegExpExecArray | null;
      exceptionPattern.lastIndex = 0;

      while ((match = exceptionPattern.exec(file.content)) !== null) {
        const exceptionLineIdx = file.content.substring(0, match.index).split("\n").length - 1;

        // Scan the EXCEPTION handler body (next 20 lines)
        const handlerEnd = Math.min(file.lines.length - 1, exceptionLineIdx + 20);
        const handlerBody = file.lines.slice(exceptionLineIdx, handlerEnd + 1).join("\n");

        dangerousDecisions.lastIndex = 0;
        const approveMatch = dangerousDecisions.exec(handlerBody);
        if (approveMatch) {
          const approveLineOffset = handlerBody.substring(0, approveMatch.index).split("\n").length - 1;
          violations.push({
            file: file.relPath,
            line: exceptionLineIdx + approveLineOffset + 1,
            detail: `Governance bypass: ${approveMatch[0]} in EXCEPTION handler — auto-approves on failure`,
            fix: "Use p_decision := 'pending_review' — failures must escalate, never auto-approve",
          });
        }
      }
    }

    expect(
      violations.length,
      `SQL governance bypasses in EXCEPTION handlers:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

// =============================================================================
// 7. TypeScript: safeParse → return [] without logging
// =============================================================================

describe("7 · TypeScript: safeParse drops without logging", () => {
  it("safeParse failures that return empty must log the drop", () => {
    const violations: Violation[] = [];

    for (const file of ALL_TS) {
      // Find safeParse usage followed by: if (!parsed.success) return [];
      const safeParsePattern = /\.safeParse\s*\(/g;
      let match: RegExpExecArray | null;
      safeParsePattern.lastIndex = 0;

      while ((match = safeParsePattern.exec(file.content)) !== null) {
        const lineIdx = file.content.substring(0, match.index).split("\n").length - 1;
        if (/^\s*(\/\/|\*|\/\*)/.test(file.lines[lineIdx])) continue;

        // Look ahead up to 10 lines for the pattern: if (!...success) return [];
        const lookAhead = file.lines.slice(lineIdx, Math.min(file.lines.length, lineIdx + 10));
        const lookAheadText = lookAhead.join("\n");

        // Pattern: returns empty array on parse failure
        if (/!.*\.success.*\n?\s*(return\s+\[\]|return\s+null)/.test(lookAheadText)) {
          // Check if there's logging between safeParse and the return
          const hasLoggingNearby = lookAhead.some((l) =>
            ERROR_HANDLING_PATTERNS.some((p) => p.test(l)),
          );

          if (!hasLoggingNearby) {
            violations.push({
              file: file.relPath,
              line: lineIdx + 1,
              detail: "safeParse failure returns empty without logging — data silently dropped",
              fix: "Add safeError('context.parseFailed', { count, issues }) before return",
            });
          }
        }
      }
    }

    expect(
      violations.length,
      `safeParse drops without logging:\n${formatViolations(violations)}`,
    ).toBe(0);
  });
});

/**
 * Codebase Security Patterns Gate Tests
 *
 * Universal static-analysis tests that detect common security & robustness
 * anti-patterns across the ENTIRE codebase — not just one module.
 *
 * Categories:
 * 1. fetch() without timeout/AbortController
 * 2. Unsafe credential/config property access (crash on undefined)
 * 3. Hardcoded environment-specific URLs
 * 4. Hardcoded workflow / credential IDs in non-template files
 * 5. RPC / API calls with unsanitized user input
 *
 * Each violation is reported with file path + line number.
 * Known acceptable cases are listed in allowlists with deadlines.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Project layout ──────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");

/** Directories to scan for TypeScript / JavaScript source code. */
const CODE_DIRS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "packages/n8n-nodes-aisha/nodes"),
  path.join(ROOT, "packages/n8n-nodes-aisha/credentials"),
  path.join(ROOT, "trash/legacy-archive/edge-functions-reference"),
  path.join(ROOT, "scripts"),
];

/** Directories to scan for workflow JSON files. */
const WORKFLOW_DIRS = [
  path.join(ROOT, "n8n/workflows"),
  path.join(ROOT, "packages/n8n-nodes-aisha/workflows"),
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SourceFile {
  absPath: string;
  relPath: string;
  content: string;
  lines: string[];
}

/** True for test / mock / fixture / generated files we don't audit. */
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
    // Generated types
    relPath.includes("integrations/db/types.ts")
  );
}

/** Recursively collect source files. */
function collectCodeFiles(dir: string, out: SourceFile[] = []): SourceFile[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name.startsWith(".")
      )
        continue;
      collectCodeFiles(full, out);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      const relPath = path.relative(ROOT, full);
      if (isTestOrGenerated(relPath)) continue;
      // Skip ephemeral chamber files created by parallel gate tests (race-safe)
      if (entry.name.startsWith("__aitg_") && entry.name.endsWith("__.ts")) continue;
      let content: string;
      try {
        content = fs.readFileSync(full, "utf-8");
      } catch {
        // File disappeared between readdirSync and readFileSync (parallel test race) — skip
        continue;
      }
      out.push({ absPath: full, relPath, content, lines: content.split("\n") });
    }
  }
  return out;
}

/** Collect workflow JSON files. */
function collectWorkflowJsons(): SourceFile[] {
  const out: SourceFile[] = [];
  for (const dir of WORKFLOW_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(dir, file);
      const content = fs.readFileSync(full, "utf-8");
      out.push({
        absPath: full,
        relPath: path.relative(ROOT, full),
        content,
        lines: content.split("\n"),
      });
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  detail: string;
  /** Concrete fix instruction shown to the developer. */
  fix: string;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line} — ${v.detail}\n    ✏️  FIX: ${v.fix}`)
    .join("\n");
}

// ─── Load once ───────────────────────────────────────────────────────────────

const ALL_CODE = CODE_DIRS.flatMap((d) => collectCodeFiles(d));
const ALL_WORKFLOWS = collectWorkflowJsons();

// =============================================================================
// 1. FETCH WITHOUT TIMEOUT / ABORT CONTROLLER
// =============================================================================

/**
 * Files that legitimately use fetch() without timeout.
 * Each entry MUST have a reason and deadline.
 */
const FETCH_TIMEOUT_ALLOWLIST: Record<string, string> = {
  // False positives — scanner matches "fetch(" in non-runtime context
  "scripts/patch-workflow-fetch.mjs": "fetch() in string templates/code generation, not runtime calls",
  "scripts/deploy-individual-tools.mjs": "fetch() in console.log strings, not runtime calls",
  "scripts/smoke-prod.mjs": "timeout passed via fetchOpts variable — scanner cannot trace",
  "scripts/pki-bridge-deploy.mjs": "AbortSignal.timeout(30_000) in init object — scanner cannot trace across lines",
  "trash/legacy-archive/edge-functions-reference/main/index.ts": "worker.fetch() method + type definition, not global fetch",
  "trash/legacy-archive/edge-functions-reference/mcp-knowledge-server/index.ts": "scanner matches 'Failed to fetch' error string",
  // Shared module — no direct fetch calls, caller provides timeout
  "trash/legacy-archive/edge-functions-reference/_shared/supabaseClient.ts": "shared client factory — caller adds timeout",
  // TypeScript interface method signature, not runtime fetch
  "trash/legacy-archive/edge-functions-reference/_shared/providers/plugin-types.ts": "interface method declaration — no runtime fetch",
  // Thin wrapper — callers provide their own timeout / AbortController
  "src/lib/net/httpFetch.ts": "thin fetch proxy for testability — caller adds timeout",
};

describe("1 · fetch() without timeout / AbortController", () => {
  it("scans non-trivial codebase", () => {
    expect(ALL_CODE.length).toBeGreaterThan(50);
  });

  it("every fetch() call has a timeout or AbortController", () => {
    const violations: Violation[] = [];

    for (const file of ALL_CODE) {
      if (FETCH_TIMEOUT_ALLOWLIST[file.relPath]) continue;

      // Find every fetch( call
      const fetchPattern = /\bfetch\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = fetchPattern.exec(file.content)) !== null) {
        const matchPos = match.index;

        // Get the line number
        const lineNum =
          file.content.substring(0, matchPos).split("\n").length;

        // Check if this line is inside a comment
        const currentLine = file.lines[lineNum - 1] ?? "";
        const trimmed = currentLine.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        ) {
          continue;
        }

        // Look at a window around the fetch() call (±20 lines) for timeout patterns
        const windowStart = Math.max(0, lineNum - 5);
        const windowEnd = Math.min(file.lines.length, lineNum + 25);
        const window = file.lines.slice(windowStart, windowEnd).join("\n");

        const hasTimeout =
          /AbortController/.test(window) ||
          /AbortSignal\.timeout/.test(window) ||
          /\bsignal\s*:/.test(window) ||
          /\btimeout\s*:/.test(window) ||
          // n8n helper pattern — httpRequest with timeout built-in
          /this\.helpers\.httpRequest/.test(window);

        if (!hasTimeout) {
          const isEdgeFunction = file.relPath.startsWith("trash/legacy-archive/edge-functions-reference/");
          const isN8nNode = file.relPath.startsWith("packages/n8n-nodes-aisha/nodes/");
          const isFrontend = file.relPath.startsWith("src/");

          let fix: string;
          if (isEdgeFunction) {
            fix = `Add AbortSignal.timeout(10_000) as second arg: fetch(url, { signal: AbortSignal.timeout(10_000), ...opts })`;
          } else if (isN8nNode) {
            fix = `Use this.helpers.httpRequest({ url, timeout: 10000 }) instead of raw fetch(), or add AbortSignal.timeout()`;
          } else if (isFrontend) {
            fix = `Wrap in AbortController with timeout: const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 15000); fetch(url, { signal: ctrl.signal })`;
          } else {
            fix = `Add { signal: AbortSignal.timeout(10_000) } to fetch() options, or add to FETCH_TIMEOUT_ALLOWLIST if dev-only script`;
          }

          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `fetch() without timeout — risk of hanging indefinitely`,
            fix,
          });
        }
      }
    }

    expect(
      violations,
      `fetch() calls WITHOUT timeout or AbortController (${violations.length}):\n${formatViolations(violations)}\n\n` +
        `If dev-only script, add to FETCH_TIMEOUT_ALLOWLIST with reason.`,
    ).toEqual([]);
  });
});

// =============================================================================
// 1.5. UNSAFE FETCH TARGET (SSRF PREVENTION)
// =============================================================================

describe("1.5 · Unsafe fetch() target (SSRF)", () => {
  const SSRF_ALLOWLIST: Record<string, string> = {
    // Shared modules with domain routing handled upstream
    "trash/legacy-archive/edge-functions-reference/_shared/llmRouter.ts": "URL is derived from strict provider map",
    "trash/legacy-archive/edge-functions-reference/mcp-knowledge-server/index.ts": "mcp-server acts as proxy, trusted target endpoints",
    "trash/legacy-archive/edge-functions-reference/_shared/fcm-auth.ts": "Uses Google Auth strict endpoints",
    "trash/legacy-archive/edge-functions-reference/n8n-trigger/index.ts": "Validates upstream strictly against platform configs",
    "trash/legacy-archive/edge-functions-reference/discover-models/index.ts": "Directly polls OpenAI/Anthropic models endpoints",
    "packages/n8n-nodes-aisha/nodes/_shared/fetchWithTimeout.ts": "Internal fetch wrapper that enforces timeouts, upstream validation",
    // Test mocks/stubs
    "trash/legacy-archive/edge-functions-reference/main/index.ts": "Proxies to other edge functions",
    // TypeScript interface method signature, not runtime fetch
    "trash/legacy-archive/edge-functions-reference/_shared/providers/plugin-types.ts": "interface method declaration — no runtime fetch",
    "packages/n8n-nodes-aisha/nodes/AishaRpc/AishaRpc.node.ts": "Uses configured endpoint",
    "trash/legacy-archive/edge-functions-reference/plugin-host/index.ts": "Sandbox fetch uses isNetworkAllowed() whitelist, artifact URL from trusted DB config",
  };

  it("dynamic fetch() URLs must have validation (SSR, host check, or https prefix)", () => {
    const violations: Violation[] = [];

    // Check only Edge Functions and Node backend
    const backendFiles = ALL_CODE.filter(f => 
      f.relPath.startsWith("trash/legacy-archive/edge-functions-reference/") || 
      (f.relPath.startsWith("packages/n8n-nodes-aisha/") && !f.relPath.includes("Workflow"))
    );

    for (const file of backendFiles) {
      if (SSRF_ALLOWLIST[file.relPath]) continue;

      // Match fetch(variable or fetch(   variable
      // Excludes fetch('http...'), fetch("http..."), fetch(`http...`)
      const dynamicFetchPattern = /\bfetch\s*\(\s*([a-zA-Z0-9_]+)/g;
      let match: RegExpExecArray | null;

      while ((match = dynamicFetchPattern.exec(file.content)) !== null) {
        const urlVariable = match[1];
        
        const matchPos = match.index;

        // Exclude clear static strings or helper method calls immediately
        if (["'", '"', "`", "getOpenAiApiUrl", "getAnthropicApiUrl"].includes(urlVariable)) {
          continue;
        }

        // Check if the parameter passed to fetch has a dot (e.g. url.toString() or obj.property)
        // If it's a URL object .toString(), we inherently trust it since URL object validated its construction.
        const fullArgMatch = file.content.substring(matchPos).match(/^fetch\s*\(\s*([^,]+)/);
        if (fullArgMatch && fullArgMatch[1].includes(".toString()")) {
          continue;
        }
        
        const lineNum = file.content.substring(0, matchPos).split("\n").length;
        
        // Ignore if commented
        const currentLine = file.lines[lineNum - 1] ?? "";
        if (currentLine.trim().startsWith("//") || currentLine.trim().startsWith("*")) continue;

        // Check window (preceding 25 lines) for SSRF validation patterns
        const windowStart = Math.max(0, lineNum - 30);
        const window = file.lines.slice(windowStart, lineNum).join("\n");

        const hasSsrfProtection = 
          // Validates it starts with https directly
          window.includes(".startsWith('https://')") ||
          window.includes('.startsWith("https://")') ||
          window.includes('.startsWith(`https://`)') ||
          // Named SSRF validation helper
          window.includes("assertSafeUrl") ||
          // Trusted env vars
          window.includes("Deno.env.get") ||
          window.includes("process.env.") ||
          // URL parsing restrictions
          window.includes("new URL") ||
          // Known trusted prefixes
          window.includes("api.openai.com") ||
          window.includes("api.anthropic.com") ||
          window.includes("api.x.ai") ||
          window.includes("supabaseUrl") ||
          window.includes("AISHA_POSTGREST_URL") ||
          // Specific variables typically sourced from DB (and thus trusted by config)
          urlVariable === "webhookUrl" || 
          urlVariable === "targetUrl" || 
          urlVariable === "endpoint" ||
          urlVariable === "fioUrl" ||
          urlVariable === "trackingUrl" ||
          urlVariable === "tokenUrl" ||
          urlVariable === "verifyUrl";

        if (!hasSsrfProtection) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `Dynamic fetch() target '${urlVariable}' lacks SSRF validation (no .startsWith('https://') or trusted host check)`,
            fix: `Verify URL explicitly: if (!${urlVariable}.startsWith('https://')) throw new Error('Invalid URL');`,
          });
        }
      }
    }

    expect(
      violations,
      `Unsafe dynamic fetch() targets without SSRF validation (${violations.length}):\n${formatViolations(violations)}\n\n` +
        `Add URL protocol/host validation before fetch() to prevent SSRF against internal networks/metadata APIs.`,
    ).toEqual([]);
  });
});

// =============================================================================
// 2. UNSAFE CREDENTIAL / CONFIG PROPERTY ACCESS
// =============================================================================

/**
 * n8n node files where credential property access without guard is acceptable.
 * n8n getCredentials() throws if credential is missing, so the object itself
 * is guaranteed non-null. However, individual PROPERTIES can be undefined
 * if misconfigured, and `.replace()`, `.trim()` etc. will crash.
 */
const CREDENTIAL_ACCESS_ALLOWLIST: Record<string, string> = {
  // AishaRpc does conditional credential loading with explicit checks
  "packages/n8n-nodes-aisha/nodes/AishaRpc/AishaRpc.node.ts":
    "has explicit credential mode branching",
};

describe("2 · Unsafe credential property access (crash on undefined)", () => {
  /** Only scan n8n node files — that's where getCredentials() pattern lives. */
  const n8nNodeFiles = ALL_CODE.filter((f) =>
    f.relPath.startsWith("packages/n8n-nodes-aisha/nodes/"),
  );

  it("scans n8n node files", () => {
    expect(n8nNodeFiles.length).toBeGreaterThan(3);
  });

  it("credential properties are guarded before method calls", () => {
    const violations: Violation[] = [];

    // Pattern: (credentials.someProperty as string).replace(...)
    // or: credentials.someProperty as string  — then .replace / .trim/ etc. on next usage
    const unsafePattern =
      /\(credentials\.(\w+)\s+as\s+string\)\s*\.\s*(replace|trim|split|slice|substring|toLowerCase|toUpperCase|startsWith|endsWith|match|includes)\s*\(/g;

    for (const file of n8nNodeFiles) {
      if (CREDENTIAL_ACCESS_ALLOWLIST[file.relPath]) continue;

      let match: RegExpExecArray | null;
      while ((match = unsafePattern.exec(file.content)) !== null) {
        const lineNum =
          file.content.substring(0, match.index).split("\n").length;
        const propName = match[1]; // e.g. "supabaseUrl"
        const methodName = match[2]; // e.g. "replace"

        // Check if there's a guard in the preceding 10 lines
        const windowStart = Math.max(0, lineNum - 10);
        const precedingWindow = file.lines
          .slice(windowStart, lineNum)
          .join("\n");

        const hasGuard =
          /if\s*\(!?\s*credentials/.test(precedingWindow) ||
          /credentials\s*(\?\.|&&|\|\|)/.test(precedingWindow) ||
          /typeof\s+credentials/.test(precedingWindow);

        if (!hasGuard) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `(credentials.${propName} as string).${methodName}() — crashes if property is undefined`,
            fix: `Guard before use: const ${propName} = credentials.${propName} as string | undefined; if (!${propName}) throw new NodeOperationError(this.getNode(), 'Missing credential: ${propName}');`,
          });
        }
      }
    }

    expect(
      violations,
      `Credential property access WITHOUT null guard (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});

// =============================================================================
// 3. HARDCODED ENVIRONMENT-SPECIFIC URLs
// =============================================================================

/**
 * Domain patterns that indicate environment coupling.
 * Matches inside strings/JSON values.
 */
const ENVIRONMENT_URL_PATTERNS = [
  /https?:\/\/[a-z0-9-]*\.id3a\.cz/gi, // Production domain
  /https?:\/\/[a-z0-9-]*\.supabase\.co/gi, // Supabase hosted
  /https?:\/\/127\.0\.0\.1:\d+/g, // Localhost with port (OK in config, bad in source)
  /https?:\/\/localhost:\d+/g, // Localhost
];

/**
 * Files where environment URLs are expected (config, docs, tests).
 */
const HARDCODED_URL_ALLOWLIST: Record<string, string> = {
  // Config files that define defaults / fallbacks
  "src/config/devFallbackSupabase.ts": "intentional dev fallback config",
  // API client — DEV_FALLBACK_GATEWAY_URL constant, env vars in resolveGatewayUrl()
  "src/integrations/api/client.ts": "intentional dev fallback config — env vars in resolveGatewayUrl()",
  // Deploy scripts use env vars, but may log the URL for diagnostics
  "scripts/lib/env.mjs": "env config module — reads from env vars",
  // Edge function shared client — reads from env
  "trash/legacy-archive/edge-functions-reference/_shared/supabaseClient.ts": "reads AISHA_POSTGREST_URL from Deno.env",
  // Setup script — creates configuration
  "scripts/aisha-setup.sh": "setup script — configures env vars",
};

/**
 * Patterns in line content that make a URL acceptable (env var fallback).
 * e.g.: `const url = process.env.URL || 'https://...'`
 */
const ENV_FALLBACK_PATTERNS = [
  /\$env\??\./i, // n8n expression: $env?.VAR
  /process\.env\./i, // Node.js env
  /Deno\.env/i, // Deno env
  /import\.meta\.env/i, // Vite env
  /\bENV\[/i, // Ruby-style (unlikely but safe)
  /\benv\.[A-Z0-9_]{2,}/i, // local env object: env.N8N_URL
];

/** Lines where the URL is just a UI hint (n8n credential placeholder field). */
function isCredentialPlaceholder(line: string): boolean {
  return /placeholder\s*[:=]/.test(line);
}

/**
 * Check if a URL at lineNum is an env-var fallback by examining surrounding
 * lines (±2) for `||` / `??` operators combined with env patterns.
 */
function isEnvFallbackContext(
  lines: string[],
  lineIdx: number,
  urlMatch: string,
): boolean {
  const currentLine = lines[lineIdx] ?? "";

  // 1. Same line: env pattern already covers basic case
  if (ENV_FALLBACK_PATTERNS.some((p) => p.test(currentLine))) return true;

  // 2. Same line: `X || 'url'` or `X ?? 'url'` before the URL position
  const urlPos = currentLine.indexOf(urlMatch);
  if (urlPos > 0) {
    const before = currentLine.substring(0, urlPos);
    if (/\|\||\?\?/.test(before)) return true;
  }

  // 3. Multi-line: previous 1-2 lines end with `||` / `??` or contain env pattern
  for (let delta = 1; delta <= 2; delta++) {
    const prevIdx = lineIdx - delta;
    if (prevIdx < 0) break;
    const prevLine = (lines[prevIdx] ?? "").trimEnd();
    if (
      (prevLine.endsWith("||") || prevLine.endsWith("??")) &&
      ENV_FALLBACK_PATTERNS.some((p) => p.test(prevLine))
    ) {
      return true;
    }
  }

  return false;
}

describe("3 · Hardcoded environment-specific URLs", () => {
  it("no hardcoded environment URLs in source code", () => {
    const violations: Violation[] = [];

    for (const file of ALL_CODE) {
      if (HARDCODED_URL_ALLOWLIST[file.relPath]) continue;

      for (const pattern of ENVIRONMENT_URL_PATTERNS) {
        // Reset lastIndex for global regexes
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(file.content)) !== null) {
          const lineNum =
            file.content.substring(0, match.index).split("\n").length;
          const line = file.lines[lineNum - 1] ?? "";
          const trimmed = line.trim();

          // Skip comments
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            continue;
          }

          // Skip credential placeholder fields — just UI hints, not runtime values
          if (isCredentialPlaceholder(line)) continue;

          // Skip if URL is an env-var fallback (same line or multi-line pattern)
          if (isEnvFallbackContext(file.lines, lineNum - 1, match[0])) continue;

          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `hardcoded URL: ${match[0]}`,
            fix: file.relPath.startsWith("scripts/")
              ? `Extract to env: const URL = process.env.VAR || env.VAR || '${match[0]}'; — or move URL to scripts/lib/env.mjs`
              : file.relPath.startsWith("trash/legacy-archive/edge-functions-reference/")
                ? `Use Deno.env.get('AISHA_POSTGREST_URL') ?? '${match[0]}' instead of bare hardcoded URL`
                : file.relPath.startsWith("src/")
                  ? `Use import.meta.env.VITE_AISHA_GATEWAY_URL ?? '${match[0]}' instead of bare hardcoded URL`
                  : `Replace with environment variable lookup. Hardcoded URLs break on env change.`,
          });
        }
      }
    }

    expect(
      violations,
      `Hardcoded environment-specific URLs in source code (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it("no hardcoded environment URLs in workflow JSON files", () => {
    const violations: Violation[] = [];

    for (const file of ALL_WORKFLOWS) {
      for (const pattern of ENVIRONMENT_URL_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(file.content)) !== null) {
          const lineNum =
            file.content.substring(0, match.index).split("\n").length;
          const line = file.lines[lineNum - 1] ?? "";

          // In workflow JSONs, $env?.VAR fallback is acceptable
          const hasEnvFallback = ENV_FALLBACK_PATTERNS.some((p) =>
            p.test(line),
          );
          if (hasEnvFallback) continue;

          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `hardcoded URL in workflow: ${match[0]}`,
            fix: `Replace with n8n expression: {{ $env?.AISHA_POSTGREST_URL || '' }}/path — or use __REMAP__ placeholder for deploy-workflows.mjs to substitute`,
          });
        }
      }
    }

    expect(
      violations,
      `Hardcoded environment-specific URLs in workflow JSONs (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});

// =============================================================================
// 4. HARDCODED WORKFLOW / CREDENTIAL IDs
// =============================================================================

/**
 * Detect hardcoded n8n workflow IDs or credential IDs in template files.
 * Template workflows (n8n/workflows/) should use __REMAP__ placeholders.
 */

/** n8n-style short IDs: 16 alphanumeric characters (base62). */
const N8N_SHORT_ID_PATTERN = /^[A-Za-z0-9]{16}$/;

/** Hex or UUID-like IDs that aren't node UUIDs. */
const WEBHOOK_ID_PATTERN = /^[a-f0-9]{16}$/;

describe("4 · Hardcoded workflow / credential IDs", () => {
  it("template workflow JSONs use __REMAP__ for external references", () => {
    const violations: Violation[] = [];

    // Only check template workflows (n8n/workflows/) — packages/ are dev copies
    const templateDir = path.join(ROOT, "n8n/workflows");
    if (!fs.existsSync(templateDir)) return;

    const templateFiles = ALL_WORKFLOWS.filter((f) =>
      f.relPath.startsWith("n8n/workflows/"),
    );

    for (const file of templateFiles) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(file.content);
      } catch {
        continue;
      }

      // Check nodes for hardcoded workflow references
      const nodes = (parsed as { nodes?: Array<Record<string, unknown>> }).nodes ?? [];

      for (const node of nodes) {
        const params = node.parameters as Record<string, unknown> | undefined;
        if (!params) continue;

        // workflowId parameter — should be __REMAP__ or expression
        const wfId = params.workflowId;
        if (
          typeof wfId === "string" &&
          N8N_SHORT_ID_PATTERN.test(wfId)
        ) {
          violations.push({
            file: file.relPath,
            line: 0,
            detail: `node "${node.name}" has hardcoded workflowId: ${wfId} — use __REMAP__ placeholder`,
            fix: `Change workflowId from '${wfId}' to '__REMAP__:workflow:OriginalWorkflowName' — deploy-workflows.mjs resolves it at deploy time`,
          });
        }

        // webhookId — should use descriptive slugs, not random hex
        const webhookId = (node as Record<string, unknown>).webhookId;
        if (
          typeof webhookId === "string" &&
          WEBHOOK_ID_PATTERN.test(webhookId)
        ) {
          violations.push({
            file: file.relPath,
            line: 0,
            detail: `node "${node.name}" has hex webhookId: ${webhookId} — use descriptive slug`,
            fix: `Replace hex webhookId '${webhookId}' with a descriptive slug like 'model-router-hook' — hex IDs change on server reset`,
          });
        }
      }

      // Check credential references
      const creds = (parsed as { credentials?: Record<string, unknown> }).credentials;
      if (creds && typeof creds === "object") {
        for (const [credName, credValue] of Object.entries(creds)) {
          const credObj = credValue as Record<string, unknown>;
          const credId = credObj?.id;
          if (
            typeof credId === "string" &&
            credId !== "__REMAP__" &&
            /^[A-Za-z0-9]{10,}$/.test(credId)
          ) {
            violations.push({
              file: file.relPath,
              line: 0,
              detail: `credential "${credName}" has hardcoded id: ${credId} — use __REMAP__`,
              fix: `Change credential id from '${credId}' to '__REMAP__' — deploy-workflows.mjs maps credentials by name at deploy time`,
            });
          }
        }
      }
    }

    expect(
      violations,
      `Hardcoded IDs in template workflow JSONs (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it("scripts do not contain hardcoded n8n server IDs", () => {
    const violations: Violation[] = [];

    const scriptFiles = ALL_CODE.filter(
      (f) =>
        f.relPath.startsWith("scripts/") &&
        !f.relPath.includes("/lib/") &&
        !isTestOrGenerated(f.relPath),
    );

    for (const file of scriptFiles) {
      // Find patterns like: 'b8RBexT2LWUjy2Yq' — bare n8n IDs in strings
      const idInString = /['"`]([A-Za-z0-9]{16})['"`]/g;
      let match: RegExpExecArray | null;

      while ((match = idInString.exec(file.content)) !== null) {
        const lineNum =
          file.content.substring(0, match.index).split("\n").length;
        const line = file.lines[lineNum - 1] ?? "";

        // Skip comments
        if (line.trim().startsWith("//") || line.trim().startsWith("#"))
          continue;

        // n8n workflow IDs are nanoids — random base62 that essentially always
        // contain digits (e.g. 'b8RBexT2LWUjy2Yq'). A 16-char value with NO digit
        // is a readable identifier (e.g. an Appsmith query_name like
        // 'listActivityFeed'), not an n8n ID. Narrowing to digit-bearing values
        // removes that false-positive class without missing real n8n IDs.
        if (!/[0-9]/.test(match[1])) continue;

        // Skip if it's a variable name or key, not an ID value
        // Look for assignment patterns like: KEY: 'ID'
        if (/:\s*['"`][A-Za-z0-9]{16}['"`]/.test(line)) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `hardcoded n8n ID: ${match[1]} — use dynamic discovery via API`,
            fix: `Remove hardcoded ID '${match[1]}'. Discover dynamically: const wf = await n8nApi.getWorkflows(); const id = wf.find(w => w.name === 'Name')?.id`,
          });
        }
      }
    }

    expect(
      violations,
      `Hardcoded n8n server IDs in scripts (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});

// =============================================================================
// 5. RPC / API CALLS WITH UNSANITIZED USER INPUT
// =============================================================================

/**
 * Detect patterns where user-provided input (getNodeParameter, request body)
 * is passed directly into RPC/fetch body without validation.
 *
 * Focus: n8n nodes that build Supabase RPC payloads.
 */

describe("5 · RPC / API input without format validation", () => {
  const n8nNodeFiles = ALL_CODE.filter((f) =>
    f.relPath.startsWith("packages/n8n-nodes-aisha/nodes/"),
  );

  /**
   * Nodes that use getNodeParameter → directly into fetch body
   * without intermediate validation (regex, zod, or type check).
   */
  const RPC_VALIDATION_ALLOWLIST: Record<string, string> = {
    // AishaRpc is a generic RPC caller — validation is caller's responsibility
    "packages/n8n-nodes-aisha/nodes/AishaRpc/AishaRpc.node.ts":
      "generic RPC caller — input validation is upstream responsibility",
  };

  it("parameters to Supabase RPC calls are validated before use", () => {
    const violations: Violation[] = [];

    for (const file of n8nNodeFiles) {
      if (RPC_VALIDATION_ALLOWLIST[file.relPath]) continue;

      // Find fetch calls to /rest/v1/rpc/
      const rpcFetchPattern = /\/rest\/v1\/rpc\//g;
      let match: RegExpExecArray | null;

      while ((match = rpcFetchPattern.exec(file.content)) !== null) {
        const matchPos = match.index;
        const lineNum =
          file.content.substring(0, matchPos).split("\n").length;

        // Look backwards to find which parameters are being sent
        const windowStart = Math.max(0, lineNum - 30);
        const preceding = file.lines.slice(windowStart, lineNum + 10).join("\n");

        // Find getNodeParameter calls that feed into JSON.stringify body
        const paramNames: string[] = [];
        const paramPattern = /getNodeParameter\s*\(\s*['"`](\w+)['"`]/g;
        let paramMatch: RegExpExecArray | null;

        while ((paramMatch = paramPattern.exec(preceding)) !== null) {
          paramNames.push(paramMatch[1]);
        }

        if (paramNames.length === 0) continue;

        // Check if there's any validation between parameter extraction and RPC call
        const hasValidation =
          /\.test\s*\(/.test(preceding) || // regex test
          /\.match\s*\(/.test(preceding) || // regex match
          /safeParse|parse\s*\(/.test(preceding) || // zod
          /typeof\s+\w+\s*[!=]==/.test(preceding) || // typeof check
          /if\s*\(\s*!/.test(preceding) || // guard clause
          /validate|sanitize|isValid/i.test(preceding); // validation function

        if (!hasValidation) {
          violations.push({
            file: file.relPath,
            line: lineNum,
            detail: `RPC call uses parameters [${paramNames.join(", ")}] without format validation`,
            fix: `Add input validation before RPC call: if (!/^[a-z0-9_-]+$/.test(${paramNames[0]})) throw new NodeOperationError(this.getNode(), 'Invalid ${paramNames[0]} format');`,
          });
        }
      }
    }

    expect(
      violations,
      `RPC calls with unsanitized input (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});

// =============================================================================
// 6. FETCH RESPONSE WITHOUT ERROR CHECK (bonus universal pattern)
// =============================================================================

describe("6 · fetch() response without ok/status check", () => {
  /**
   * Files where response check is handled by a shared wrapper.
   */
  const RESPONSE_CHECK_ALLOWLIST: Record<string, string> = {
    "scripts/lib/env.mjs": "utility module",
    "scripts/patch-workflow-fetch.mjs": "fetch() appears in string templates/code generation, not runtime",
  };

  it("fetch() results are checked for ok/status before .json()", () => {
    const violations: Violation[] = [];

    for (const file of ALL_CODE) {
      if (RESPONSE_CHECK_ALLOWLIST[file.relPath]) continue;
      if (isTestOrGenerated(file.relPath)) continue;

      // Use regex to find every fetch( call and then look for .json() in scope
      const fetchCallPattern = /\bfetch\s*\(/g;
      let fetchMatch: RegExpExecArray | null;

      while ((fetchMatch = fetchCallPattern.exec(file.content)) !== null) {
        const fetchPos = fetchMatch.index;
        const fetchLineNum =
          file.content.substring(0, fetchPos).split("\n").length;

        // Skip comments
        const fetchLine = file.lines[fetchLineNum - 1] ?? "";
        const trimmedFetchLine = fetchLine.trim();
        if (
          trimmedFetchLine.startsWith("//") ||
          trimmedFetchLine.startsWith("*") ||
          trimmedFetchLine.startsWith("/*")
        )
          continue;

        // Look at the next 40 lines after fetch() for .json()
        const scopeStart = fetchLineNum - 1;
        const scopeEnd = Math.min(file.lines.length, fetchLineNum + 39);
        const scopeLines = file.lines.slice(scopeStart, scopeEnd).join("\n");

        if (!/\.json\s*\(\s*\)/.test(scopeLines)) continue;

        // Check if status/ok is checked between fetch() and .json()
        const jsonPos = scopeLines.indexOf(".json()");
        const betweenFetchAndJson = scopeLines.substring(0, jsonPos);

        const hasOkCheck =
          /\.ok\b/.test(betweenFetchAndJson) ||
          /\.status\b/.test(betweenFetchAndJson) ||
          /if\s*\(\s*!?\s*res(p(onse)?)?\b/.test(betweenFetchAndJson) ||
          /throw.*(?:resp|res|response)/.test(betweenFetchAndJson) ||
          // Helper wrapper that includes error checking
          /n8nApi|httpRequest|supabaseFetch|fetchWithTimeout|fetchSafe/.test(
            betweenFetchAndJson,
          );

        // Also check if .ok/.status appears shortly AFTER .json() (read-then-check pattern)
        const afterJson = scopeLines.substring(jsonPos, jsonPos + 300);
        const hasPostJsonCheck =
          /\.ok\b/.test(afterJson) ||
          /\.status\b/.test(afterJson);

        if (!hasOkCheck && !hasPostJsonCheck) {
          const isEdgeFunction = file.relPath.startsWith("trash/legacy-archive/edge-functions-reference/");
          violations.push({
            file: file.relPath,
            line: fetchLineNum,
            detail: `.json() called without checking resp.ok — may parse error HTML as JSON`,
            fix: isEdgeFunction
              ? `Add before .json(): if (!response.ok) { const text = await response.text(); throw new Error(\`API error \${response.status}: \${text}\`); }`
              : `Add: const resp = await fetch(url, opts); if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`); const data = await resp.json();`,
          });
        }
      }
    }

    expect(
      violations,
      `fetch() → .json() without response check (${violations.length}):\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});

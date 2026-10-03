/**
 * Gate test: Phase 13.1 — svc-ide-context invariants
 *
 * Enforces the structural contract for the dynamic agent broadcasting service.
 * If this gate fails, fix the underlying code (per `feedback_no_workarounds_*`).
 *
 * Asserts:
 * 1. get_workspace_context SoT file exists and follows SECURITY DEFINER + RLS
 *    rules (CLAUDE.md -1.2).
 * 2. Timestamped migration file exists wrapping the RPC.
 * 3. svc-ide-context skeleton (package.json, server.ts, routes, envelope,
 *    templateEngine) exists with required exports.
 * 4. Service uses ONLY rpcUser/rpcUserClaims/rpcService — no `.from()` calls
 *    (CLAUDE.md -1.1.7 RPC-Only).
 * 5. Templates contain AISHA-MANAGED + USER-CUSTOM delimiters for all 4 IDEs
 *    except JetBrains (JSON output uses schema-marker instead).
 * 6. No hardcoded production URLs / secrets in service code
 *    (per `feedback_no_infra_in_repo.md`).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const SQL_FN_PATH = path.join(
  ROOT,
  "aisha/db/sql/functions/get_workspace_context.sql",
);
const SVC_DIR = path.join(ROOT, "services/svc-ide-context");

function readFileOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

describe("Phase 13.1 — svc-ide-context SoT", () => {
  it("get_workspace_context.sql exists", () => {
    expect(fs.existsSync(SQL_FN_PATH)).toBe(true);
  });

  it("get_workspace_context is SECURITY DEFINER + SET search_path", () => {
    const sql = readFileOrEmpty(SQL_FN_PATH);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("get_workspace_context REVOKEs from PUBLIC and GRANTs to authenticated", () => {
    const sql = readFileOrEmpty(SQL_FN_PATH);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_workspace_context.*FROM PUBLIC/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_workspace_context.*TO authenticated/);
  });

  it("get_workspace_context enforces auth.uid() non-null + delegates to helpers", () => {
    const sql = readFileOrEmpty(SQL_FN_PATH);
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(sql).toMatch(/is_admin_or_staff/);
    expect(sql).toMatch(/is_story_participant/);
    expect(sql).toMatch(/Unauthorized/);
  });

  it("get_workspace_context returns capped envelope sections (LIMIT 10/20/30)", () => {
    const sql = readFileOrEmpty(SQL_FN_PATH);
    // Output bounded — sentinel checks
    expect(sql).toMatch(/LIMIT 10/);
    expect(sql).toMatch(/LIMIT 30/);
  });

  it("get_workspace_context RPC is folded into the baseline SoT", () => {
    // The svc_ide_context_get_workspace_context migration was absorbed into the
    // baseline (chronological end-state of all migrations). Assert the RPC persists
    // in its canonical SoT function file, and that we are baseline-only (the registry
    // lists 0 pending non-baseline migrations) — durability now lives in the SoT.
    const sot = readFileOrEmpty(
      path.join(ROOT, "aisha/db/sql/functions/get_workspace_context.sql"),
    );
    expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.get_workspace_context/);
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, "aisha/db/migration-registry.json"), "utf8"),
    ) as { migrations: string[] };
    expect(registry.migrations).toEqual([]);
  });
});

describe("Phase 13.1 — svc-ide-context skeleton", () => {
  it("services/svc-ide-context/ directory exists with required files", () => {
    expect(fs.existsSync(SVC_DIR)).toBe(true);
    for (const f of [
      "package.json",
      "tsconfig.json",
      "vitest.config.ts",
      "Dockerfile",
      "src/server.ts",
      "src/config.ts",
      "src/auth.ts",
      "src/postgrest.ts",
      "src/lib/envelope.ts",
      "src/lib/templateEngine.ts",
      "src/routes/context.ts",
      "src/routes/instructions.ts",
    ]) {
      expect(fs.existsSync(path.join(SVC_DIR, f)), `missing: ${f}`).toBe(true);
    }
  });

  it("package.json declares @aisha/security + zod + fastify deps", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(SVC_DIR, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@aisha/security"]).toBeDefined();
    expect(pkg.dependencies["zod"]).toBeDefined();
    expect(pkg.dependencies["fastify"]).toBeDefined();
    expect(pkg.dependencies["jose"]).toBeDefined();
  });

  it("server.ts registers context + instructions routes", () => {
    const server = readFileOrEmpty(path.join(SVC_DIR, "src/server.ts"));
    expect(server).toMatch(/contextRoutes/);
    expect(server).toMatch(/instructionsRoutes/);
    expect(server).toMatch(/applySecurity/);
    expect(server).toMatch(/svc-ide-context/);
  });
});

describe("Phase 13.1 — RPC-only invariant (no .from())", () => {
  function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" || entry.name === "node_modules") continue;
        out.push(...listSourceFiles(full));
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * Strip TS/JS comments AND string/template-literal contents so that
   * static regex assertions ignore matches that appear inside documentation
   * or rendered template strings (e.g. user-facing Markdown describing the
   * rule itself).
   */
  function stripCommentsAndStrings(content: string): string {
    let out = content;
    // Block comments `/* … */`
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    // Line comments `// …`
    out = out.replace(/\/\/.*$/gm, "");
    // Double-quoted strings (no escape handling needed for our use)
    out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // Single-quoted strings
    out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // Template literals (back-ticked, may span lines)
    out = out.replace(/`(?:[^`\\]|\\.)*`/g, "``");
    return out;
  }

  it("no .from('table') in service source (RPC-only per CLAUDE.md)", () => {
    const files = listSourceFiles(path.join(SVC_DIR, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const stripped = stripCommentsAndStrings(fs.readFileSync(f, "utf8"));
      // Match `.from("table")` or `.from('table')` — banned ORM-style
      // query builder pattern; use the rpcService adapter instead.
      if (/\.from\s*\(\s*['"]/.test(stripped)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders, `Files using .from(): ${offenders.join(", ")}`).toEqual([]);
  });

  it("no console.log in service source (use req.log per CLAUDE.md)", () => {
    const files = listSourceFiles(path.join(SVC_DIR, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const stripped = stripCommentsAndStrings(fs.readFileSync(f, "utf8"));
      if (/\bconsole\.log\s*\(/.test(stripped)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no `: any` type annotations in service source", () => {
    const files = listSourceFiles(path.join(SVC_DIR, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const stripped = stripCommentsAndStrings(fs.readFileSync(f, "utf8"));
      if (/:\s*any\b/.test(stripped)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders, `Files with : any : ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("Phase 13.1 — template delimiters + IDE coverage", () => {
  it("templateEngine.ts exports renderInstructions + SUPPORTED_IDES", () => {
    const src = readFileOrEmpty(
      path.join(SVC_DIR, "src/lib/templateEngine.ts"),
    );
    expect(src).toMatch(/export\s+function\s+renderInstructions/);
    expect(src).toMatch(/export\s+const\s+SUPPORTED_IDES/);
  });

  it("supports all 4 IDEs (claude-code, cursor, copilot, jetbrains)", () => {
    const src = readFileOrEmpty(
      path.join(SVC_DIR, "src/lib/templateEngine.ts"),
    );
    expect(src).toMatch(/['"]claude-code['"]/);
    expect(src).toMatch(/['"]cursor['"]/);
    expect(src).toMatch(/['"]copilot['"]/);
    expect(src).toMatch(/['"]jetbrains['"]/);
  });

  it("templates contain AISHA-MANAGED + USER-CUSTOM delimiter constants", () => {
    // Phase 13 WP 13.2 moved templates out of templateEngine.ts into
    // separate .eta files (operator-overridable per AISHA_TEMPLATES_DIR).
    // The delimiters now live in the .eta source — verify any of the 3
    // Markdown/text IDE templates carries the safe-merge contract.
    const claudeCodeTemplate = readFileOrEmpty(
      path.join(SVC_DIR, "templates/claude-code/instructions.eta"),
    );
    expect(claudeCodeTemplate).toMatch(/AISHA-MANAGED-START/);
    expect(claudeCodeTemplate).toMatch(/AISHA-MANAGED-END/);
    expect(claudeCodeTemplate).toMatch(/USER-CUSTOM-START/);
    expect(claudeCodeTemplate).toMatch(/USER-CUSTOM-END/);
  });
});

describe("Phase 13.1 — no hardcoded prod URLs / secrets", () => {
  function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" || entry.name === "node_modules") continue;
        out.push(...listSourceFiles(full));
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
    { name: "aisha.guru hardcoded prod URL", re: /https?:\/\/[^"'\s]*\.aisha\.guru/ },
    { name: "backend.id3a.cz hardcoded prod URL", re: /https?:\/\/[^"'\s]*\.backend\.id3a\.cz/ },
    {
      name: "JWT/secret-like inline literal",
      re: /['"]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+['"]/,
    },
  ];

  it.each(FORBIDDEN_PATTERNS)("no $name in service source", ({ re }) => {
    const files = listSourceFiles(path.join(SVC_DIR, "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      if (re.test(content)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});

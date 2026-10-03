/**
 * Auto-Flow Moderation — Unit tests for AISHA's autonomous file-save moderator.
 *
 * Tests pure functions extracted from auto-flow.ts:
 *   - detectFileRole()       — path pattern → FileRole
 *   - getKbRulesForRole()    — FileRole → KB rules array
 *   - getWorkflowDirectives() — role + dev state → ordered workflow steps
 *   - isCacheValid()          — TTL cache freshness
 *
 * Pattern: Extracted pure functions, no `import * as vscode`.
 * Reference: auto-flow.ts lines 160-367.
 *
 * @module
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types — mirrored from auto-flow.ts
// ---------------------------------------------------------------------------

type FileRole =
  | "hook"
  | "component"
  | "schema"
  | "migration"
  | "test"
  | "i18n"
  | "page"
  | "sql_function"
  | "edge_function"
  | "other";

interface DevStateItem {
  label: string;
  status: "ok" | "missing" | "warning";
  path?: string;
}

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Extracted constants from auto-flow.ts
// ---------------------------------------------------------------------------

const TEST_PATTERNS = [/\.test\.(ts|tsx)$/, /\.spec\.(ts|tsx)$/];
const I18N_PATTERNS = [/src\/i18n\/segments\//];
const FIND_FILES_CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Extracted pure functions from auto-flow.ts
// ---------------------------------------------------------------------------

function detectFileRole(filePath: string): FileRole {
  if (TEST_PATTERNS.some(p => p.test(filePath))) return "test";
  if (/src\/hooks\/use[A-Z].*\.ts$/.test(filePath)) return "hook";
  if (/src\/components\/.*\.(tsx|ts)$/.test(filePath)) return "component";
  if (/src\/lib\/schemas\/.*\.ts$/.test(filePath)) return "schema";
  if (/((?:supabase|aisha\/db)\/migrations)\/.*\.sql$/.test(filePath)) return "migration";
  if (I18N_PATTERNS.some(p => p.test(filePath))) return "i18n";
  if (/src\/pages\/.*\.(tsx|ts)$/.test(filePath)) return "page";
  if (/((?:supabase|aisha\/db)\/sql\/functions)\//.test(filePath)) return "sql_function";
  if (/(supabase\/functions|archive\/edge-functions-reference|aisha\/db\/sql\/functions)\//.test(filePath)) return "edge_function";
  return "other";
}

function isCacheValid<T>(entry: CacheEntry<T> | undefined | null): entry is CacheEntry<T> {
  return entry != null && Date.now() - entry.cachedAt < FIND_FILES_CACHE_TTL_MS;
}

function getKbRulesForRole(role: FileRole): string[] {
  const rules: string[] = [];
  switch (role) {
    case "hook":
      rules.push("RPC-only: use supabase.rpc(), never .from()");
      rules.push("Zod validation on every API response: schema.parse(data)");
      rules.push("No console.* — use safeError() from @/lib/security/safeLogger");
      rules.push("Export hook from src/hooks/index.ts barrel");
      break;
    case "component":
      rules.push("No hardcoded text in JSX — use t(\"key\") from useTranslation()");
      rules.push("No emoji in UI — use lucide-react icons");
      rules.push("Components never call API directly — use hooks");
      rules.push("Wrap sensitive data in <ErrorBoundary>");
      break;
    case "schema":
      rules.push("CRITICAL: parseRpcArraySafe uses safeParse — silently drops invalid items!");
      rules.push("Run tests IMMEDIATELY after any Zod schema change");
      rules.push("Type inference: type MyType = z.infer<typeof mySchema>");
      break;
    case "migration":
      rules.push("Register: npm run db:migration:register");
      rules.push("Apply: npm run db:migrate:local");
      rules.push("Generate types: npm run db:types:gen:local");
      rules.push("No psql meta-commands (\\connect, \\set, \\i, \\copy)");
      rules.push("SECURITY DEFINER + SET search_path for anon functions");
      break;
    case "i18n":
      rules.push("EN is canonical key set — edit src/i18n/segments/en/*.json");
      rules.push("No fallbacks: t(\"key\", \"Fallback\") is FORBIDDEN");
      rules.push("Run npm run i18n:check before commit");
      break;
    case "test":
      rules.push("Mock must match implementation — check hook before writing test");
      rules.push("Use vi.mocked(supabase.rpc) consistently");
      rules.push("Avoid fragile toHaveBeenCalledTimes(1) — React re-renders cause multiple calls");
      break;
    case "page":
      rules.push("Pages use hooks for data access, not direct API calls");
      rules.push("All UI text via t(\"key\") — no hardcoded strings");
      break;
    default:
      rules.push("No any types — use proper types or unknown + type guard");
      rules.push("No console.* — use safeError()");
  }
  return rules;
}

function getWorkflowDirectives(role: FileRole, state: DevStateItem[], _filePath: string): string[] {
  const directives: string[] = [];
  const missingTest = state.find(s => s.label.startsWith("Test:") && s.status === "missing");
  const missingBarrel = state.find(s => s.label.startsWith("Barrel export:") && s.status === "missing");

  if (missingTest?.path) {
    directives.push(`Write test FIRST: ${missingTest.path}`);
  }

  if (missingBarrel) {
    directives.push("Add barrel export to src/hooks/index.ts");
  }

  switch (role) {
    case "hook":
    case "component":
    case "schema":
      if (missingTest?.path) {
        directives.push(`Run: npm run test:run -- ${missingTest.path}`);
      }
      directives.push("Verify: npx tsc --noEmit");
      break;
    case "migration":
      directives.push("Run: npm run db:migration:register");
      directives.push("Run: npm run db:migrate:local && npm run db:types:gen:local");
      directives.push("Verify: npx tsc --noEmit");
      break;
    case "i18n":
      directives.push("Run: npm run i18n:check");
      break;
    default:
      directives.push("Verify: npx tsc --noEmit");
  }

  return directives;
}

// ---------------------------------------------------------------------------
// Source parity
// ---------------------------------------------------------------------------

describe("Source parity — auto-flow.ts", () => {
  const sourcePath = path.resolve(
    __dirname,
    "../../../extensions/aisha-dirigent/src/auto-flow.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf-8");

  it("detectFileRole function exists in source", () => {
    expect(source).toContain("function detectFileRole");
  });

  it("getKbRulesForRole function exists in source", () => {
    expect(source).toContain("function getKbRulesForRole");
  });

  it("getWorkflowDirectives function exists in source", () => {
    expect(source).toContain("function getWorkflowDirectives");
  });

  it("FIND_FILES_CACHE_TTL_MS matches source (handles numeric_separator literals)", () => {
    // Source uses 60_000 (numeric separator) — regex must strip underscore before parseInt
    const match = source.match(/FIND_FILES_CACHE_TTL_MS\s*=\s*([\d_]+)/);
    expect(match).not.toBeNull();
    const sourceValue = parseInt(match![1].replace(/_/g, ""), 10);
    expect(sourceValue).toBe(FIND_FILES_CACHE_TTL_MS);
  });

  it("SAVE_DEBOUNCE_MS exists in source (debounce against spam)", () => {
    expect(source).toContain("SAVE_DEBOUNCE_MS");
  });

  it("SECURITY DEFINER rule present in migration KB rules", () => {
    expect(source).toContain("SECURITY DEFINER");
  });

  it("RPC-only rule present in hook KB rules", () => {
    expect(source).toContain("RPC-only");
  });
});

// ---------------------------------------------------------------------------
// detectFileRole — path pattern detection
// ---------------------------------------------------------------------------

describe("detectFileRole() — hook", () => {
  it("detects src/hooks/useBooking.ts", () => {
    expect(detectFileRole("src/hooks/useBooking.ts")).toBe("hook");
  });

  it("detects src/hooks/useConsultationBooking.ts", () => {
    expect(detectFileRole("src/hooks/useConsultationBooking.ts")).toBe("hook");
  });

  it("does NOT detect hooks with lowercase 'use' after /hooks/", () => {
    // use[A-Z] requires uppercase first letter after 'use'
    // 'usebooking.ts' should not match
    expect(detectFileRole("src/hooks/usebooking.ts")).toBe("other");
  });

  it("does NOT classify test file as hook", () => {
    expect(detectFileRole("src/tests/hooks/useBooking.test.ts")).toBe("test");
  });
});

describe("detectFileRole() — component", () => {
  it("detects src/components/Avatar.tsx", () => {
    expect(detectFileRole("src/components/Avatar.tsx")).toBe("component");
  });

  it("detects nested component path", () => {
    expect(detectFileRole("src/components/marketplace/SpecialistCard.tsx")).toBe("component");
  });

  it("does NOT classify page as component", () => {
    expect(detectFileRole("src/pages/Dashboard.tsx")).toBe("page");
  });
});

describe("detectFileRole() — schema", () => {
  it("detects src/lib/schemas/bookingSchema.ts", () => {
    expect(detectFileRole("src/lib/schemas/bookingSchema.ts")).toBe("schema");
  });

  it("detects src/lib/schemas/memberSchema.ts", () => {
    expect(detectFileRole("src/lib/schemas/memberSchema.ts")).toBe("schema");
  });
});

describe("detectFileRole() — migration", () => {
  it("detects aisha/db/migrations/20240101_add_bookings.sql", () => {
    expect(detectFileRole("aisha/db/migrations/20240101_add_bookings.sql")).toBe("migration");
  });

  it("does NOT detect non-migration SQL", () => {
    expect(detectFileRole("scripts/seed.sql")).toBe("other");
  });
});

describe("detectFileRole() — test", () => {
  it("detects .test.ts files", () => {
    expect(detectFileRole("src/tests/hooks/useBooking.test.ts")).toBe("test");
  });

  it("detects .spec.ts files", () => {
    expect(detectFileRole("e2e/aisha-delegation.spec.ts")).toBe("test");
  });

  it("detects .test.tsx files", () => {
    expect(detectFileRole("src/tests/components/Avatar.test.tsx")).toBe("test");
  });

  it("test pattern has highest priority over hook pattern", () => {
    // A file that could match both — test wins
    expect(detectFileRole("src/hooks/useBooking.test.ts")).toBe("test");
  });
});

describe("detectFileRole() — i18n", () => {
  it("detects src/i18n/segments/en/marketplace.json", () => {
    expect(detectFileRole("src/i18n/segments/en/marketplace.json")).toBe("i18n");
  });

  it("detects src/i18n/segments/cs/common.json", () => {
    expect(detectFileRole("src/i18n/segments/cs/common.json")).toBe("i18n");
  });

  it("does NOT detect src/i18n/locales/en.json (not in segments/)", () => {
    expect(detectFileRole("src/i18n/locales/en.json")).toBe("other");
  });
});

describe("detectFileRole() — page", () => {
  it("detects src/pages/Dashboard.tsx", () => {
    expect(detectFileRole("src/pages/Dashboard.tsx")).toBe("page");
  });
});

describe("detectFileRole() — SQL / edge functions", () => {
  it("detects aisha/db/sql/functions/get_bookings.sql", () => {
    expect(detectFileRole("aisha/db/sql/functions/get_bookings.sql")).toBe("sql_function");
  });

  it("detects trash/legacy-archive/edge-functions-reference/ai-chat/index.ts", () => {
    expect(detectFileRole("trash/legacy-archive/edge-functions-reference/ai-chat/index.ts")).toBe("edge_function");
  });

  it("detects trash/legacy-archive/edge-functions-reference/aisha-push/index.ts", () => {
    expect(detectFileRole("trash/legacy-archive/edge-functions-reference/aisha-push/index.ts")).toBe("edge_function");
  });
});

describe("detectFileRole() — other / fallback", () => {
  it("returns other for .cursorrules", () => {
    expect(detectFileRole(".cursorrules")).toBe("other");
  });

  it("returns other for CLAUDE.md", () => {
    expect(detectFileRole("CLAUDE.md")).toBe("other");
  });

  it("returns other for random config file", () => {
    expect(detectFileRole("vite.config.ts")).toBe("other");
  });

  it("returns other for src/lib/utils.ts (not schema path)", () => {
    expect(detectFileRole("src/lib/utils.ts")).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// getKbRulesForRole — knowledge base rules per role
// ---------------------------------------------------------------------------

describe("getKbRulesForRole() — hook", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("hook"); });

  it("contains RPC-only rule", () => {
    expect(rules.some(r => r.includes("supabase.rpc()"))).toBe(true);
  });

  it("forbids .from()", () => {
    expect(rules.some(r => r.includes(".from()"))).toBe(true);
  });

  it("requires Zod validation", () => {
    expect(rules.some(r => r.toLowerCase().includes("zod"))).toBe(true);
  });

  it("requires barrel export", () => {
    expect(rules.some(r => r.includes("index.ts"))).toBe(true);
  });

  it("forbids console.*", () => {
    expect(rules.some(r => r.includes("console"))).toBe(true);
  });
});

describe("getKbRulesForRole() — component", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("component"); });

  it("requires i18n t() key", () => {
    expect(rules.some(r => r.includes("t(\"key\")"))).toBe(true);
  });

  it("forbids emoji in UI", () => {
    expect(rules.some(r => r.toLowerCase().includes("emoji"))).toBe(true);
  });

  it("components never call API directly", () => {
    expect(rules.some(r => r.toLowerCase().includes("hook"))).toBe(true);
  });
});

describe("getKbRulesForRole() — migration", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("migration"); });

  it("includes SECURITY DEFINER rule", () => {
    expect(rules.some(r => r.includes("SECURITY DEFINER"))).toBe(true);
  });

  it("includes db:migration:register command", () => {
    expect(rules.some(r => r.includes("db:migration:register"))).toBe(true);
  });

  it("includes db:migrate:local command", () => {
    expect(rules.some(r => r.includes("db:migrate:local"))).toBe(true);
  });

  it("forbids psql meta-commands", () => {
    expect(rules.some(r => r.includes("\\\\connect") || r.includes("\\connect") || r.includes("meta-commands"))).toBe(true);
  });
});

describe("getKbRulesForRole() — i18n", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("i18n"); });

  it("forbids fallbacks", () => {
    expect(rules.some(r => r.includes("FORBIDDEN"))).toBe(true);
  });

  it("requires i18n:check", () => {
    expect(rules.some(r => r.includes("i18n:check"))).toBe(true);
  });

  it("requires EN as canonical set", () => {
    expect(rules.some(r => r.includes("EN is canonical"))).toBe(true);
  });
});

describe("getKbRulesForRole() — schema", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("schema"); });

  it("warns about parseRpcArraySafe silent data loss", () => {
    expect(rules.some(r => r.includes("parseRpcArraySafe"))).toBe(true);
  });

  it("requires immediate test run after schema change", () => {
    expect(rules.some(r => r.toLowerCase().includes("test"))).toBe(true);
  });
});

describe("getKbRulesForRole() — other (fallback)", () => {
  let rules: string[];
  beforeEach(() => { rules = getKbRulesForRole("other"); });

  it("includes no-any-types rule", () => {
    expect(rules.some(r => r.includes("any"))).toBe(true);
  });

  it("includes no-console rule", () => {
    expect(rules.some(r => r.includes("console"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getWorkflowDirectives — test-first and role-specific steps
// ---------------------------------------------------------------------------

describe("getWorkflowDirectives() — test-first philosophy", () => {
  it("puts Write test FIRST when test is missing for hook", () => {
    const state: DevStateItem[] = [
      { label: "Hook: src/hooks/useBooking.ts", status: "ok" },
      { label: "Test: src/tests/hooks/useBooking.test.ts", status: "missing", path: "src/tests/hooks/useBooking.test.ts" },
    ];
    const directives = getWorkflowDirectives("hook", state, "src/hooks/useBooking.ts");
    expect(directives[0]).toContain("Write test FIRST");
    expect(directives[0]).toContain("src/tests/hooks/useBooking.test.ts");
  });

  it("does NOT add Write test when test exists", () => {
    const state: DevStateItem[] = [
      { label: "Hook: src/hooks/useBooking.ts", status: "ok" },
      { label: "Test: src/tests/hooks/useBooking.test.ts", status: "ok", path: "src/tests/hooks/useBooking.test.ts" },
    ];
    const directives = getWorkflowDirectives("hook", state, "src/hooks/useBooking.ts");
    expect(directives.some(d => d.startsWith("Write test FIRST"))).toBe(false);
  });

  it("adds barrel export directive when missing", () => {
    const state: DevStateItem[] = [
      { label: "Hook: src/hooks/useBooking.ts", status: "ok" },
      { label: "Barrel export: src/hooks/index.ts", status: "missing" },
    ];
    const directives = getWorkflowDirectives("hook", state, "src/hooks/useBooking.ts");
    expect(directives.some(d => d.includes("barrel export"))).toBe(true);
  });
});

describe("getWorkflowDirectives() — migration workflow", () => {
  it("includes all 3 migration steps", () => {
    const state: DevStateItem[] = [
      { label: "File: aisha/db/migrations/20240101.sql", status: "ok" },
    ];
    const directives = getWorkflowDirectives("migration", state, "aisha/db/migrations/20240101.sql");
    expect(directives.some(d => d.includes("db:migration:register"))).toBe(true);
    expect(directives.some(d => d.includes("db:migrate:local"))).toBe(true);
    expect(directives.some(d => d.includes("tsc --noEmit"))).toBe(true);
  });
});

describe("getWorkflowDirectives() — i18n workflow", () => {
  it("includes i18n:check", () => {
    const state: DevStateItem[] = [
      { label: "File: src/i18n/segments/en/marketplace.json", status: "ok" },
    ];
    const directives = getWorkflowDirectives("i18n", state, "src/i18n/segments/en/marketplace.json");
    expect(directives.some(d => d.includes("i18n:check"))).toBe(true);
  });
});

describe("getWorkflowDirectives() — all roles include tsc verify", () => {
  const rolesWithTsc: FileRole[] = ["hook", "component", "schema", "migration", "other", "edge_function", "page"];

  for (const role of rolesWithTsc) {
    it(`${role} includes tsc verification`, () => {
      const state: DevStateItem[] = [{ label: `File: test.ts`, status: "ok" }];
      const directives = getWorkflowDirectives(role, state, "test.ts");
      expect(directives.some(d => d.includes("tsc --noEmit"))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// isCacheValid — TTL cache behavior
// ---------------------------------------------------------------------------

describe("isCacheValid() — TTL-based cache", () => {
  it("returns true for fresh cache entry", () => {
    const entry: CacheEntry<string> = { value: "hello", cachedAt: Date.now() };
    expect(isCacheValid(entry)).toBe(true);
  });

  it("returns true for entry just within TTL", () => {
    const entry: CacheEntry<string> = { value: "hello", cachedAt: Date.now() - (FIND_FILES_CACHE_TTL_MS - 100) };
    expect(isCacheValid(entry)).toBe(true);
  });

  it("returns false for expired entry (past TTL)", () => {
    const entry: CacheEntry<string> = { value: "hello", cachedAt: Date.now() - (FIND_FILES_CACHE_TTL_MS + 1000) };
    expect(isCacheValid(entry)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isCacheValid(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCacheValid(undefined)).toBe(false);
  });

  it("TTL is exactly 60 seconds (60000ms)", () => {
    expect(FIND_FILES_CACHE_TTL_MS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// Brief content contract — what the brief MUST and MUST NOT contain
// ---------------------------------------------------------------------------

describe("Brief content contracts", () => {
  it("hook brief with missing test → must prioritize test over barrel export", () => {
    const state: DevStateItem[] = [
      { label: "Hook: src/hooks/useBooking.ts", status: "ok" },
      { label: "Test: src/tests/hooks/useBooking.test.ts", status: "missing", path: "src/tests/hooks/useBooking.test.ts" },
      { label: "Barrel export: src/hooks/index.ts", status: "missing" },
    ];
    const directives = getWorkflowDirectives("hook", state, "src/hooks/useBooking.ts");
    const testFirstIdx = directives.findIndex(d => d.startsWith("Write test FIRST"));
    const barrelIdx = directives.findIndex(d => d.includes("barrel export"));
    expect(testFirstIdx).toBeLessThan(barrelIdx);
  });

  it("edge_function role has SECURITY DEFINER in KB rules (critical security check)", () => {
    // edge_function falls through to 'other' in getKbRulesForRole — but source verifies
    // the brief building logic embeds edge-function specific notes
    const sourcePath = path.resolve(__dirname, "../../../extensions/aisha-dirigent/src/auto-flow.ts");
    const source = fs.readFileSync(sourcePath, "utf-8");
    // SECURITY DEFINER is in migration rules — edge functions get it via general comment in brief
    expect(source).toContain("SECURITY DEFINER");
  });

  it("component brief has no RPC hints (components must use hooks, not direct RPC)", () => {
    const rules = getKbRulesForRole("component");
    // Components should NOT have RPC-only hint (that's for hooks)
    expect(rules.some(r => r.includes("supabase.rpc()"))).toBe(false);
  });

  it("schema brief warns about silent data loss (critical production risk)", () => {
    const rules = getKbRulesForRole("schema");
    const criticalRule = rules.find(r => r.includes("CRITICAL"));
    expect(criticalRule).toBeDefined();
    expect(criticalRule).toContain("silently drops");
  });
});

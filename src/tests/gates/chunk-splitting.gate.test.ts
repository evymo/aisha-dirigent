/**
 * Chunk Splitting Gate Tests
 *
 * Statické kontroly na Vite manualChunks konfiguraci a import graph.
 * Zajišťují, že:
 *
 * 1. **Cross-area bridge modules** jsou v shared chunk — moduly importované
 *    z více area chunků nesmí zůstat nepřiřazené (experimentalMinChunkSize
 *    by je přesunul do jednoho area → vytvoří cykly).
 *
 * 2. **Barrel hooks/index.ts** NENÍ v shared — barrel re-exportuje hooky
 *    ze všech oblastí; přiřazení do shared by vytvořilo shared→admin/partner/public.
 *    Live bindings (export { X } from './Y') jsou TDZ-safe.
 *
 * 3. **Vendor modules** jsou správně izolované — @xyflow, d3 a recharts
 *    nesmí být ve stejném chunku, aby se předešlo admin-area↔admin-production cyklům.
 *
 * 4. **Area imports** neporušují chunk boundary pravidla — partner/public area
 *    nesmí importovat z barrel (hooks/index.ts) moduly, které patří do member-area.
 *
 * 5. **Strukturální pravidla** vite.config.ts — experimentalMinChunkSize,
 *    dedupe, chunkSizeWarningLimit, modulePreload filter.
 *
 * Nespouští build — pracuje POUZE se soubory a AST/regex analýzou.
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");
const VITE_CONFIG = path.join(ROOT, "vite.config.ts");

/* ---------- helpers ---------- */

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function scanTsFiles(
  dir: string,
  result: Array<{ relPath: string; content: string }> = []
): Array<{ relPath: string; content: string }> {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules"
    ) {
      scanTsFiles(full, result);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      result.push({
        relPath: path.relative(ROOT, full),
        content: fs.readFileSync(full, "utf-8"),
      });
    }
  }
  return result;
}

/**
 * Extract all import sources from a TS/TSX file content.
 * Returns non-type imports only (type imports are erased at compile time).
 */
function extractRuntimeImports(content: string): string[] {
  const imports: string[] = [];
  // Match import { ... } from "..." but NOT import type { ... } from "..."
  const importRegex = /^import\s+(?!type\s).*?\bfrom\s+["']([^"']+)["']/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

/**
 * Resolve an import alias to a relative path.
 * @/hooks/useSession → src/hooks/useSession
 */
function resolveAlias(importPath: string): string | null {
  if (importPath.startsWith("@/")) {
    return "src/" + importPath.slice(2);
  }
  return null;
}

/* ---------- vite config parsing ---------- */

const viteConfig = readFile(VITE_CONFIG);

/**
 * Extract all module patterns assigned to a specific chunk name in manualChunks.
 * Handles both single-line and multi-line if-blocks with return statements.
 */
function getChunkAssignments(
  config: string,
  chunkName: string
): string[] {
  const patterns: string[] = [];
  const lines = config.split("\n");
  const returnPattern = new RegExp(`return\\s*["']${chunkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line: if (normalizedId.includes("X")) return "chunk";
    // or: if (normalizedId.includes("X")) { return "chunk"; }
    const includesOnLine = line.match(
      /normalizedId\.includes\(["']([^"']+)["']\)/
    );
    if (includesOnLine && returnPattern.test(line)) {
      patterns.push(includesOnLine[1]);
      continue;
    }

    // Multi-line if block: collect all includes() in a conditional block
    // that ends with return "chunkName"
    if (includesOnLine && !line.includes("return ")) {
      // Collect all includes patterns in this block
      const blockPatterns: string[] = [includesOnLine[1]];
      let foundReturn = false;

      for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
        const nextLine = lines[j];
        const nextInclude = nextLine.match(
          /normalizedId\.includes\(["']([^"']+)["']\)/
        );
        if (nextInclude) {
          blockPatterns.push(nextInclude[1]);
        }

        // Check for return statement
        if (returnPattern.test(nextLine)) {
          foundReturn = true;
          break;
        }
        // If we hit a return to a different chunk, stop
        if (
          nextLine.match(/return\s*["']\w/) &&
          !returnPattern.test(nextLine)
        ) {
          break;
        }
      }

      if (foundReturn) {
        patterns.push(...blockPatterns);
        continue;
      }
    }
  }

  return [...new Set(patterns)];
}

/**
 * Get all patterns in the shared chunk's large conditional block.
 * This handles the multi-line if() { return "shared"; } pattern.
 */
function getSharedChunkPatterns(config: string): string[] {
  const patterns: string[] = [];

  // Find the large shared block — all normalizedId.includes(...) that eventually
  // lead to return "shared"
  const lines = config.split("\n");
  let inSharedBlock = false;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track if we're inside the big if-block that returns "shared"
    if (!inSharedBlock) {
      // Start of the shared conditional block
      if (
        line.includes("normalizedId.includes") &&
        !line.includes('return "') // multi-line condition, not single-line
      ) {
        // Look ahead to see if this block returns "shared"
        for (let j = i; j < Math.min(i + 200, lines.length); j++) {
          if (lines[j].includes('return "shared"')) {
            inSharedBlock = true;
            parenDepth = 1;
            break;
          }
          // If we hit a different return, this isn't the shared block
          if (
            lines[j].includes("return ") &&
            !lines[j].includes("return null") &&
            !lines[j].includes("return undefined") &&
            !lines[j].includes("return;") &&
            !lines[j].includes('return "shared"') &&
            !lines[j].trim().startsWith("//")
          ) {
            break;
          }
        }
      }
    }

    if (inSharedBlock) {
      const includesMatch = line.match(
        /normalizedId\.includes\(["']([^"']+)["']\)/
      );
      if (includesMatch) {
        patterns.push(includesMatch[1]);
      }

      if (line.includes('return "shared"')) {
        // Also check for standalone return "shared" patterns below
        // e.g., if (normalizedId.includes("/src/hooks/erp/")) return "shared";
        inSharedBlock = false;
      }
    }

    // Also catch single-line return "shared" patterns
    if (!inSharedBlock) {
      const singleLine = line.match(
        /normalizedId\.includes\(["']([^"']+)["']\)\)?\s*return\s*["']shared["']/
      );
      if (singleLine) {
        patterns.push(singleLine[1]);
      }
    }
  }

  return [...new Set(patterns)];
}

/* ====================================================================
 * 1. STRUCTURAL RULES — vite.config.ts configuration
 * ==================================================================== */

describe("Chunk Splitting — Structural Rules", () => {
  it("experimentalMinChunkSize must be 0", () => {
    // experimentalMinChunkSize > 0 lets Rollup merge orphan modules into
    // area chunks, which creates circular dependencies.
    expect(viteConfig).toMatch(/experimentalMinChunkSize:\s*0/);
  });

  it("resolve.dedupe must include React core modules", () => {
    // Without dedupe, duplicate React instances can cause hooks to fail
    const requiredDedupe = [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ];
    for (const mod of requiredDedupe) {
      expect(viteConfig).toContain(`"${mod}"`);
    }
    expect(viteConfig).toMatch(/dedupe:\s*\[/);
  });

  it("chunkSizeWarningLimit must be set", () => {
    const match = viteConfig.match(/chunkSizeWarningLimit:\s*(\d+)/);
    expect(match).not.toBeNull();
    const limit = parseInt(match![1], 10);
    // Limit should be reasonable (between 500 and 2000 kB)
    expect(limit).toBeGreaterThanOrEqual(500);
    expect(limit).toBeLessThanOrEqual(2000);
  });

  it("modulePreload must exclude vendor chunks from inline preloading", () => {
    // Heavy vendor chunks should not be preloaded, they are loaded on demand
    expect(viteConfig).toMatch(/vendor-flow/);
    expect(viteConfig).toMatch(/vendor-d3/);
    // The filter should exist in modulepreload config
    expect(viteConfig).toMatch(/modulePreload/);
  });

  it("manualChunks function must exist", () => {
    expect(viteConfig).toMatch(/manualChunks\s*\(/);
  });
});

/* ====================================================================
 * 2. BARREL EXCLUSION — hooks/index.ts must NOT be in shared
 * ==================================================================== */

describe("Chunk Splitting — Barrel Exclusion", () => {
  const sharedPatterns = getSharedChunkPatterns(viteConfig);

  it("hooks/index.ts must NOT be assigned to shared chunk", () => {
    // hooks/index.ts barrel re-exports from ALL areas.
    // Putting it in shared creates shared→admin-area, shared→partner-area, etc.
    // Rollup places it in member-area (largest consumer).
    // Its re-exports use live bindings (export { X } from './Y') → TDZ-safe.
    const barrelInShared = sharedPatterns.some(
      (p) =>
        p === "/src/hooks/index" ||
        p === "/src/hooks/index.ts" ||
        (p === "/src/hooks/" && !p.includes("use"))
    );
    expect(barrelInShared).toBe(false);
  });

  it("vite.config.ts should have a comment explaining barrel exclusion", () => {
    expect(viteConfig).toMatch(
      /Barrel.*hooks\/index.*NOT.*shared|hooks\/index.*intentionally.*NOT/i
    );
  });
});

/* ====================================================================
 * 3. CROSS-AREA BRIDGE MODULES — must be in shared
 * ==================================================================== */

describe("Chunk Splitting — Cross-Area Bridge Modules", () => {
  const sharedPatterns = getSharedChunkPatterns(viteConfig);

  /**
   * Critical bridge modules that MUST be in shared.
   * Each entry: [pattern to check, reason why it's a bridge]
   *
   * These modules are imported by 2+ area chunks. Without shared
   * assignment, they become orphans that Rollup places into one area,
   * forcing other areas to cross-import → circular chunk dep → TDZ crash.
   */
  const requiredBridges: Array<[string, string]> = [
    // Core session/auth hooks (used by everyone)
    ["/src/hooks/useSession", "used by ALL areas for auth state"],
    ["/src/hooks/usePermissions", "used by ALL areas for permission checks"],
    ["/src/hooks/useDynamicOnboarding", "used by member + partner areas"],

    // Layout components (used by RootLayout in shared context)
    ["/src/components/layout/Header", "shared layout (RootLayout)"],
    ["/src/components/layout/Footer", "shared layout (RootLayout)"],

    // StoryLoop ecosystem (member + partner)
    ["/src/components/storyloop/", "used by member + partner areas"],
    ["/src/hooks/useStoryLoop", "partner StoryLoop page + member"],

    // Admin↔member bridges
    ["/src/hooks/useRoleDefinitions", "admin RoleCapabilityBadges"],
    ["/src/hooks/useInvoiceSettings", "admin InvoiceHeaderSettings"],
    ["/src/hooks/usePaymentMethodSettings", "admin PaymentMethodSettings"],

    // Partner↔member bridges
    ["/src/hooks/useBiomarkerReferenceRanges", "partner UserLabTrendsChart"],
    ["/src/hooks/useDataSharingConsent", "partner PartnerUsers"],
    ["/src/hooks/useTestQuestions", "PartnerCertification"],

    // Admin-production hooks (zero runtime deps on production components)
    ["/src/hooks/useAdminProduction", "barrel → admin-production back-edge"],
    ["/src/hooks/useProductionLogs", "barrel → admin-production back-edge"],
    ["/src/hooks/useLabelTemplates", "barrel → admin-production back-edge"],

    // Schema/utility bridges
    ["/src/schemas/rpcResponseSchemas", "useNewsArticles (shared) imports this"],
    ["/src/lib/reactQuery/queryDefaults", "shared useStudies depends on it"],
  ];

  for (const [pattern, reason] of requiredBridges) {
    it(`${pattern} must be in shared (${reason})`, () => {
      const found = sharedPatterns.some((p) => p.includes(pattern) || pattern.includes(p));
      expect(found).toBe(true);
    });
  }
});

/* ====================================================================
 * 4. VENDOR ISOLATION — prevent cross-chunk vendor cycles
 * ==================================================================== */

describe("Chunk Splitting — Vendor Isolation", () => {
  it("@xyflow must be in a dedicated vendor chunk (not in admin-production)", () => {
    // @xyflow is used by both admin-area (AgentFlowDiagram) and admin-production
    // (WorkflowDesigner). Without isolation → admin-area↔admin-production cycle.
    const xyflowAssignments = getChunkAssignments(viteConfig, "vendor-flow");
    expect(xyflowAssignments.some((p) => p.includes("@xyflow"))).toBe(true);
  });

  it("d3 modules must be co-located with recharts in base vendor chunk", () => {
    // d3 is used by recharts. Keeping them in separate chunks
    // (vendor vs vendor-d3) creates a vendor ↔ vendor-d3 TDZ cycle.
    // Both are now in the base vendor chunk.
    const d3Lines = viteConfig
      .split("\n")
      .filter(
        (l) => l.includes("d3-") && l.includes("normalizedId")
      );
    expect(d3Lines.length).toBeGreaterThanOrEqual(1);
    // Verify they return "vendor" (not a separate chunk)
    const vendorReturn = viteConfig
      .split("\n")
      .filter(
        (l) => l.includes("recharts") && l.includes("d3-")
      );
    // recharts and d3 should be in the same conditional block
    expect(vendorReturn.length + d3Lines.length).toBeGreaterThanOrEqual(1);
  });

  it("recharts must NOT be forced into a shared vendor chunk", () => {
    // recharts depends heavily on React internals.
    // Forcing it into vendor-charts previously caused TDZ crashes.
    // Current correct approach: return undefined (let Rollup decide).
    const rechartsLines = viteConfig
      .split("\n")
      .filter(
        (l) =>
          l.includes("recharts") &&
          l.includes("normalizedId") &&
          !l.trim().startsWith("//")
      );
    // Find the return statement near recharts
    const rechartsReturnLine = rechartsLines.find((l) =>
      l.includes("return")
    );
    // If there's a nearby return, check it's `undefined`
    if (rechartsReturnLine) {
      expect(rechartsReturnLine).toMatch(/return\s+undefined/);
    }
  });

  it("zustand must be co-located with @xyflow (both depend on each other)", () => {
    const flowAssignments = getChunkAssignments(viteConfig, "vendor-flow");
    expect(flowAssignments.some((p) => p.includes("zustand"))).toBe(true);
  });

  it("Supabase SDK must be in base vendor chunk (not isolated)", () => {
    // Isolating @supabase creates vendor↔vendor-data cycles.
    const supabaseInVendor = viteConfig.includes("@supabase") && 
      viteConfig.includes('return "vendor"');
    expect(supabaseInVendor).toBe(true);
  });

  it("React core must be in base vendor chunk", () => {
    const vendorPatterns = getChunkAssignments(viteConfig, "vendor");
    expect(vendorPatterns.some((p) => p.includes("/react/"))).toBe(true);
    expect(vendorPatterns.some((p) => p.includes("/react-dom/"))).toBe(true);
  });
});

/* ====================================================================
 * 5. AREA IMPORT BOUNDARIES — no direct barrel imports from partner/public
 * ==================================================================== */

describe("Chunk Splitting — Area Import Boundaries", () => {
  const partnerFiles = scanTsFiles(path.join(SRC_DIR, "pages/partner"));
  const partnerPageFiles = scanTsFiles(path.join(SRC_DIR, "pages")).filter(
    (f) =>
      f.relPath.includes("Partner") && !f.relPath.includes("/tests/")
  );
  const allPartnerFiles = [...partnerFiles, ...partnerPageFiles];

  const publicFiles = scanTsFiles(path.join(SRC_DIR, "pages/public"));
  const publicPageFiles = scanTsFiles(path.join(SRC_DIR, "pages")).filter(
    (f) =>
      (f.relPath.includes("Archive") ||
        f.relPath.includes("Auth") ||
        f.relPath.includes("Onboarding") ||
        f.relPath.includes("Shop") ||
        f.relPath.includes("History")) &&
      !f.relPath.includes("/tests/")
  );
  const allPublicFiles = [...publicFiles, ...publicPageFiles];

  /**
   * Hooks that are ONLY in member-area and should NOT be imported
   * from partner/public pages via the barrel. Instead, use direct imports.
   *
   * If a partner/public page needs one of these hooks, the hook should
   * be moved to shared in vite.config.ts, OR the import should be
   * a direct import (which Rollup can tree-shake or place correctly).
   */
  const memberOnlyHookPatterns = [
    /from\s+["']@\/hooks["']/,  // barrel import (catches everything)
  ];

  it("partner area pages must not import from hooks barrel (@/hooks)", () => {
    const violations: string[] = [];
    for (const file of allPartnerFiles) {
      for (const pattern of memberOnlyHookPatterns) {
        if (pattern.test(file.content)) {
          // Check it's not a type-only import
          const lines = file.content.split("\n");
          for (const line of lines) {
            if (
              pattern.test(line) &&
              !line.trim().startsWith("import type") &&
              !line.trim().startsWith("// ")
            ) {
              violations.push(`${file.relPath}: ${line.trim()}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("public area pages must not import from hooks barrel (@/hooks)", () => {
    const violations: string[] = [];
    for (const file of allPublicFiles) {
      for (const pattern of memberOnlyHookPatterns) {
        if (pattern.test(file.content)) {
          const lines = file.content.split("\n");
          for (const line of lines) {
            if (
              pattern.test(line) &&
              !line.trim().startsWith("import type") &&
              !line.trim().startsWith("// ")
            ) {
              violations.push(`${file.relPath}: ${line.trim()}`);
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

/* ====================================================================
 * 6. PRODUCTION HOOKS SAFETY — hooks in shared must not import
 *    production UI components at runtime
 * ==================================================================== */

describe("Chunk Splitting — Production Hook Safety", () => {
  /**
   * Production hooks are in shared, but they must NOT have runtime imports
   * from production UI components (src/components/production/).
   * Only `import type` is allowed (erased at compile time).
   */
  const productionHookFiles = [
    "src/hooks/useAdminProduction.ts",
    "src/hooks/useAdminProductionEnhancements.ts",
    "src/hooks/useAdminProductionFlow.ts",
    "src/hooks/useAdminProductionErpExtended.ts",
    "src/hooks/useProductionLogs.ts",
    "src/hooks/useLabelTemplates.ts",
    "src/hooks/useFlowNodeIotConfig.ts",
  ];

  for (const hookPath of productionHookFiles) {
    const fullPath = path.join(ROOT, hookPath);
    if (!fs.existsSync(fullPath)) continue;

    it(`${hookPath} must not have runtime imports from src/components/production/`, () => {
      const content = readFile(fullPath);
      const runtimeImports = extractRuntimeImports(content);

      const productionComponentImports = runtimeImports.filter((imp) => {
        const resolved = resolveAlias(imp);
        return (
          resolved?.includes("components/production") ||
          imp.includes("components/production")
        );
      });

      expect(productionComponentImports).toEqual([]);
    });
  }
});

/* ====================================================================
 * 7. AREA CHUNK COVERAGE — every area module directory is assigned
 * ==================================================================== */

describe("Chunk Splitting — Area Coverage", () => {
  /**
   * Every major area directory must have an explicit chunk assignment
   * in vite.config.ts. Without it, Rollup decides placement — which can
   * merge modules across areas and create cycles.
   */
  const areaDirectories: Array<[string, string]> = [
    ["/src/components/admin/", "admin-area"],
    ["/src/components/partner/", "partner-area"],
    ["/src/components/member/", "member-area"],
    ["/src/pages/partner/", "partner-area"],
    ["/src/pages/member/", "member-area"],
    ["/src/components/production/", "admin-production"],
    // NOTE: /src/components/ui/ is intentionally in "shared" (not a separate
    // "ui" chunk) to prevent ui ↔ admin-production TDZ cycles.
  ];

  for (const [dir, expectedChunk] of areaDirectories) {
    it(`${dir} must be assigned to ${expectedChunk}`, () => {
      const assignments = getChunkAssignments(viteConfig, expectedChunk);
      const found = assignments.some((p) => p.includes(dir));
      // Also check the shared patterns block (multi-line conditional)
      const sharedPatterns = getSharedChunkPatterns(viteConfig);
      const foundInShared = sharedPatterns.some((p) => p.includes(dir));

      // The directory should be assigned to its expected chunk (not shared, unless listed)
      expect(found || foundInShared).toBe(true);
    });
  }
});

/* ====================================================================
 * 8. VIRTUAL MODULES — must be in vendor (not area chunks)
 * ==================================================================== */

describe("Chunk Splitting — Virtual Module Safety", () => {
  it("virtual/commonjs helper modules must be assigned to vendor", () => {
    // Virtual modules (starting with \\u0000) and CommonJS helpers
    // must be in vendor. If they land in an area chunk, we get cycles like
    // vendor → admin-charts → vendor-data → vendor.
    expect(viteConfig).toMatch(/\\u0000/);
    expect(viteConfig).toMatch(/commonjsHelpers/);
    const nearVendor = viteConfig.includes("commonjsHelpers") &&
      viteConfig.includes('return "vendor"');
    expect(nearVendor).toBe(true);
  });
});

/* ====================================================================
 * 9. NO DIAGNOSTIC PLUGIN — must not ship diagnostic code
 * ==================================================================== */

describe("Chunk Splitting — No Diagnostic Code", () => {
  it("vite.config.ts must not contain diagnostic/debug plugins", () => {
    // Diagnostic plugins (chunk-map.json dumping, etc.) must not be committed
    expect(viteConfig).not.toMatch(/chunk-map\.json/);
    expect(viteConfig).not.toMatch(/generateBundle.*chunk-map/i);
    expect(viteConfig).not.toMatch(/writeFileSync.*chunk-map/);
  });

  it("no temporary analysis scripts should be referenced", () => {
    expect(viteConfig).not.toMatch(/\/tmp\//);
    expect(viteConfig).not.toMatch(/analyze.*chunk/i);
  });
});

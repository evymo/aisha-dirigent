/**
 * Redundant Translation Waterfall Detection
 *
 * Detects components that use `useDynamicTranslationsMap` to translate fields
 * that are ALREADY translated server-side by their RPC function.
 *
 * Background:
 * Many RPC functions accept `p_locale` and return translated `name`/`description`
 * via LEFT JOIN on the `translations` table (COALESCE pattern). If a component
 * fetches data from such an RPC and then ALSO calls `useDynamicTranslationsMap`
 * for the same fields, it creates:
 *   1. A redundant network request (waterfall)
 *   2. A race condition (data arrives → keys built → translations fetched async)
 *   3. Inconsistent UI (sometimes translated, sometimes raw DB values)
 *
 * This test enforces that once an RPC resolves translations server-side,
 * frontend components must NOT use the waterfall pattern for those fields.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.join(process.cwd(), "src");
const SQL_DIR = path.join(process.cwd(), "aisha/db/sql/functions");
const HOOKS_DIR = path.join(SRC_DIR, "hooks");

// ---------------------------------------------------------------------------
// 1. Discover which RPC functions already resolve translations server-side
// ---------------------------------------------------------------------------

/**
 * Parse SQL function files to find those that:
 * - Accept `p_locale` parameter
 * - JOIN on `translations` table (COALESCE pattern)
 *
 * These functions return already-translated name/description — no waterfall needed.
 */
function getLocaleAwareRPCs(): Map<string, { file: string; fields: string[] }> {
  const result = new Map<string, { file: string; fields: string[] }>();
  if (!fs.existsSync(SQL_DIR)) return result;

  const sqlFiles = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));

  for (const file of sqlFiles) {
    const content = fs.readFileSync(path.join(SQL_DIR, file), "utf-8");
    const funcName = file.replace(".sql", "");

    // Must accept p_locale
    if (!content.includes("p_locale")) continue;

    // Must JOIN on translations table (COALESCE pattern or get_translation_value_with_fallback)
    const hasTranslationJoin =
      /LEFT\s+JOIN\s+(?:public\.)?translations\b/i.test(content) ||
      /get_translation_value_with_fallback/i.test(content);

    if (!hasTranslationJoin) continue;

    // Detect which fields are translated using a simplified approach:
    // Find ") as field_name" lines whose preceding block (up to 30 lines)
    // contains either _t.value (JOIN pattern) or get_translation_value_with_fallback
    const translatedFields: string[] = [];
    const contentLines = content.split("\n");

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i].trim();

      // Look for lines like ") as field_name" or ") as field_name,"
      const asMatch = line.match(/^\)\s*as\s+(\w+)/i);
      if (!asMatch) continue;

      const fieldName = asMatch[1];

      // Scan backwards up to 30 lines looking for translation patterns
      // Don't stop at inner COALESCE — just look for the pattern in the block
      let hasTranslationCall = false;
      for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
        const prevLine = contentLines[j];
        if (
          /get_translation_value_with_fallback/i.test(prevLine) ||
          /_t\.value/i.test(prevLine)
        ) {
          hasTranslationCall = true;
          break;
        }
        // Stop at previous field boundary (another ") as ..." or SELECT keyword)
        if (/^\s*\)\s*as\s+\w+/i.test(prevLine) || /\bSELECT\b/i.test(prevLine)) {
          break;
        }
      }

      if (hasTranslationCall && !translatedFields.includes(fieldName)) {
        translatedFields.push(fieldName);
      }
    }

    // Also catch inline pattern on single line
    const inlinePattern =
      /(?:_t\.value|get_translation_value_with_fallback)[^)]*\)\s*as\s+(\w+)/gi;
    let match;
    while ((match = inlinePattern.exec(content)) !== null) {
      if (!translatedFields.includes(match[1])) {
        translatedFields.push(match[1]);
      }
    }

    if (translatedFields.length > 0) {
      result.set(funcName, { file, fields: translatedFields });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. Discover which hooks call these locale-aware RPCs AND pass p_locale
// ---------------------------------------------------------------------------

interface HookRPCUsage {
  hookFile: string;
  rpcName: string;
  passesLocale: boolean;
}

function getHookRPCUsages(localeAwareRPCs: Map<string, { file: string; fields: string[] }>): HookRPCUsage[] {
  const usages: HookRPCUsage[] = [];
  if (!fs.existsSync(HOOKS_DIR)) return usages;

  const hookFiles = fs.readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  for (const file of hookFiles) {
    const content = fs.readFileSync(path.join(HOOKS_DIR, file), "utf-8");

    for (const [rpcName] of localeAwareRPCs) {
      // Check if hook calls this RPC
      const rpcCallPattern = new RegExp(
        `\\.rpc\\s*\\(\\s*["'\`]${rpcName}["'\`]`,
        "g"
      );

      if (!rpcCallPattern.test(content)) continue;

      // Check if p_locale is passed
      // Look for p_locale in the params object near the rpc call
      const passesLocale = new RegExp(
        `\\.rpc\\s*\\(\\s*["'\`]${rpcName}["'\`][^)]*p_locale`,
        "s"
      ).test(content);

      usages.push({ hookFile: file, rpcName, passesLocale });
    }
  }

  return usages;
}

// ---------------------------------------------------------------------------
// 3. Find components that use BOTH a locale-aware hook AND useDynamicTranslationsMap
//    for the SAME namespace/entity — this is the redundant waterfall pattern
// ---------------------------------------------------------------------------

interface WaterfallViolation {
  file: string;
  relativePath: string;
  hookUsed: string;
  rpcName: string;
  translatedFields: string[];
  waterfallNamespace: string;
  /** lines where useDynamicTranslationsMap is called */
  waterfallLines: number[];
}

/**
 * Maps RPC function names to the namespace they serve.
 * This allows us to correlate the waterfall namespace with the RPC.
 */
const RPC_NAMESPACE_MAP: Record<string, string> = {
  get_active_studies: "studies",
  get_extended_studies: "studies",
  get_study_detail: "studies",
  get_public_products: "products",
  get_public_product_by_slug: "products",
  get_subscription_packages: "subscription_packages",
  get_public_hero_slides: "hero_slides",
};

/**
 * Maps hook files to the RPC functions they use (for cross-referencing).
 * If a component imports hook X, and hook X calls locale-aware RPC Y,
 * and the component also uses useDynamicTranslationsMap for namespace Z
 * where Z matches Y's namespace → it's a violation.
 */
function getHookToRPCMapping(
  hookUsages: HookRPCUsage[]
): Map<string, { rpcName: string; namespace: string }[]> {
  const mapping = new Map<string, { rpcName: string; namespace: string }[]>();

  for (const usage of hookUsages) {
    if (!usage.passesLocale) continue;
    const namespace = RPC_NAMESPACE_MAP[usage.rpcName];
    if (!namespace) continue;

    const hookName = usage.hookFile.replace(/\.(ts|tsx)$/, "");
    const existing = mapping.get(hookName) || [];
    existing.push({ rpcName: usage.rpcName, namespace });
    mapping.set(hookName, existing);
  }

  return mapping;
}

function findWaterfallViolations(
  hookMapping: Map<string, { rpcName: string; namespace: string }[]>,
  localeAwareRPCs: Map<string, { file: string; fields: string[] }>
): WaterfallViolation[] {
  const violations: WaterfallViolation[] = [];

  // Scan all .tsx and .ts files in src/ (pages, components, etc.)
  const scanDirs = ["pages", "components"];

  for (const dir of scanDirs) {
    const fullDir = path.join(SRC_DIR, dir);
    if (!fs.existsSync(fullDir)) continue;
    scanDirectory(fullDir, violations, hookMapping, localeAwareRPCs);
  }

  return violations;
}

function scanDirectory(
  dir: string,
  violations: WaterfallViolation[],
  hookMapping: Map<string, { rpcName: string; namespace: string }[]>,
  localeAwareRPCs: Map<string, { file: string; fields: string[] }>
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, violations, hookMapping, localeAwareRPCs);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entry.name.includes(".test.")) continue;

    const content = fs.readFileSync(fullPath, "utf-8");

    // Skip if no useDynamicTranslationsMap usage
    if (!content.includes("useDynamicTranslationsMap")) continue;

    const lines = content.split("\n");

    // Find which hooks this file imports
    const importedHooks = new Set<string>();
    for (const line of lines) {
      const importMatch = line.match(
        /import\s+\{([^}]+)\}\s+from\s+["']@\/hooks\/(\w+)["']/
      );
      if (importMatch) {
        importedHooks.add(importMatch[2]);
      }
    }

    // Check if any imported hook maps to a locale-aware RPC
    for (const hookName of importedHooks) {
      const rpcs = hookMapping.get(hookName);
      if (!rpcs) continue;

      for (const { rpcName, namespace } of rpcs) {
        // Find useDynamicTranslationsMap calls that target the SAME namespace
        const waterfallLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.includes("useDynamicTranslationsMap")) continue;

          // Build the full call expression (may span multiple lines)
          let callExpr = line;
          let parenDepth = 0;
          for (const ch of line) {
            if (ch === "(") parenDepth++;
            if (ch === ")") parenDepth--;
          }
          // If parentheses aren't balanced, read ahead
          if (parenDepth > 0) {
            for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
              callExpr += " " + lines[j].trim();
              for (const ch of lines[j]) {
                if (ch === "(") parenDepth++;
                if (ch === ")") parenDepth--;
              }
              if (parenDepth <= 0) break;
            }
          }

          // Check if this call targets the matching namespace
          // Pattern: useDynamicTranslationsMap(keys, "namespace", ...)
          const nsMatch = callExpr.match(
            /useDynamicTranslationsMap\s*\(\s*\w+\s*,\s*["'](\w+)["']/
          );
          if (nsMatch && nsMatch[1] === namespace) {
            waterfallLines.push(i + 1); // 1-based
          }

          // Also check for variable-based namespace references
          // or cases where key variable name suggests the namespace
          if (!nsMatch) {
            const keyVarMatch = callExpr.match(
              /useDynamicTranslationsMap\s*\(\s*(\w+)/
            );
            if (keyVarMatch) {
              const keyVarName = keyVarMatch[1].toLowerCase();
              if (
                (namespace === "studies" && keyVarName.includes("study")) ||
                (namespace === "products" && keyVarName.includes("product"))
              ) {
                waterfallLines.push(i + 1);
              }
            }
          }
        }

        if (waterfallLines.length > 0) {
          const rpcInfo = localeAwareRPCs.get(rpcName);
          violations.push({
            file: fullPath,
            relativePath: path.relative(process.cwd(), fullPath),
            hookUsed: hookName,
            rpcName,
            translatedFields: rpcInfo?.fields || [],
            waterfallNamespace: namespace,
            waterfallLines,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Find hooks that call locale-aware RPCs but DON'T pass p_locale
// ---------------------------------------------------------------------------

interface MissingLocaleViolation {
  hookFile: string;
  rpcName: string;
  translatedFields: string[];
}

function findMissingLocaleViolations(
  hookUsages: HookRPCUsage[],
  localeAwareRPCs: Map<string, { file: string; fields: string[] }>
): MissingLocaleViolation[] {
  return hookUsages
    .filter((u) => !u.passesLocale)
    .map((u) => ({
      hookFile: u.hookFile,
      rpcName: u.rpcName,
      translatedFields: localeAwareRPCs.get(u.rpcName)?.fields || [],
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Redundant Translation Waterfall Detection", () => {
  const localeAwareRPCs = getLocaleAwareRPCs();
  const hookUsages = getHookRPCUsages(localeAwareRPCs);
  const hookMapping = getHookToRPCMapping(hookUsages);

  it("should detect locale-aware RPC functions", () => {
    expect(localeAwareRPCs.size).toBeGreaterThan(0);

    // Known locale-aware RPCs must be detected
    const knownRPCs = [
      "get_active_studies",
      "get_extended_studies",
      "get_study_detail",
      "get_public_products",
      "get_public_product_by_slug",
    ];

    for (const rpc of knownRPCs) {
      expect(
        localeAwareRPCs.has(rpc),
        `Expected ${rpc} to be detected as locale-aware`
      ).toBe(true);
    }
  });

  it("should report locale-aware RPC inventory", () => {
    const entries = Array.from(localeAwareRPCs.entries())
      .sort(([a], [b]) => a.localeCompare(b));

    console.log(`\n📊 Locale-aware RPC functions (${entries.length}):`);
    for (const [name, info] of entries) {
      console.log(`  ${name}: translates [${info.fields.join(", ")}]`);
    }
  });

  it("should have NO redundant translation waterfall patterns", () => {
    const violations = findWaterfallViolations(
      hookMapping,
      localeAwareRPCs
    );

    // Allowlist for LEGITIMATE waterfall usages where:
    // - The component translates JSONB marketing content with embedded keys
    //   (server-side RPC translates name/description but NOT inner JSONB keys)
    // Key format: "relative/path:lineNumber"
    const allowedWaterfalls = new Set([
      // ProductPage translates marketing JSONB content (origin, benefits,
      // substances, usage) which contains embedded translation keys that
      // are NOT resolved by get_public_product_by_slug/get_public_products
      "src/pages/shop/ProductPage.tsx:300",
    ]);

    const realViolations = violations.filter((v) => {
      for (const line of v.waterfallLines) {
        const key = `${v.relativePath}:${line}`;
        if (!allowedWaterfalls.has(key)) return true;
      }
      return false;
    });

    if (realViolations.length > 0) {
      const report = realViolations
        .map(
          (v) =>
            `  ${v.relativePath}:${v.waterfallLines.join(",")}\n` +
            `    Hook: ${v.hookUsed} → RPC: ${v.rpcName}\n` +
            `    Server-translated fields: [${v.translatedFields.join(", ")}]\n` +
            `    Redundant waterfall namespace: "${v.waterfallNamespace}"\n` +
            `    Fix: Use data.name / data.description directly (already translated)`
        )
        .join("\n\n");

      expect.fail(
        `Found ${realViolations.length} redundant translation waterfall(s):\n\n${report}\n\n` +
          `These components use useDynamicTranslationsMap for fields that are\n` +
          `already translated server-side by the RPC function.\n` +
          `Remove the waterfall and use the server-provided values directly.`
      );
    }
  });

  it("hooks calling locale-aware RPCs should pass p_locale", () => {
    const violations = findMissingLocaleViolations(hookUsages, localeAwareRPCs);

    // Allow known exceptions (fallback paths, admin-only, etc.)
    const allowedExceptions = new Set([
      // Fallback paths in useStudyFunding that use get_active_studies without locale
      // as a last-resort fallback when the primary RPC fails
      "useStudyFunding.ts:get_active_studies",
    ]);

    const realViolations = violations.filter(
      (v) => !allowedExceptions.has(`${v.hookFile}:${v.rpcName}`)
    );

    if (realViolations.length > 0) {
      const report = realViolations
        .map(
          (v) =>
            `  ${v.hookFile}: calls ${v.rpcName} without p_locale\n` +
            `    This RPC translates: [${v.translatedFields.join(", ")}]\n` +
            `    Fix: Pass { p_locale: getTranslationLocale(locale) } to the RPC call`
        )
        .join("\n\n");

      expect.fail(
        `Found ${realViolations.length} hook(s) calling locale-aware RPCs without p_locale:\n\n${report}\n\n` +
          `These hooks use RPC functions that support server-side translations,\n` +
          `but don't pass the locale parameter — resulting in English-only output.`
      );
    }
  });

  it("should report hook-to-RPC locale mapping", () => {
    const entries = Array.from(hookMapping.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    console.log(
      `\n📊 Hooks passing p_locale to RPCs (${entries.length}):`
    );
    for (const [hookName, rpcs] of entries) {
      for (const { rpcName, namespace } of rpcs) {
        console.log(`  ${hookName} → ${rpcName} (namespace: ${namespace})`);
      }
    }
  });
});

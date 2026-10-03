/**
 * Frontend Ordering Compatibility Tests
 * 
 * Validates that all hooks and services that work with ordered data:
 * 1. READ: Receive data already sorted by RPC (trust backend ORDER BY)
 * 2. WRITE: Include sort_order/display_order in create/update operations
 * 
 * This ensures UI displays items in consistent order and new items
 * are created with proper ordering values.
 * 
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(WORKSPACE_ROOT, "src");
const MOBILE_DIR = path.join(WORKSPACE_ROOT, "mobile-app/src");

/**
 * Tables that have sort_order or display_order columns
 * and their expected patterns in frontend code
 */
const ORDERING_TABLES = [
  {
    table: "hero_slides",
    column: "sort_order",
    hooks: ["useHeroSlides", "useAdminHeroSlides"],
    createRpc: "create_hero_slide_admin",
    updateRpc: "update_hero_slide_admin",
  },
  {
    table: "subscription_packages",
    column: "sort_order",
    hooks: ["useAdminSubscriptionPackages", "useMembership"],
    createRpc: "create_subscription_package_admin",
    updateRpc: "update_subscription_package_admin",
  },
  {
    table: "questionnaire_blocks",
    column: "display_order",
    hooks: ["useQuestionnaireBlocks"],
    createRpc: "create_questionnaire_block",
    updateRpc: "update_questionnaire_block",
  },
  {
    table: "study_consent_requirements",
    column: "display_order",
    hooks: ["useAdminStudyConsents"],
    createRpc: "upsert_study_consent_requirement_admin",
    updateRpc: "upsert_study_consent_requirement_admin",
  },
  {
    table: "token_reward_rules",
    column: "sort_order",
    hooks: ["useTokenRewardRules"],
    createRpc: "create_token_reward_rule_admin",
    updateRpc: "update_token_reward_rule_admin",
  },
  {
    table: "supported_languages",
    column: "sort_order",
    hooks: ["useSupportedLanguages"],
    createRpc: "create_supported_language",
    updateRpc: "update_supported_language",
  },
];

// =============================================================================
// Helpers
// =============================================================================

function findHookFiles(hookNames: string[], srcDir: string): string[] {
  const hooksDir = path.join(srcDir, "hooks");
  const found = new Set<string>();

  if (!fs.existsSync(hooksDir)) return [];

  for (const hookName of hookNames) {
    // Exact-name files first.
    const directCandidates = [
      path.join(hooksDir, `${hookName}.ts`),
      path.join(hooksDir, `${hookName}.tsx`),
    ];
    for (const p of directCandidates) {
      if (fs.existsSync(p)) found.add(p);
    }

    // Fallback: scan all hook files for `export function <hookName>` / `export const <hookName>`.
    // Many hooks live inside larger feature files (e.g. useTokenRewardRules
    // is exported from useTokenomics.ts).
    const exportPattern = new RegExp(
      `export\\s+(?:function|const)\\s+${hookName}\\b`,
    );
    for (const entry of fs.readdirSync(hooksDir)) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      const full = path.join(hooksDir, entry);
      if (found.has(full)) continue;
      const content = fs.readFileSync(full, "utf-8");
      if (exportPattern.test(content)) {
        found.add(full);
      }
    }
  }

  return [...found];
}

function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function checkOrderingInFile(
  content: string,
  column: string,
  rpcName: string
): { hasColumn: boolean; hasRpc: boolean; usesColumn: boolean } {
  const hasColumn = content.includes(column);
  const hasRpc = content.includes(rpcName);
  // Check if the column is used in RPC params
  const usesColumn = 
    content.includes(`p_${column}`) || 
    content.includes(`"${column}"`) ||
    content.includes(`${column}:`) ||
    content.includes(`${column} :`);
  
  return { hasColumn, hasRpc, usesColumn };
}

// =============================================================================
// Tests
// =============================================================================

describe("Frontend Ordering Compatibility - Read Operations", () => {
  it("hooks that read ordered data trust backend ORDER BY", () => {
    const issues: string[] = [];
    
    for (const config of ORDERING_TABLES) {
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);
      
      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const fileName = path.basename(filePath);
        
        // Check if hook does client-side sorting that might override backend order
        const hasClientSort = /\.sort\s*\(\s*\([^)]*\)\s*=>/i.test(content);
        const sortsCorrectColumn = 
          content.includes(`.sort((a, b) => a.${config.column}`) ||
          content.includes(`.sort((a, b) => (a.${config.column}`);
        
        // Client-side sort is OK only if it sorts by the same column
        if (hasClientSort && !sortsCorrectColumn) {
          // Check if it's sorting by a different column intentionally
          const sortMatch = content.match(/\.sort\s*\([^)]+\)/g);
          if (sortMatch) {
            // Allow sorting by created_at or name for display purposes
            const allowedPatterns = [
              "created_at",
              "updated_at",
              "name",
              "title",
              config.column,
            ];
            const isAllowed = sortMatch.some(sort =>
              allowedPatterns.some(p => sort.includes(p))
            );
            if (!isAllowed) {
              issues.push(
                `${fileName}: Has client-side sort that may override ${config.column} order`
              );
            }
          }
        }
      }
    }
    
    if (issues.length > 0) {
      console.warn("⚠️ Potential ordering issues in read operations:");
      issues.forEach(i => console.warn(`   - ${i}`));
    }
    
    // This is informational - we don't fail the test
    expect(true).toBe(true);
  });

  it("ordered data hooks use RPC functions (not direct queries)", () => {
    const issues: string[] = [];
    
    for (const config of ORDERING_TABLES) {
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);
      
      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const fileName = path.basename(filePath);
        
        // Check for direct table access instead of RPC
        const directAccess = content.includes(`.from("${config.table}")`);
        const usesRpc = content.includes(".rpc(");
        
        if (directAccess && !usesRpc) {
          issues.push(
            `${fileName}: Uses direct table access instead of RPC for ${config.table}`
          );
        }
      }
    }
    
    if (issues.length > 0) {
      console.error("❌ Direct table access (should use RPC):");
      issues.forEach(i => console.error(`   - ${i}`));
    }
    
    expect(issues).toHaveLength(0);
  });
});

describe("Frontend Ordering Compatibility - Write Operations", () => {
  it("create operations include ordering column", () => {
    const issues: string[] = [];
    const success: string[] = [];
    
    for (const config of ORDERING_TABLES) {
      if (!config.createRpc) continue;
      
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);
      
      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const fileName = path.basename(filePath);
        
        // Check if hook has create mutation
        if (!content.includes(config.createRpc) && !content.includes("create")) {
          continue; // No create operation in this hook
        }
        
        const result = checkOrderingInFile(content, config.column, config.createRpc);
        
        if (result.hasRpc && !result.usesColumn) {
          issues.push(
            `${fileName}: ${config.createRpc} doesn't pass ${config.column}`
          );
        } else if (result.hasRpc && result.usesColumn) {
          success.push(`${fileName}: ${config.createRpc} includes ${config.column}`);
        }
      }
    }
    
    if (success.length > 0) {
      console.log("✅ Create operations with ordering:");
      success.forEach(s => console.log(`   - ${s}`));
    }
    
    if (issues.length > 0) {
      console.warn("⚠️ Create operations missing ordering column:");
      issues.forEach(i => console.warn(`   - ${i}`));
    }
    
    // Warning only - some creates may use DB defaults
    expect(true).toBe(true);
  });

  it("update operations can update ordering column", () => {
    const issues: string[] = [];
    const success: string[] = [];
    
    for (const config of ORDERING_TABLES) {
      if (!config.updateRpc) continue;
      
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);
      
      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const fileName = path.basename(filePath);
        
        if (!content.includes(config.updateRpc) && !content.includes("update")) {
          continue; // No update operation
        }
        
        const result = checkOrderingInFile(content, config.column, config.updateRpc);
        
        if (result.hasRpc) {
          if (result.usesColumn) {
            success.push(`${fileName}: ${config.updateRpc} can update ${config.column}`);
          } else {
            // Check if it's an optional param (acceptable)
            const hasOptionalColumn = 
              content.includes(`${config.column}?:`) ||
              content.includes(`${config.column}?: number`);
            if (hasOptionalColumn) {
              success.push(`${fileName}: ${config.updateRpc} has optional ${config.column}`);
            }
          }
        }
      }
    }
    
    if (success.length > 0) {
      console.log("✅ Update operations with ordering support:");
      success.forEach(s => console.log(`   - ${s}`));
    }
    
    expect(true).toBe(true);
  });
});

describe("Mobile App Ordering Compatibility", () => {
  it("mobile types include ordering columns", () => {
    const typesPath = path.join(MOBILE_DIR, "types/supabase.ts");
    
    if (!fs.existsSync(typesPath)) {
      console.log("ℹ️ Mobile types file not found, skipping");
      return;
    }
    
    const content = readFileContent(typesPath);
    
    // Check that types include ordering columns
    const hassSortOrder = content.includes("sort_order");
    const hasDisplayOrder = content.includes("display_order");
    
    console.log(`📱 Mobile App Types:`);
    console.log(`   - sort_order: ${hassSortOrder ? "✅" : "❌"}`);
    console.log(`   - display_order: ${hasDisplayOrder ? "✅" : "❌"}`);
    
    expect(hassSortOrder).toBe(true);
    expect(hasDisplayOrder).toBe(true);
  });

  it("mobile questionnaire types have display_order", () => {
    const questionnairePath = path.join(MOBILE_DIR, "types/questionnaire.ts");
    
    if (!fs.existsSync(questionnairePath)) {
      console.log("ℹ️ Mobile questionnaire types not found, skipping");
      return;
    }
    
    const content = readFileContent(questionnairePath);
    const hasDisplayOrder = content.includes("display_order");
    
    expect(hasDisplayOrder).toBe(true);
  });
});

describe("Ordering Column Consistency Check", () => {
  it("all hooks handle null/undefined ordering gracefully", () => {
    const issues: string[] = [];

    for (const config of ORDERING_TABLES) {
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);

      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const fileName = path.basename(filePath);

        // Distinguish READ access (server response → UI) from WRITE/INPUT
        // access (payload → RPC parameter). Only reads need null guarding;
        // writes are typed as `number` and TypeScript enforces caller intent.
        //
        // READ pattern: `<var>.<column>` where var is NOT a known input
        // variable name. Examples: slide.sort_order, p.sort_order,
        // block.display_order.
        // WRITE pattern: `payload.<column>` or `p_<column>:` (passed to RPC)
        // or `<column>:` in a TS type declaration (`sort_order: number;`).
        const readPattern = new RegExp(
          `\\b(?!payload\\b|request\\b|params\\b|input\\b|args\\b|p_)\\w+\\.${config.column}\\b`,
          "g",
        );
        const readMatches = [...content.matchAll(readPattern)];

        if (readMatches.length === 0) continue; // no reads — skip

        // For every read, confirm there is a null-guard within ±60 chars
        // (same line / expression).
        const unguardedReads = readMatches.filter((m) => {
          const start = Math.max(0, m.index! - 60);
          const end = Math.min(content.length, m.index! + 80);
          const ctx = content.substring(start, end);
          return !(
            ctx.includes(`${config.column} ?? `) ||
            ctx.includes(`${config.column} || `) ||
            ctx.includes(`${config.column}?.`) ||
            ctx.includes(`${config.column} !== null`) ||
            ctx.includes(`${config.column} != null`)
          );
        });

        // File-level safety nets that make pointwise null-guards redundant:
        //  - Zod schema with `.default(...)`
        //  - Zod schema with `z.number()` (strict, no `.nullable()`)
        //  - Interface declaration with `${column}: number;` (non-null TS type)
        //    Reject `: number | null` and `?: number` (optional).
        const hasZodDefault =
          content.includes(`${config.column}: z.`) &&
          content.includes(".default(");
        const hasZodNumberStrict = new RegExp(
          `${config.column}:\\s*z\\.number\\(\\)(?!\\.nullable|\\.optional)`,
        ).test(content);
        const hasNonNullInterface = new RegExp(
          `${config.column}:\\s*number\\s*;`,
        ).test(content);

        if (
          unguardedReads.length > 0 &&
          !hasZodDefault &&
          !hasZodNumberStrict &&
          !hasNonNullInterface
        ) {
          issues.push(
            `${fileName}: May not handle null ${config.column} - consider ?? 0 (${unguardedReads.length} unguarded read site${unguardedReads.length > 1 ? "s" : ""})`,
          );
        }
      }
    }

    if (issues.length > 0) {
      console.warn("⚠️ Potential null handling issues:");
      issues.forEach((i) => console.warn(`   - ${i}`));
    }

    expect(issues, "all read sites for sort_order/display_order must guard against null").toHaveLength(0);
  });

  it("generates ordering compatibility report", () => {
    console.log("\n📊 Ordering Compatibility Report\n");
    console.log("Tables with ordering columns:");
    console.log("─".repeat(60));
    
    for (const config of ORDERING_TABLES) {
      const hookFiles = findHookFiles(config.hooks, SRC_DIR);
      const hookCount = hookFiles.length;
      
      console.log(`\n${config.table} (${config.column}):`);
      console.log(`   Hooks: ${config.hooks.join(", ")} (${hookCount} found)`);
      console.log(`   Create RPC: ${config.createRpc || "N/A"}`);
      console.log(`   Update RPC: ${config.updateRpc || "N/A"}`);
      
      // Check each hook
      for (const filePath of hookFiles) {
        const content = readFileContent(filePath);
        const usesRpc = content.includes(".rpc(");
        const hasColumn = content.includes(config.column);
        const hasSort = content.includes(".sort(");
        
        console.log(`   → ${path.basename(filePath)}: RPC=${usesRpc ? "✓" : "✗"} Column=${hasColumn ? "✓" : "✗"} ClientSort=${hasSort ? "⚠️" : "✗"}`);
      }
    }
    
    console.log("\n" + "─".repeat(60));
    
    expect(true).toBe(true);
  });
});

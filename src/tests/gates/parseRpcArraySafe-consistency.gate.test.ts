/**
 * parseRpcArraySafe Consistency Gate Test
 *
 * parseRpcArraySafe is a critical function that parses RPC array responses
 * using Zod safeParse — it silently drops invalid items instead of throwing.
 * This is by design (graceful degradation), but it means Zod schema mismatches
 * go unnoticed in production.
 *
 * The codebase should have a SINGLE canonical definition, re-exported from
 * a shared location. Duplicate local definitions cause:
 * - Inconsistent signatures (some have error logging, some don't)
 * - Inconsistent parameter order (schema,data vs data,schema)
 * - Missing safeError logging when items are dropped
 * - Harder maintenance when behavior needs to change
 *
 * Run: npm run test:gates -- src/tests/gates/parseRpcArraySafe-consistency.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParseDefinition {
  filePath: string;
  line: number;
  isExported: boolean;
  paramOrder: string;
}

/**
 * Recursively finds all files defining parseRpcArraySafe.
 */
function findParseRpcArraySafeDefinitions(dir: string): ParseDefinition[] {
  const definitions: ParseDefinition[] = [];

  function walk(current: string): void {
    if (!fs.existsSync(current)) return;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, dist, .git
        if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/function\s+parseRpcArraySafe/.test(line)) {
            // Determine parameter order by looking at the signature
            const sigBlock = lines.slice(i, i + 5).join(" ");
            let paramOrder = "unknown";
            if (/\(\s*schema/.test(sigBlock)) {
              paramOrder = "schema-first";
            } else if (/\(\s*data/.test(sigBlock)) {
              paramOrder = "data-first";
            }

            definitions.push({
              filePath: path.relative(ROOT, fullPath),
              line: i + 1,
              isExported: /export\s+function\s+parseRpcArraySafe/.test(line),
              paramOrder,
            });
          }
        }
      }
    }
  }

  walk(dir);
  return definitions;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseRpcArraySafe consistency", () => {
  let definitions: ParseDefinition[];

  beforeAll(() => {
    definitions = findParseRpcArraySafeDefinitions(SRC_DIR);
  });

  it("finds at least one definition of parseRpcArraySafe", () => {
    expect(
      definitions.length,
      "No parseRpcArraySafe definitions found in src/",
    ).toBeGreaterThan(0);
  });

  it("has at most ONE canonical exported definition", () => {
    const exported = definitions.filter((d) => d.isExported);

    expect(
      exported.length,
      `Expected exactly 1 exported parseRpcArraySafe, found ${exported.length}:\n` +
        exported.map((d) => `  ${d.filePath}:${d.line}`).join("\n"),
    ).toBeLessThanOrEqual(1);
  });

  it("tracks duplicate local definitions (should import from canonical)", () => {
    const localCopies = definitions.filter((d) => !d.isExported);
    const exported = definitions.filter((d) => d.isExported);

    if (localCopies.length > 0) {
      const report = localCopies
        .map((d) => `  ${d.filePath}:${d.line} (${d.paramOrder})`)
        .join("\n");

      // Threshold gate: fail if LOCAL copies INCREASE beyond current known count.
      // As duplicates get centralized, lower this threshold.
      const KNOWN_LOCAL_COPY_COUNT = 6;

      expect(
        localCopies.length,
        `parseRpcArraySafe local copies increased beyond known count (${KNOWN_LOCAL_COPY_COUNT}).\n` +
          `New duplicates MUST import from ${exported[0]?.filePath ?? "canonical location"} instead.\n` +
          `Current copies:\n${report}`,
      ).toBeLessThanOrEqual(KNOWN_LOCAL_COPY_COUNT);
    }
  });

  it("tracks parameter order consistency across definitions", () => {
    const orders = [...new Set(definitions.map((d) => d.paramOrder))];

    if (orders.length > 1) {
      const report = definitions
        .map((d) => `  ${d.filePath}:${d.line} → ${d.paramOrder}`)
        .join("\n");

      // Threshold gate: fail if ADDITIONAL inconsistent orders appear.
      // Current known: schema-first (canonical) + data-first (legacy).
      const KNOWN_ORDER_COUNT = 2;

      expect(
        orders.length,
        `parseRpcArraySafe signature variants increased beyond known count (${KNOWN_ORDER_COUNT}).\n` +
          `Existing variants: ${orders.join(", ")}.\n` +
          `All definitions:\n${report}`,
      ).toBeLessThanOrEqual(KNOWN_ORDER_COUNT);
    }
  });
});

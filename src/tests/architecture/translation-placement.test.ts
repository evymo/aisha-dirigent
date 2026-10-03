/**
 * Translation Placement Validation Test
 *
 * Validates that translations are placed in the correct location:
 * - DB-managed content (biomarkers, products, studies) → translations via translation keys (_key columns)
 * - App UI content (labels, buttons, messages) → translations in i18n locales
 *
 * This test ensures we don't accidentally put DB content translations into locales,
 * which would create maintenance burden and data inconsistency.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const LOCALES_DIR = path.join(process.cwd(), "src/i18n/locales");
const SEGMENTS_DIR = path.join(process.cwd(), "src/i18n/segments");

/**
 * Tables that have multilingual content managed via translation keys.
 * These should NOT have full translation entries duplicated in locales
 * (translations are resolved at runtime via the translations table).
 *
 * Each entry defines:
 * - table: DB table name
 * - fields: Multilingual field base names (e.g., "name" means name_key exists)
 * - forbiddenPatterns: Regex patterns that indicate DB content leaked into locales
 */
const DB_MANAGED_CONTENT_TABLES = [
  {
    table: "biomarker_reference_ranges",
    fields: ["name", "description"],
    // This pattern would catch a section like:
    // "biomarkers": { "crp": { "name": "C-Reactive Protein", "description": "..." } }
    // But NOT: "biomarkers": { "title": "Biomarker Management" } (UI text)
    forbiddenPatterns: [
      // Pattern: biomarker key with name/description subfields (DB content style)
      /"(crp|esr|il_6|tnf_alpha|glucose|hba1c|insulin|cholesterol|hdl|ldl|triglycerides|vitamin_d|vitamin_b12|alt|ast|creatinine|urea|nk_cells|cd4|cd8|nad_nadh|omega3|wbc|rbc|hemoglobin|platelets)":\s*\{\s*"name":/i,
    ],
  },
  {
    table: "products",
    fields: ["name", "description", "short_description"],
    // Note: Marketing page descriptions (shop.json, research.json) are static page content,
    // NOT editable DB content. They belong in locales.
    // This pattern would only flag if someone copied full DB product records to locales.
    forbiddenPatterns: [
      // Empty - product marketing texts are valid static content in locales
      // DB products table has its own translations, separate from marketing pages
    ],
  },
  {
    table: "studies",
    fields: ["title", "description"],
    forbiddenPatterns: [
      // Study IDs with title/description (if they were hardcoded)
      // Currently studies are dynamic, so this is a safety check
    ],
  },
  {
    table: "achievements",
    fields: ["name", "description"],
    forbiddenPatterns: [
      // Achievement keys with multilingual content
    ],
  },
  {
    table: "consent_templates",
    fields: ["title", "content"],
    forbiddenPatterns: [
      // Consent template content should be in DB, not locales
    ],
  },
];

/**
 * Read all JSON files from locales directory
 */
function readLocaleFiles(): Map<string, object> {
  const result = new Map<string, object>();

  if (!fs.existsSync(LOCALES_DIR)) return result;

  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(LOCALES_DIR, file), "utf-8");
      result.set(file, JSON.parse(content));
    } catch {
      // Skip invalid JSON
    }
  }

  return result;
}

/**
 * Read all segment JSON files from segments directory (recursive)
 */
function readSegmentFiles(): Map<string, object> {
  const result = new Map<string, object>();

  if (!fs.existsSync(SEGMENTS_DIR)) return result;

  function scanDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".json")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          result.set(`${prefix}${entry.name}`, JSON.parse(content));
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  scanDir(SEGMENTS_DIR, "");
  return result;
}

/**
 * Stringify object to check for pattern matches
 */
function checkForForbiddenPatterns(
  content: object,
  patterns: RegExp[]
): string[] {
  const violations: string[] = [];
  const json = JSON.stringify(content, null, 2);

  for (const pattern of patterns) {
    if (pattern.test(json)) {
      const match = json.match(pattern);
      violations.push(
        `Found DB content pattern: ${pattern.source} (matched: "${match?.[0]?.substring(0, 50)}...")`
      );
    }
  }

  return violations;
}

describe("Translation Placement Validation", () => {
  describe("DB-managed content should NOT be in locales", () => {
    const locales = readLocaleFiles();
    const segments = readSegmentFiles();

    for (const table of DB_MANAGED_CONTENT_TABLES) {
      if (table.forbiddenPatterns.length === 0) continue;

      describe(`${table.table} translations`, () => {
        it("should not have DB content in compiled locales", () => {
          const violations: string[] = [];

          for (const [file, content] of locales) {
            const fileViolations = checkForForbiddenPatterns(
              content,
              table.forbiddenPatterns
            );
            if (fileViolations.length > 0) {
              violations.push(`${file}: ${fileViolations.join(", ")}`);
            }
          }

          expect(violations).toEqual([]);
        });

        it("should not have DB content in segment source files", () => {
          const violations: string[] = [];

          for (const [file, content] of segments) {
            const fileViolations = checkForForbiddenPatterns(
              content,
              table.forbiddenPatterns
            );
            if (fileViolations.length > 0) {
              violations.push(`${file}: ${fileViolations.join(", ")}`);
            }
          }

          expect(violations).toEqual([]);
        });
      });
    }
  });

  describe("Locale structure validation", () => {
    it("should have consistent key counts across locales", () => {
      const locales = readLocaleFiles();
      const keyCounts: Map<string, number> = new Map();

      function countKeys(obj: unknown, prefix = ""): number {
        if (typeof obj !== "object" || obj === null) return 1;
        let count = 0;
        for (const [key, value] of Object.entries(obj)) {
          count += countKeys(value, `${prefix}.${key}`);
        }
        return count;
      }

      for (const [file, content] of locales) {
        keyCounts.set(file, countKeys(content));
      }

      // All locales should have the same number of keys (or close to it)
      const counts = Array.from(keyCounts.values());
      const min = Math.min(...counts);
      const max = Math.max(...counts);

      // Allow some variance (5%) for incomplete translations
      const variance = (max - min) / max;
      expect(variance).toBeLessThan(0.05);
    });

    it("should have base language (en) as reference", () => {
      const locales = readLocaleFiles();
      expect(locales.has("en.json")).toBe(true);
    });

    it("should have Czech (cs) as primary translation", () => {
      const locales = readLocaleFiles();
      expect(locales.has("cs.json")).toBe(true);
    });
  });

  describe("Segment-to-locale mapping validation", () => {
    it("should have matching segment files for each language", () => {
      const languages = ["en", "cs", "de", "fr", "ru", "th"];
      const segmentNames = new Set<string>();

      // Collect all segment file names from EN (reference)
      const enDir = path.join(SEGMENTS_DIR, "en");
      if (fs.existsSync(enDir)) {
        for (const file of fs.readdirSync(enDir)) {
          if (file.endsWith(".json")) {
            segmentNames.add(file);
          }
        }
      }

      // Check all languages have the same segments
      for (const lang of languages) {
        const langDir = path.join(SEGMENTS_DIR, lang);
        if (!fs.existsSync(langDir)) continue;

        const langSegments = fs
          .readdirSync(langDir)
          .filter((f) => f.endsWith(".json"));

        for (const segment of segmentNames) {
          expect(
            langSegments.includes(segment),
            `${lang} should have segment ${segment}`
          ).toBe(true);
        }
      }
    });
  });
});

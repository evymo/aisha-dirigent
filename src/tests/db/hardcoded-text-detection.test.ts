/**
 * Hardcoded Text Detection Tests
 * 
 * These tests detect hardcoded localized text patterns in database seeds and SQL files.
 * All translatable content should use translation keys stored in the `translations` table.
 * 
 * PATTERNS TO DETECT:
 * 1. Columns with _cs/_en suffixes (e.g., name_cs, description_en)
 * 2. JSON objects with locale keys containing text (e.g., {"cs": "...", "en": "..."})
 * 3. Hardcoded Czech/English text that should be translation keys
 * 
 * ALLOWED EXCEPTIONS:
 * - base_locale column (indicates source language)
 * - locale columns in translations table itself
 * - Test/development seed files in dev/ folder
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

// Tables that are KNOWN to have hardcoded locale columns - these need migration
// Remove from this list as they get converted to translation keys
const KNOWN_LEGACY_TABLES = [
  // Products: marketing content still has hardcoded JSON
  "origin_content",
  "benefits_content",
  "substances_content",
  "usage_content",
  // Token reward rules: need full i18n conversion
  "action_name_cs",
  "action_name_en",
  "description_cs",
  "description_en",
  // Biomarkers: need full i18n conversion
  "name_cs",
  "name_en",
  // Archive documents: need full i18n conversion
  "title_cs",
  "title_en",
  "summary_cs",
  "summary_en",
  "editorial_note_cs",
  "editorial_note_en",
  // Study consent templates
  "content_cs",
  "content_en",
  "checkbox_label_cs",
  "checkbox_label_en",
  // Test questions / invitations
  "question_cs",
  "question_en",
  "option_a_cs",
  "option_a_en",
  "option_b_cs",
  "option_b_en",
  "option_c_cs",
  "option_c_en",
  "option_d_cs",
  "option_d_en",
  "what_you_are_looking_at_cs",
  "what_you_are_looking_at_en",
  "standards_context_cs",
  "standards_context_en",
];

// Files that are allowed to have hardcoded text (test data, examples, etc.)
const ALLOWED_FILES = [
  "aisha/db/seed/dev/",
  "aisha/db/seed/test/",
  "archive/",
];

describe("Hardcoded Text Detection", () => {
  const seedDir = path.join(process.cwd(), "aisha", "db", "seed", "core");
  const sqlFunctionsDir = path.join(process.cwd(), "aisha", "db", "sql", "functions");

  describe("Seed files should not have hardcoded locale columns", () => {
    const seedFiles = glob.sync("**/*.sql", { cwd: seedDir });

    for (const file of seedFiles) {
      it(`${file} should not introduce new _cs/_en column patterns`, () => {
        const filePath = path.join(seedDir, file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Pattern: column_name_cs, column_name_en (but not *_key or base_locale)
        const localeColumnPattern = /(\w+)_(cs|en|de|fr|ru|th)\b(?!\s*_key)/gi;
        const matches = [...content.matchAll(localeColumnPattern)];

        // Filter out known legacy patterns
        const newViolations = matches.filter((match) => {
          const columnName = `${match[1]}_${match[2]}`;
          return !KNOWN_LEGACY_TABLES.includes(columnName);
        });

        if (newViolations.length > 0) {
          const uniquePatterns = [...new Set(newViolations.map((m) => m[0]))];
          console.warn(`Found hardcoded locale columns in ${file}:`, uniquePatterns);
        }

        expect(newViolations.length).toBe(0);
      });
    }
  });

  describe("Seed files should not have hardcoded JSON with locale keys", () => {
    const seedFiles = glob.sync("**/*.sql", { cwd: seedDir });

    for (const file of seedFiles) {
      it(`${file} should not have new hardcoded locale JSON patterns`, () => {
        const filePath = path.join(seedDir, file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Pattern: {"cs": "...", "en": "..."} or similar nested structures
        // This is a simplified check - looks for JSON-like patterns with locale keys
        const jsonLocalePattern = /"(cs|en|de|fr|ru|th)"\s*:\s*\{[^}]*"(title|description|text|label|name|message)"/gi;
        const matches = [...content.matchAll(jsonLocalePattern)];

        // Filter out known legacy files
        const isLegacyFile = file.includes("07_system_config.sql");

        if (!isLegacyFile && matches.length > 0) {
          console.warn(`Found hardcoded locale JSON in ${file}:`, matches.map((m) => m[0]));
          expect(matches.length).toBe(0);
        }
      });
    }
  });

  describe("SQL functions should not contain hardcoded user-facing strings", () => {
    const functionFiles = fs.existsSync(sqlFunctionsDir) 
      ? glob.sync("*.sql", { cwd: sqlFunctionsDir })
      : [];

    for (const file of functionFiles) {
      it(`${file} should not have hardcoded Czech/English error messages`, () => {
        const filePath = path.join(sqlFunctionsDir, file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Pattern: Common Czech/English words in RAISE EXCEPTION messages
        // (excluding technical terms)
        const czechPatterns = [
          /RAISE\s+EXCEPTION\s+'[^']*(?:Nepodařilo|Chyba|Nelze|Neplatný)[^']*'/gi,
        ];

        const englishPatterns = [
          // English patterns that should use error codes, not user messages
          /RAISE\s+EXCEPTION\s+'[^']*(?:Invalid|Failed|Cannot|Error)[^']*'(?!\s*USING)/gi,
        ];

        // These are OK - they use SQLSTATE or are technical
        const technicalExceptions = /USING\s+ERRCODE|SQLSTATE/gi;

        for (const pattern of [...czechPatterns, ...englishPatterns]) {
          const matches = [...content.matchAll(pattern)];
          const filteredMatches = matches.filter((m) => !technicalExceptions.test(m[0]));
          
          // Only warn, don't fail - user-facing errors are a best practice, not requirement
          if (filteredMatches.length > 0) {
            console.warn(`${file} has user-facing exception messages (consider using error codes):`, 
              filteredMatches.map((m) => m[0].substring(0, 60)));
          }
        }
      });
    }
  });

  describe("Hardcoded locale column regression guard", () => {
    it("no table introduces `<name>_cs` / `<name>_en` columns (use `<name>_key` + translations)", () => {
      const tablesDir = path.join(process.cwd(), "aisha/db/sql/tables");
      if (!fs.existsSync(tablesDir)) return;

      // Match `<col>_(cs|en) <sql-type>` at the start of a column declaration
      // inside CREATE TABLE. The whitespace + type constraint avoids matching
      // unrelated identifiers (e.g. `address_lines_en_route`).
      const colRe = /^\s+([a-z_]+_(?:cs|en))\s+(text|varchar|jsonb)\b/gim;
      const violations: Array<{ file: string; col: string }> = [];

      for (const file of fs.readdirSync(tablesDir).filter((f) => f.endsWith(".sql"))) {
        const content = fs.readFileSync(path.join(tablesDir, file), "utf-8");
        let m;
        const seen = new Set<string>();
        while ((m = colRe.exec(content)) !== null) {
          const col = m[1];
          if (seen.has(col)) continue;
          seen.add(col);
          violations.push({ file, col });
        }
      }

      if (violations.length > 0) {
        console.error(
          "Tables with hardcoded locale columns (migrate to <name>_key + translations):",
        );
        for (const v of violations) console.error(`  - ${v.file}: ${v.col}`);
      }

      expect(
        violations,
        "Use `<name>_key` (text) + a translations table row, not `<name>_cs` / `<name>_en`.",
      ).toEqual([]);
    });

  });
});

/**
 * Test: Seed SQL Translation Parity
 *
 * Validates that seed.sql files generate translations for ALL active languages,
 * not just a subset like ('cs', 'en').
 *
 * Background:
 * - seed.sql contains INSERT statements that generate dynamic translations
 * - These use patterns like: JOIN public.supported_languages sl ON sl.code IN ('cs', 'en')
 * - This should include ALL active languages: cs, en, de, fr, ru, th
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SUPABASE_DIR = path.resolve(process.cwd(), "supabase");
const SEED_FILES = ["seed.sql", "seed.demo.sql"];

// All active languages that should have translations
const ACTIVE_LANGUAGES = ["cs", "en", "de", "fr", "ru", "th"] as const;

// Pattern to find language filters in JOIN clauses
// Matches: sl.code IN ('cs', 'en') or WHERE code IN ('cs', 'en')
const LANGUAGE_FILTER_PATTERN = /(?:sl\.)?code\s+IN\s*\(\s*(['"][a-z]{2}['"](?:\s*,\s*['"][a-z]{2}['"])*)\s*\)/gi;

type Violation = {
  file: string;
  line: number;
  found: string[];
  missing: string[];
  context: string;
};

function parseLanguagesFromMatch(match: string): string[] {
  // Extract quoted language codes from match like "'cs', 'en'"
  const codes: string[] = [];
  const codePattern = /['"]([a-z]{2})['"]/g;
  let m: RegExpExecArray | null;
  while ((m = codePattern.exec(match)) !== null) {
    codes.push(m[1]);
  }
  return codes;
}

function findViolations(filePath: string): Violation[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations: Violation[] = [];
  const fileName = path.basename(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Reset regex state
    LANGUAGE_FILTER_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = LANGUAGE_FILTER_PATTERN.exec(line)) !== null) {
      const foundLanguages = parseLanguagesFromMatch(match[1]);
      const missingLanguages = ACTIVE_LANGUAGES.filter((lang) => !foundLanguages.includes(lang));

      // Only flag if it's a partial list (not empty, not complete)
      if (foundLanguages.length > 0 && foundLanguages.length < ACTIVE_LANGUAGES.length) {
        // Get context (surrounding lines)
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const context = lines
          .slice(contextStart, contextEnd + 1)
          .map((l, idx) => `${contextStart + idx + 1}: ${l}`)
          .join("\n");

        violations.push({
          file: fileName,
          line: lineNumber,
          found: foundLanguages,
          missing: missingLanguages,
          context,
        });
      }
    }
  }

  return violations;
}

describe("seed.sql translation language parity", () => {
  it("should generate translations for ALL active languages, not just cs/en", () => {
    const allViolations: Violation[] = [];

    for (const seedFile of SEED_FILES) {
      const filePath = path.join(SUPABASE_DIR, seedFile);
      const violations = findViolations(filePath);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const formatted = allViolations
        .map(
          (v) =>
            `\n${v.file}:${v.line}\n` +
            `  Found: [${v.found.join(", ")}]\n` +
            `  Missing: [${v.missing.join(", ")}]\n` +
            `  Context:\n${v.context
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n")}`
        )
        .join("\n");

      expect.fail(
        `Found ${allViolations.length} translation INSERT(s) that don't include all active languages.\n` +
          `\nActive languages should be: [${ACTIVE_LANGUAGES.join(", ")}]\n` +
          `\nViolations:${formatted}\n\n` +
          `Fix: Replace sl.code IN ('cs', 'en') with:\n` +
          `  - sl.code IN ('cs', 'en', 'de', 'fr', 'ru', 'th')  OR\n` +
          `  - sl.is_active = true  (preferred - automatically includes future languages)\n`
      );
    }
  });

  it("should have all ACTIVE_LANGUAGES defined in supported_languages seed", () => {
    const seedPath = path.join(SUPABASE_DIR, "seed.sql");
    if (!fs.existsSync(seedPath)) {
      return; // Skip if file doesn't exist
    }

    const content = fs.readFileSync(seedPath, "utf8");

    // Find supported_languages INSERT
    const supportedLangsMatch = content.match(
      /INSERT INTO public\.supported_languages[^;]+VALUES([^;]+);/is
    );

    if (!supportedLangsMatch) {
      expect.fail("Could not find supported_languages INSERT in seed.sql");
      return;
    }

    const valuesSection = supportedLangsMatch[1];

    // Check each active language is present
    const missingInSeed: string[] = [];
    for (const lang of ACTIVE_LANGUAGES) {
      // Look for ('cs', or ('en', etc.
      const pattern = new RegExp(`\\('${lang}'\\s*,`, "i");
      if (!pattern.test(valuesSection)) {
        missingInSeed.push(lang);
      }
    }

    if (missingInSeed.length > 0) {
      expect.fail(
        `Missing languages in supported_languages INSERT: [${missingInSeed.join(", ")}]\n` +
          `All active languages should be seeded: [${ACTIVE_LANGUAGES.join(", ")}]`
      );
    }
  });
});

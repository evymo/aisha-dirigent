/**
 * Test: Seed SQL Translation Language Integrity
 *
 * Validates that translations in seed files actually contain text in the correct language,
 * not just copied English text with the wrong locale code.
 *
 * Background:
 * - Some translations were found with English text in Thai locale (e.g., "RTN Organ Preparation" for th)
 * - This test catches such issues by checking for language-specific character patterns
 *
 * Rules:
 * - Thai (th) translations should contain Thai script characters (ก-๛)
 * - Russian (ru) translations should contain Cyrillic characters (а-яА-Я)
 * - German (de) translations MAY contain umlauts or German-specific patterns
 * - French (fr) translations MAY contain accented characters
 * - Czech (cs) translations MAY contain Czech diacritics
 * - English (en) is the fallback, no special characters required
 *
 * Exceptions:
 * - Short strings like product names, URLs, brand names may be Latin-only
 * - Minimum length threshold applies (short strings are skipped)
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const TRANSLATIONS_SEED_DIR = path.resolve(process.cwd(), "aisha/db/seed/translations");

// Very short UI labels that might be the same across languages
const MIN_LENGTH_FOR_CHECK = 8;

// Language-specific character patterns
const LANGUAGE_PATTERNS: Record<string, { pattern: RegExp; description: string }> = {
  th: {
    pattern: /[\u0E00-\u0E7F]/, // Thai script range
    description: "Thai script characters (ก-๛)",
  },
  ru: {
    pattern: /[\u0400-\u04FF]/, // Cyrillic script range
    description: "Cyrillic characters (а-яА-Я)",
  },
  // Note: de, fr, cs use Latin alphabet, so we can't strictly enforce non-ASCII
  // But we CAN detect if they're just English copies
};

// Keys that are allowed to be Latin-only (brand names, short UI labels, technical identifiers)
const ALLOWED_LATIN_ONLY_KEY_PATTERNS = [
  /\.name$/, // Product/entity names may be brand names
  /\.image_alt$/, // Alt text may include brand names
  /\.circle_icon$/, // Icon names are technical identifiers (e.g., "Dumbbell", "Sparkles")
  /\.icon$/, // Icon names
  /\.slug$/, // URL slugs
];

// Values that are allowed to be Latin-only (brand names as standalone values)
// These are checked when the ENTIRE value matches (case-insensitive)
const ALLOWED_LATIN_ONLY_VALUES = [
  /^(RETISIN|LYASTIN|FLORISTEN|SILEXIL|RTN|Platform|Duo Spray|Duo Sprej)$/i,
  /^https?:\/\//, // URLs
  /^[A-Z0-9._-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, // Email addresses
  /^[A-Z][a-z]+$/, // Single capitalized word (likely icon name like "Dumbbell")
];

type Violation = {
  file: string;
  line: number;
  key: string;
  locale: string;
  value: string;
  expectedPattern: string;
};

/**
 * Parse seed SQL file and extract translation tuples
 */
function parseTranslationsFromSeedFile(filePath: string): Array<{
  line: number;
  key: string;
  locale: string;
  namespace: string;
  value: string;
}> {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const translations: Array<{
    line: number;
    key: string;
    locale: string;
    namespace: string;
    value: string;
  }> = [];

  // Pattern to match translation INSERT values:
  // ('key', 'locale', 'namespace', 'value')
  const tuplePattern = /\('([^']+)',\s*'([a-z]{2})',\s*'([^']+)',\s*'([^']*(?:''[^']*)*)'\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    let match: RegExpExecArray | null;
    tuplePattern.lastIndex = 0;

    while ((match = tuplePattern.exec(line)) !== null) {
      const [, key, locale, namespace, value] = match;
      // Unescape SQL single quotes
      const unescapedValue = value.replace(/''/g, "'");
      translations.push({
        line: lineNumber,
        key,
        locale,
        namespace,
        value: unescapedValue,
      });
    }
  }

  return translations;
}

/**
 * Check if a translation should be skipped from language integrity check.
 * Skips: short strings, brand name keys, standalone brand name values
 */
function shouldSkipTranslation(key: string, value: string): boolean {
  // Skip short strings (UI labels like "Save", "Cancel" might be same across langs)
  if (value.length < MIN_LENGTH_FOR_CHECK) {
    return true;
  }

  // Skip keys matching allowed patterns (e.g., .name, .image_alt)
  for (const pattern of ALLOWED_LATIN_ONLY_KEY_PATTERNS) {
    if (pattern.test(key)) {
      return true;
    }
  }

  // Skip values that are standalone brand names, URLs, emails
  for (const pattern of ALLOWED_LATIN_ONLY_VALUES) {
    if (pattern.test(value.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Find translations that violate language integrity
 */
function findViolations(filePath: string): Violation[] {
  const translations = parseTranslationsFromSeedFile(filePath);
  const violations: Violation[] = [];
  const fileName = path.basename(filePath);

  for (const { line, key, locale, value } of translations) {
    // Only check languages with specific character requirements
    const langPattern = LANGUAGE_PATTERNS[locale];
    if (!langPattern) continue;

    // Skip allowed translations
    if (shouldSkipTranslation(key, value)) continue;

    // Check if value contains expected characters
    if (!langPattern.pattern.test(value)) {
      violations.push({
        file: fileName,
        line,
        key,
        locale,
        value: value.length > 80 ? value.substring(0, 80) + "..." : value,
        expectedPattern: langPattern.description,
      });
    }
  }

  return violations;
}

describe("seed translations language integrity", () => {
  it("should contain language-specific characters for non-Latin scripts (th, ru)", () => {
    const allViolations: Violation[] = [];

    // Check all translation seed files
    if (fs.existsSync(TRANSLATIONS_SEED_DIR)) {
      const files = fs.readdirSync(TRANSLATIONS_SEED_DIR).filter((f) => f.endsWith(".sql"));

      for (const file of files) {
        const filePath = path.join(TRANSLATIONS_SEED_DIR, file);
        const violations = findViolations(filePath);
        allViolations.push(...violations);
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map(
          (v) =>
            `  ❌ ${v.file}:${v.line}\n` +
            `     Key: ${v.key}\n` +
            `     Locale: ${v.locale}\n` +
            `     Value: "${v.value}"\n` +
            `     Expected: ${v.expectedPattern}`
        )
        .join("\n\n");

      expect.fail(
        `Found ${allViolations.length} translation(s) with wrong language content:\n\n${report}\n\n` +
          `These translations appear to be English text stored in non-Latin locale.\n` +
          `Fix: Update the translations with proper ${[...new Set(allViolations.map((v) => v.locale))].join(", ")} text.`
      );
    }
  });

  it("should have Thai translations that contain Thai script", () => {
    // Focused test for Thai specifically
    const thaiViolations: Violation[] = [];

    if (fs.existsSync(TRANSLATIONS_SEED_DIR)) {
      const files = fs.readdirSync(TRANSLATIONS_SEED_DIR).filter((f) => f.endsWith(".sql"));

      for (const file of files) {
        const filePath = path.join(TRANSLATIONS_SEED_DIR, file);
        const translations = parseTranslationsFromSeedFile(filePath);

        for (const { line, key, locale, value } of translations) {
          if (locale !== "th") continue;
          if (shouldSkipTranslation(key, value)) continue;

          // Thai translations must contain Thai characters
          if (!/[\u0E00-\u0E7F]/.test(value)) {
            thaiViolations.push({
              file: path.basename(filePath),
              line,
              key,
              locale,
              value: value.length > 80 ? value.substring(0, 80) + "..." : value,
              expectedPattern: "Thai script (ก-๛)",
            });
          }
        }
      }
    }

    if (thaiViolations.length > 0) {
      const grouped = thaiViolations.reduce(
        (acc, v) => {
          if (!acc[v.file]) acc[v.file] = [];
          acc[v.file].push(v);
          return acc;
        },
        {} as Record<string, Violation[]>
      );

      const report = Object.entries(grouped)
        .map(([file, violations]) => {
          return `\n📄 ${file}:\n` + violations.map((v) => `  Line ${v.line}: ${v.key} = "${v.value}"`).join("\n");
        })
        .join("\n");

      expect.fail(
        `Found ${thaiViolations.length} Thai translation(s) without Thai characters:\n${report}\n\n` +
          `These appear to be English text incorrectly stored as Thai locale.`
      );
    }
  });

  it("should have Russian translations that contain Cyrillic script", () => {
    // Focused test for Russian specifically
    const russianViolations: Violation[] = [];

    if (fs.existsSync(TRANSLATIONS_SEED_DIR)) {
      const files = fs.readdirSync(TRANSLATIONS_SEED_DIR).filter((f) => f.endsWith(".sql"));

      for (const file of files) {
        const filePath = path.join(TRANSLATIONS_SEED_DIR, file);
        const translations = parseTranslationsFromSeedFile(filePath);

        for (const { line, key, locale, value } of translations) {
          if (locale !== "ru") continue;
          if (shouldSkipTranslation(key, value)) continue;

          // Russian translations must contain Cyrillic characters
          if (!/[\u0400-\u04FF]/.test(value)) {
            russianViolations.push({
              file: path.basename(filePath),
              line,
              key,
              locale,
              value: value.length > 80 ? value.substring(0, 80) + "..." : value,
              expectedPattern: "Cyrillic script (а-яА-Я)",
            });
          }
        }
      }
    }

    if (russianViolations.length > 0) {
      const report = russianViolations.map((v) => `  ${v.file}:${v.line} - ${v.key}`).join("\n");

      expect.fail(
        `Found ${russianViolations.length} Russian translation(s) without Cyrillic characters:\n${report}\n\n` +
          `These appear to be transliterated or English text incorrectly stored as Russian locale.`
      );
    }
  });
});

/**
 * Tests that all questionnaire section_key values used in DynamicQuestionnaireForm
 * have corresponding i18n translations in questionnaire.sections namespace.
 *
 * This prevents the UI from showing raw DB keys like "basic_info" instead of
 * localized labels like "Basic Information" / "Základní informace".
 *
 * @module tests/i18n/questionnaireSections
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * All known section_key values from questionnaire_blocks table.
 * Keep in sync with DB — if new section_keys appear, add them here
 * AND to all locale segments.
 */
const ALL_SECTION_KEYS = [
  "assessment",
  "basic_info",
  "compliance",
  "concerns",
  "current_state",
  "feedback",
  "feeling",
  "goals",
  "health_history",
  "intake",
  "intro",
  "lifestyle",
  "notes",
  "preferences",
  "section_a_pain",
  "section_a_vitality",
  "section_b_energy",
  "section_b_stiffness",
  "section_c_function",
  "section_c_sleep",
  "section_d_physical",
  "section_e_metabolism",
  "section_extra_pain",
  "section_f_immunity",
  "section_g_psyche",
  "section_h_cognition",
  "section_i_mood",
  "section_j_change",
  "symptoms",
  "vitals",
  "wellbeing",
] as const;

/** All supported locales */
const LOCALES = ["en", "cs", "de", "fr", "ru", "th"] as const;

/** Section icons mapping from DynamicQuestionnaireForm — must cover all section_keys */
const SECTION_ICONS_KEYS = [
  "basic_info",
  "personal",
  "health",
  "health_history",
  "current_state",
  "lifestyle",
  "symptoms",
  "medications",
  "documents",
  "preferences",
];

describe("questionnaire.sections i18n coverage", () => {
  const localeData: Record<string, Record<string, unknown>> = {};

  // Load all compiled locale files
  for (const locale of LOCALES) {
    const filePath = path.resolve(
      __dirname,
      `../../i18n/locales/${locale}.json`
    );
    const content = fs.readFileSync(filePath, "utf-8");
    localeData[locale] = JSON.parse(content) as Record<string, unknown>;
  }

  it("should have questionnaire.sections namespace in all locales", () => {
    for (const locale of LOCALES) {
      const data = localeData[locale];
      const questionnaire = data["questionnaire"] as
        | Record<string, unknown>
        | undefined;
      expect(
        questionnaire,
        `Missing "questionnaire" key in ${locale}.json`
      ).toBeDefined();
      expect(
        questionnaire?.["sections"],
        `Missing "questionnaire.sections" in ${locale}.json`
      ).toBeDefined();
    }
  });

  for (const sectionKey of ALL_SECTION_KEYS) {
    it(`should have translation for "${sectionKey}" in all locales`, () => {
      for (const locale of LOCALES) {
        const sections = (
          localeData[locale]["questionnaire"] as Record<string, unknown>
        )?.["sections"] as Record<string, string> | undefined;

        const value = sections?.[sectionKey];
        expect(
          value,
          `Missing questionnaire.sections.${sectionKey} in ${locale}.json`
        ).toBeDefined();
        expect(
          typeof value,
          `questionnaire.sections.${sectionKey} in ${locale}.json should be a string`
        ).toBe("string");
        expect(
          (value as string).length,
          `questionnaire.sections.${sectionKey} in ${locale}.json should not be empty`
        ).toBeGreaterThan(0);
      }
    });
  }

  it("should not use hardcoded fallbacks in DynamicQuestionnaireForm", () => {
    const formPath = path.resolve(
      __dirname,
      "../../components/questionnaire/DynamicQuestionnaireForm.tsx"
    );
    const formContent = fs.readFileSync(formPath, "utf-8");

    // Check there are no t() calls with fallback string for section keys
    const fallbackPattern =
      /t\(`questionnaire\.sections\.\$\{[^}]+\}`,\s*[^)]+\)/g;
    const matches = formContent.match(fallbackPattern);
    expect(
      matches,
      "Found t() with hardcoded fallback for questionnaire.sections — remove the second argument"
    ).toBeNull();
  });

  it("should have SECTION_ICONS covering known section keys used in onboarding", () => {
    // Verify the most commonly used section_keys from registration flow
    // are present in the icon mapping
    const registrationSections = [
      "basic_info",
      "current_state",
      "health_history",
      "lifestyle",
    ];

    for (const key of registrationSections) {
      expect(
        SECTION_ICONS_KEYS.includes(key),
        `Section key "${key}" used in registration should have an icon mapping`
      ).toBe(true);
    }
  });
});

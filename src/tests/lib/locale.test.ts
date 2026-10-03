import { describe, it, expect } from "vitest";
import { 
  getI18nPrimaryLocale, 
  getConsentLocale, 
  getTranslationLocale 
} from "@/lib/i18n/locale";

describe("locale utility functions", () => {
  describe("getI18nPrimaryLocale", () => {
    it("should extract primary locale from language tag", () => {
      expect(getI18nPrimaryLocale("cs-CZ")).toBe("cs");
      expect(getI18nPrimaryLocale("en-US")).toBe("en");
      expect(getI18nPrimaryLocale("de-DE")).toBe("de");
    });

    it("should handle simple locale codes", () => {
      expect(getI18nPrimaryLocale("cs")).toBe("cs");
      expect(getI18nPrimaryLocale("en")).toBe("en");
      expect(getI18nPrimaryLocale("de")).toBe("de");
    });

    it("should default to en for invalid input", () => {
      expect(getI18nPrimaryLocale(undefined)).toBe("en");
      expect(getI18nPrimaryLocale("")).toBe("en");
      expect(getI18nPrimaryLocale("   ")).toBe("en");
    });
  });

  describe("getConsentLocale", () => {
    it("should return cs for Czech", () => {
      expect(getConsentLocale("cs")).toBe("cs");
      expect(getConsentLocale("cs-CZ")).toBe("cs");
    });

    it("should return the requested locale (consents follow the translation locale)", () => {
      // Universalization removed the cs/en-only restriction — getConsentLocale
      // delegates to getTranslationLocale, so every locale passes through.
      expect(getConsentLocale("en")).toBe("en");
      expect(getConsentLocale("de")).toBe("de");
      expect(getConsentLocale("fr")).toBe("fr");
      expect(getConsentLocale("ru")).toBe("ru");
      expect(getConsentLocale("th")).toBe("th");
      // A locale we ship no CHROME bundle for still passes through: which
      // languages exist is instance data (supported_languages), and consent rows
      // are per-locale DB content. Collapsing here would make a published es/it
      // consent unreachable; the DB falls back to en per key instead.
      expect(getConsentLocale("es")).toBe("es");
    });

    it("should return en for invalid input", () => {
      expect(getConsentLocale(undefined)).toBe("en");
      expect(getConsentLocale("")).toBe("en");
    });
  });

  describe("getTranslationLocale", () => {
    it("should return exact locale for supported languages", () => {
      expect(getTranslationLocale("cs")).toBe("cs");
      expect(getTranslationLocale("en")).toBe("en");
      expect(getTranslationLocale("de")).toBe("de");
      expect(getTranslationLocale("fr")).toBe("fr");
      expect(getTranslationLocale("ru")).toBe("ru");
      expect(getTranslationLocale("th")).toBe("th");
    });

    it("should handle language tags with region", () => {
      expect(getTranslationLocale("cs-CZ")).toBe("cs");
      expect(getTranslationLocale("en-US")).toBe("en");
      expect(getTranslationLocale("de-DE")).toBe("de");
      expect(getTranslationLocale("fr-FR")).toBe("fr");
    });

    it("should pass through locales we ship no chrome bundle for", () => {
      // This used to assert "en" for all of these. The filter behind that ran
      // CLIENT-side, before the request, so it collapsed a whole language up
      // front — which made every es/it row in `translations` unreachable on an
      // instance that publishes them (e.g. an instance with cs/en/es/it/ru).
      //
      // Resolving the fallback is the DB's job and it does it PER KEY
      // (get_translation_value_with_fallback: locale → en → default), which is
      // the documented chain. A caller asking for "ja" therefore gets English
      // for every key, not an untranslated page — provided it uses a
      // *_with_fallback RPC, which every read path now does.
      expect(getTranslationLocale("es")).toBe("es");
      expect(getTranslationLocale("it")).toBe("it");
      expect(getTranslationLocale("ja")).toBe("ja");
      expect(getTranslationLocale("pl")).toBe("pl");
    });

    it("should return en for invalid input", () => {
      expect(getTranslationLocale(undefined)).toBe("en");
      expect(getTranslationLocale("")).toBe("en");
      expect(getTranslationLocale("   ")).toBe("en");
    });

    it("should be case insensitive", () => {
      expect(getTranslationLocale("CS")).toBe("cs");
      expect(getTranslationLocale("EN")).toBe("en");
      expect(getTranslationLocale("De")).toBe("de");
    });
  });

  describe("relationship between getConsentLocale and getTranslationLocale", () => {
    /**
     * After universalization, consent forms are no longer cs/en-only:
     * getConsentLocale delegates to getTranslationLocale, so both resolve to
     * the same full supported locale. This test locks in that equivalence so a
     * future divergence is caught.
     */
    it("consent locale now matches the translation locale for every supported language", () => {
      for (const lang of ["en", "cs", "de", "fr", "ru", "th"]) {
        expect(getConsentLocale(lang)).toBe(getTranslationLocale(lang));
      }
      // German user resolves to German (previously forced to en).
      expect(getConsentLocale("de")).toBe("de");
      // Russian user resolves to Russian.
      expect(getConsentLocale("ru")).toBe("ru");
      // Locales with no chrome bundle pass through on both, in lock-step.
      expect(getConsentLocale("es")).toBe(getTranslationLocale("es"));
      expect(getConsentLocale("es")).toBe("es");
    });
  });
});

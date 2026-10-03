import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  useDynamicTranslations,
  useDynamicTranslationsWithStatus,
  useTranslationsByKey,
  useUpsertTranslation,
  useUpsertTranslations,
  useDeleteTranslation,
  useDeleteTranslationsByKey,
  useDynamicT,
  useDynamicTranslationsMap,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
} from "@/hooks/useDynamicTranslations";
import { renderHookWithProviders } from "../utils/test-utils";
import { mockAdminPermissions } from '@/tests/utils/permissions';

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

// Hoisted mock for aisha.rpc and i18n
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  currentLanguage: "cs", // Mutable language for testing
}));

// Mock Supabase with hoisted rpc mock
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
  isUsingAishaDevFallback: false,
}));

// Mock useSession so hooks requiring auth context work
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id" },
    session: { access_token: "test-token" },
    isLoading: false,
  }),
}));

// i18n and aisha module mocks only (rpcUnsafe eliminated)

// Mock i18n with hoisted language reference
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return hoisted.currentLanguage;
      },
    },
  }),
}));

describe("useDynamicTranslations", () => {
  const mockTranslations = [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      key: "welcome",
      locale: "cs",
      value: "Vítejte",
      namespace: "common",
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440002",
      key: "welcome",
      locale: "en",
      value: "Welcome",
      namespace: "common",
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminPermissions();
  });

  describe("Constants", () => {
    it("should export SUPPORTED_LOCALES", () => {
      expect(SUPPORTED_LOCALES).toEqual(["en", "cs", "de", "fr", "ru", "th"]);
    });

    it("should export LOCALE_LABELS", () => {
      expect(LOCALE_LABELS).toEqual({
        en: "English",
        cs: "Čeština",
        de: "Deutsch",
        fr: "Français",
        ru: "Русский",
        th: "ไทย",
      });
    });
  });

  describe("useDynamicTranslations hook", () => {
    it("should fetch all translations when no namespace provided", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslations, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslations());

      await waitFor(() => {
        expect(result.current.translations).toEqual(mockTranslations);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations", {
        p_namespace: undefined,
      });
    });

    it("should filter by namespace when provided", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslations, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslations("common"));

      await waitFor(() => {
        expect(result.current.translations).toEqual(mockTranslations);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations", {
        p_namespace: "common",
      });
    });

    it("should return empty array when no data", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslations());

      await waitFor(() => {
        expect(result.current.translations).toEqual([]);
      });
    });

    it("should handle errors", async () => {
      const mockError = new Error("Database error");
      hoisted.rpcMock.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHookWithProviders(() => useDynamicTranslations());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDynamicTranslationsWithStatus hook", () => {
    const mockTranslationsWithStatus = [
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        key: "hero.slide1.title",
        locale: "cs",
        value: "Hlavní titulek",
        namespace: "hero",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        source_updated_at: "2024-01-01",
        is_stale: false,
        is_missing: false,
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440002",
        key: "hero.slide1.title",
        locale: "en",
        value: "Main Title",
        namespace: "hero",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        source_updated_at: "2024-01-01",
        is_stale: false,
        is_missing: false,
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440003",
        key: "hero.slide1.subtitle",
        locale: "cs",
        value: "Podtitulek",
        namespace: "hero",
        created_at: "2024-01-01",
        updated_at: "2024-01-02",
        source_updated_at: "2024-01-02",
        is_stale: false,
        is_missing: false,
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440004",
        key: "hero.slide1.subtitle",
        locale: "en",
        value: "",
        namespace: "hero",
        created_at: "2024-01-02",
        updated_at: "2024-01-02",
        source_updated_at: "2024-01-02",
        is_stale: false,
        is_missing: true,
      },
    ];

    it("should fetch translations with status for given namespace", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslationsWithStatus, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslationsWithStatus("hero"));

      await waitFor(() => {
        expect(result.current.translations).toEqual(mockTranslationsWithStatus);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_with_status", {
        p_namespace: "hero",
      });
    });

    it("should fetch all translations with status when no namespace provided", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslationsWithStatus, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslationsWithStatus());

      await waitFor(() => {
        expect(result.current.translations).toEqual(mockTranslationsWithStatus);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_with_status", {
        p_namespace: undefined,
      });
    });

    it("should return is_missing and is_stale flags", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslationsWithStatus, error: null });

      const { result } = renderHookWithProviders(() => useDynamicTranslationsWithStatus("hero"));

      await waitFor(() => {
        expect(result.current.translations.length).toBeGreaterThan(0);
      });

      // Check that we have a missing translation
      const missingTranslation = result.current.translations.find(t => t.is_missing);
      expect(missingTranslation).toBeDefined();
      expect(missingTranslation?.key).toBe("hero.slide1.subtitle");
      expect(missingTranslation?.locale).toBe("en");
    });

    it("should handle errors", async () => {
      const mockError = new Error("Database error");
      hoisted.rpcMock.mockResolvedValue({ data: null, error: mockError });

      const { result } = renderHookWithProviders(() => useDynamicTranslationsWithStatus("hero"));

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useTranslationsByKey hook", () => {
    it("should fetch translations for specific key", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslations, error: null });

      const { result } = renderHookWithProviders(() => useTranslationsByKey("welcome", "common"));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockTranslations);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_by_key", {
        p_key: "welcome",
        p_namespace: "common",
      });
    });

    it("should use default namespace 'questionnaires'", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHookWithProviders(() => useTranslationsByKey("test"));

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_by_key", {
          p_key: "test",
          p_namespace: "questionnaires",
        });
      });
    });
  });

  describe("useUpsertTranslation hook", () => {
    it("should upsert single translation via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [mockTranslations[0]], 
        error: null 
      });

      const { result } = renderHookWithProviders(() => useUpsertTranslation());

      const input = {
        key: "welcome",
        locale: "cs",
        value: "Vítejte",
        namespace: "common",
      };

      result.current.mutate(input);

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("upsert_translation", {
          p_key: "welcome",
          p_locale: "cs",
          p_value: "Vítejte",
          p_namespace: "common",
        });
      });
    });

    it("should use default namespace 'questionnaires' if not provided", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [mockTranslations[0]], 
        error: null 
      });

      const { result } = renderHookWithProviders(() => useUpsertTranslation());

      const input = {
        key: "test",
        locale: "cs",
        value: "Test",
      };

      result.current.mutate(input);

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("upsert_translation", {
          p_key: "test",
          p_locale: "cs",
          p_value: "Test",
          p_namespace: "questionnaires",
        });
      });
    });

    it("should throw error when upsert returns empty result", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [], 
        error: null 
      });

      const { result } = renderHookWithProviders(() => useUpsertTranslation());

      result.current.mutate({
        key: "test",
        locale: "cs",
        value: "Test",
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useUpsertTranslations hook", () => {
    it("should upsert multiple translations via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslations, error: null });

      const { result } = renderHookWithProviders(() => useUpsertTranslations());

      const inputs = [
        { key: "welcome", locale: "cs", value: "Vítejte", namespace: "common" },
        { key: "welcome", locale: "en", value: "Welcome", namespace: "common" },
      ];

      result.current.mutate(inputs);

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("upsert_translations", {
          p_translations: [
            { key: "welcome", locale: "cs", value: "Vítejte", namespace: "common" },
            { key: "welcome", locale: "en", value: "Welcome", namespace: "common" },
          ],
        });
      });
    });

    it("should use default namespace 'questionnaires' for items without namespace", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: mockTranslations, error: null });

      const { result } = renderHookWithProviders(() => useUpsertTranslations());

      const inputs = [
        { key: "test1", locale: "cs", value: "Test1" },
        { key: "test2", locale: "en", value: "Test2" },
      ];

      result.current.mutate(inputs);

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("upsert_translations", {
          p_translations: [
            { key: "test1", locale: "cs", value: "Test1", namespace: "questionnaires" },
            { key: "test2", locale: "en", value: "Test2", namespace: "questionnaires" },
          ],
        });
      });
    });
  });

  describe("useDeleteTranslation hook", () => {
    it("should delete translation by id via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ error: null });

      const { result } = renderHookWithProviders(() => useDeleteTranslation());

      result.current.mutate("test-id");

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("delete_translation_admin", {
          p_id: "test-id",
        });
      });
    });

    it("should handle delete error", async () => {
      const mockError = new Error("Delete failed");
      hoisted.rpcMock.mockResolvedValue({ error: mockError });

      const { result } = renderHookWithProviders(() => useDeleteTranslation());

      result.current.mutate("test-id");

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDeleteTranslationsByKey hook", () => {
    it("should delete translations by key via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ error: null });

      const { result } = renderHookWithProviders(() => useDeleteTranslationsByKey());

      result.current.mutate({ key: "welcome" });

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("delete_translations_by_key_admin", {
          p_key: "welcome",
          p_namespace: undefined,
        });
      });
    });

    it("should pass namespace when provided via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ error: null });

      const { result } = renderHookWithProviders(() => useDeleteTranslationsByKey());

      result.current.mutate({ key: "welcome", namespace: "common" });

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("delete_translations_by_key_admin", {
          p_key: "welcome",
          p_namespace: "common",
        });
      });
    });

    it("should handle delete by key error", async () => {
      const mockError = new Error("Delete by key failed");
      hoisted.rpcMock.mockResolvedValue({ error: mockError });

      const { result } = renderHookWithProviders(() => useDeleteTranslationsByKey());

      result.current.mutate({ key: "welcome" });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDynamicT hook", () => {
    it("should fetch translated value for current locale via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: "Vítejte", 
        error: null 
      });

      const { result } = renderHookWithProviders(() => useDynamicT("welcome", "common"));

      await waitFor(() => {
        expect(result.current).toBe("Vítejte");
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translation_value", {
        p_key: "welcome",
        p_namespace: "common",
        p_locale: "cs",
      });
    });

    it("should return key as fallback when no translation found", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: null, 
        error: null 
      });

      const { result } = renderHookWithProviders(() => useDynamicT("unknown_key"));

      await waitFor(() => {
        expect(result.current).toBe("unknown_key");
      });
    });

    it("should use default namespace 'questionnaires'", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: null, 
        error: null 
      });

      renderHookWithProviders(() => useDynamicT("test"));

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translation_value", {
          p_key: "test",
          p_namespace: "questionnaires",
          p_locale: "cs",
        });
      });
    });
  });

  describe("useDynamicTranslationsMap hook", () => {
    it("should fetch multiple translations at once via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [
          { key: "welcome", value: "Vítejte" },
          { key: "goodbye", value: "Sbohem" },
        ], 
        error: null 
      });

      const { result } = renderHookWithProviders(() => 
        useDynamicTranslationsMap(["welcome", "goodbye"], "common")
      );

      await waitFor(() => {
        expect(result.current).toEqual({
          welcome: "Vítejte",
          goodbye: "Sbohem",
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_map", {
        p_keys: ["welcome", "goodbye"],
        p_locale: "cs",
        p_namespace: "common",
      });
    });

    it("should return empty object when keys array is empty", () => {
      const { result } = renderHookWithProviders(() => 
        useDynamicTranslationsMap([])
      );

      expect(result.current).toEqual({});
    });

    it("should not fetch when keys array is empty", () => {
      renderHookWithProviders(() => useDynamicTranslationsMap([]));

      // Should not call RPC when keys is empty (enabled: false)
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it("should use default namespace 'questionnaires'", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [{ key: "test", value: "Test" }], 
        error: null 
      });

      renderHookWithProviders(() => useDynamicTranslationsMap(["test"]));

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_map", {
          p_keys: ["test"],
          p_locale: "cs",
          p_namespace: "questionnaires",
        });
      });
    });

    it("should handle null data from RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: null, 
        error: null 
      });

      const { result } = renderHookWithProviders(() => 
        useDynamicTranslationsMap(["test"])
      );

      await waitFor(() => {
        expect(result.current).toEqual({});
      });
    });

    it("should use studies namespace for study translations", async () => {
      hoisted.rpcMock.mockResolvedValue({ 
        data: [
          { key: "RII-COM-001.description", value: "Otevřený komunitní program" },
          { key: "RII-COM-001.name", value: "Komunitní wellness program" },
        ], 
        error: null 
      });

      const { result } = renderHookWithProviders(() => 
        useDynamicTranslationsMap(
          ["RII-COM-001.description", "RII-COM-001.name"], 
          "studies"
        )
      );

      await waitFor(() => {
        expect(result.current).toEqual({
          "RII-COM-001.description": "Otevřený komunitní program",
          "RII-COM-001.name": "Komunitní wellness program",
        });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_translations_map", {
        p_keys: ["RII-COM-001.description", "RII-COM-001.name"],
        p_locale: "cs",
        p_namespace: "studies",
      });
    });

    it("should return translations for all study codes when keys match DB format", async () => {
      // This test verifies that getStudyText fallback (${code}.description) works correctly
      const studyKeys = [
        "RII-OBS-001.name",
        "RII-OBS-001.description",
        "RII-COM-001.name", 
        "RII-COM-001.description",
      ];

      hoisted.rpcMock.mockResolvedValue({
        data: studyKeys.map(key => ({
          key,
          value: `Translated: ${key}`,
        })),
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useDynamicTranslationsMap(studyKeys, "studies")
      );

      await waitFor(() => {
        expect(Object.keys(result.current)).toHaveLength(4);
        expect(result.current["RII-COM-001.description"]).toBe("Translated: RII-COM-001.description");
      });
    });

    it("should use getTranslationLocale for all 6 supported languages (not getConsentLocale)", async () => {
      /**
       * CRITICAL: This test ensures that useDynamicTranslationsMap uses getTranslationLocale
       * which supports all 6 languages (cs, en, de, fr, ru, th), NOT getConsentLocale 
       * which only supports cs/en.
       * 
       * Bug scenario this prevents:
       * - German user visits Studies page
       * - getConsentLocale("de") returns "en" (wrong!)
       * - User sees English fallback instead of German translation
       * 
       * With getTranslationLocale("de") => "de", user gets German translation.
       */
      
      // Mock German user
      hoisted.currentLanguage = "de";

      hoisted.rpcMock.mockResolvedValue({
        data: [{ key: "test.key", value: "German translation" }],
        error: null,
      });

      renderHookWithProviders(() =>
        useDynamicTranslationsMap(["test.key"], "studies")
      );

      await waitFor(() => {
        // Verify RPC was called with German locale, NOT English
        expect(hoisted.rpcMock).toHaveBeenCalledWith(
          "get_translations_map",
          expect.objectContaining({
            p_locale: "de", // getTranslationLocale returns "de"
          })
        );
      });

      // Reset for other tests
      hoisted.currentLanguage = "cs";
    });

    it.each(["cs", "en", "de", "fr", "ru", "th"] as const)(
      "should pass %s locale to RPC when user language is %s",
      async (lang) => {
        hoisted.currentLanguage = lang;
        hoisted.rpcMock.mockClear();
        hoisted.rpcMock.mockResolvedValue({
          data: [{ key: "product.name", value: `${lang} value` }],
          error: null,
        });

        renderHookWithProviders(() =>
          useDynamicTranslationsMap(["product.name"], "products")
        );

        await waitFor(() => {
          expect(hoisted.rpcMock).toHaveBeenCalledWith(
            "get_translations_map",
            expect.objectContaining({ p_locale: lang })
          );
        });

        // Reset
        hoisted.currentLanguage = "cs";
      }
    );
  });
});


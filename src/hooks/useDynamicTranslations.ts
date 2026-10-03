import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useTranslation } from "react-i18next";
import { parseRpcArray, translationMapEntrySchema, translationWithStatusSchema, translationSchema } from "@/lib/validation/rpcSchemas";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { useSession } from "@/hooks/useSession";

import type { TranslationValidated } from "@/lib/validation/rpcSchemas";

/**
 * Represents a translation record.
 * Re-exported from validation schemas for convenience.
 */
export type Translation = TranslationValidated;

export interface TranslationWithStatus extends Translation {
  source_updated_at: string | null;
  is_stale: boolean;
  is_missing: boolean;
}

export interface TranslationInput {
  key: string;
  locale: string;
  value: string;
  namespace?: string;
}

// Re-exported from leaf module to avoid TDZ when this hook participates in
// chunk-cycle init paths. Live bindings (`export { X } from './Y'`) are
// TDZ-safe because they don't introduce a local binding in this module —
// rollup/vite preserves the original definition site. See
// src/lib/i18n/supportedLocales.ts for full rationale.
export {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  type SupportedLocale,
  type LocaleCode,
} from "@/lib/i18n/supportedLocales";


// Local imports for in-file use as VALUES (SUPPORTED_LOCALES iteration) and
// TYPES (SupportedLocale annotations on function params + `as` casts). The
// pure-re-export above doesn't create a local binding, so without these
// imports every in-file reference reports TS2304 "cannot find name". This
// is the only TS-correct way to expose a symbol re-exported through a
// TDZ-safe `export { … } from "…"` while also using it inside the module.
import type {
  SupportedLocale as SupportedLocaleLocal,
  LocaleCode as LocaleCodeLocal,
} from "@/lib/i18n/supportedLocales";
import { SUPPORTED_LOCALES as SUPPORTED_LOCALES_LOCAL } from "@/lib/i18n/supportedLocales";
// Lokální aliasy zrcadlí veřejné re-exporty: `export … from` je průchozí vazba
// a lokální jméno NEZAVÁDÍ, takže bez tohohle by každá zdejší reference hlásila
// TS2304. Aliasování zachovává TDZ-bezpečnost živé vazby.
type SupportedLocale = SupportedLocaleLocal;
type LocaleCode = LocaleCodeLocal;
const SUPPORTED_LOCALES = SUPPORTED_LOCALES_LOCAL;

/**
 * Hook to fetch all translations for a given namespace.
 *
 * @param namespace - Optional namespace to filter translations.
 * @returns Query object containing list of translations.
 */
export function useDynamicTranslations(namespace?: string) {
  const query = useQuery({
    queryKey: ["translations", namespace],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_translations", {
        p_namespace: namespace,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(translationSchema, data, "get_translations");
    },
  });

  return {
    ...query,
    translations: query.data ?? [],
  };
}

/**
 * Hook to fetch translations with status flags (stale, missing) for admin filtering.
 *
 * @param namespace - Optional namespace to filter translations.
 * @returns Query object containing list of translations with status.
 */
export function useDynamicTranslationsWithStatus(namespace?: string) {
  const { user } = useSession();
  const query = useQuery({
    queryKey: ["translations-with-status", namespace],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_translations_with_status", {
        p_namespace: namespace ?? undefined,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(translationWithStatusSchema, data, "get_translations_with_status");
    },
  });

  return {
    ...query,
    translations: query.data ?? [],
  };
}

/**
 * Hook to fetch translations for a specific key.
 *
 * @param key - The translation key.
 * @param namespace - The namespace (default: "questionnaires").
 * @returns Query object containing list of translations for the key.
 */
export function useTranslationsByKey(key: string, namespace: string = "questionnaires") {
  return useQuery({
    queryKey: ["translations", namespace, key],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_translations_by_key", {
        p_key: key,
        p_namespace: namespace,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(translationSchema, data, "get_translations_by_key");
    },
  });
}

/**
 * Hook to upsert a single translation.
 *
 * @returns Mutation object for upserting a translation.
 */
export function useUpsertTranslation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TranslationInput) => {
      const { data, error } = await aisha.rpc("upsert_translation", {
        p_key: input.key,
        p_locale: input.locale,
        p_namespace: input.namespace ?? "questionnaires"
,
        p_value: input.value
    });
      if (error) throw new Error(error.message);
      const result = parseRpcArray(translationSchema, data, "upsert_translation");
      if (result.length === 0) throw new Error("Failed to upsert translation");
      return result[0];
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["translations"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t", variables.key] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t-map"] });
      queryClient.invalidateQueries({ queryKey: ["translations-with-status"] });
    },
  });
}

/**
 * Hook to upsert multiple translations at once.
 *
 * @returns Mutation object for upserting multiple translations.
 */
export function useUpsertTranslations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inputs: TranslationInput[]) => {
      const translationsPayload = inputs.map((input) => ({
        key: input.key,
        locale: input.locale,
        value: input.value,
        namespace: input.namespace ?? "questionnaires",
      }));

      const { data, error } = await aisha.rpc("upsert_translations", {
        p_translations: translationsPayload,
      });
      if (error) throw new Error(error.message);
      return parseRpcArray(translationSchema, data, "upsert_translations");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translations"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t-map"] });
      queryClient.invalidateQueries({ queryKey: ["translations-with-status"] });
    },
  });
}

/**
 * Hook to delete a translation by ID.
 *
 * @returns Mutation object for deleting a translation.
 */
export function useDeleteTranslation() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_translation_admin", async (id: string) => {
      // Use RPC instead of direct table access
      const { error } = await aisha.rpc("delete_translation_admin", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translations"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t-map"] });
      queryClient.invalidateQueries({ queryKey: ["translations-with-status"] });
    },
  });
}

/**
 * Hook to delete all translations for a specific key.
 *
 * @returns Mutation object for deleting translations by key.
 */
export function useDeleteTranslationsByKey() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_translations_by_key_admin", async ({ key, namespace }: { key: string; namespace?: string }) => {
      // Use RPC instead of direct table access
      const { error } = await aisha.rpc("delete_translations_by_key_admin", {
        p_key: key,
        p_namespace: namespace,
      });
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translations"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t"] });
      queryClient.invalidateQueries({ queryKey: ["dynamic-t-map"] });
      queryClient.invalidateQueries({ queryKey: ["translations-with-status"] });
    },
  });
}

/**
 * Hook to get a single translated value with optional fallback.
 *
 * @param key - The translation key.
 * @param namespace - The namespace (default: "questionnaires").
 * @param fallbackLocale - Optional fallback locale.
 * @returns The translated string or the key if not found.
 */
export function useDynamicT(
  key: string,
  namespace: string = "questionnaires",
  fallbackLocale?: SupportedLocale
) {
  const { i18n } = useTranslation();
  // Use getTranslationLocale for dynamic translations (supports all locales)
  const currentLocale = getTranslationLocale(i18n.language);

  const { data: translations } = useQuery({
    queryKey: ["dynamic-t", key, namespace, currentLocale, fallbackLocale],
    queryFn: async () => {
      const { data, error } = fallbackLocale
        ? await aisha.rpc("get_translation_value_with_fallback", {
            p_fallback_locale: fallbackLocale
,
            p_key: key,
            p_locale: currentLocale,
            p_namespace: namespace
    })
        : await aisha.rpc("get_translation_value", {
            p_key: key,
            p_locale: currentLocale
,
            p_namespace: namespace
    });
      if (error) throw new Error(error.message);

      // React Query warning: queryFn must not return `undefined`.
      // When RPC returns null (translation missing), fall back to the key.
      return (data as string | null) ?? key;
    },
  });

  return translations ?? key;
}

/**
 * Bulk hook to resolve multiple translation keys in one round-trip.
 *
 * The `namespace` argument is overloaded:
 *
 *   - `string`  — strict single-namespace lookup (default = "questionnaires"
 *     for backward compatibility with existing call sites that knew the
 *     batch all lived in one namespace, e.g. an admin questionnaire form).
 *
 *   - `null`    — opt-in to the per-key namespace inference mode added in
 *     the DB migration `20260525130000_translations_rpc_namespace_inference`.
 *     Each key's namespace is derived from its first dot-segment, so a
 *     heterogeneous batch (several namespaces in one canvas) all
 *     resolve correctly in one call. Use this for content-driven surfaces
 *     where the key list is assembled from authored HTML/markup, not from
 *     a single namespace-aware UI section. PageRenderer is the canonical
 *     consumer.
 */
export function useDynamicTranslationsMap(
  keys: string[],
  namespace: string | null = "questionnaires",
  fallbackLocale?: SupportedLocale
) {
  const { i18n } = useTranslation();
  const currentLocale = getTranslationLocale(i18n.language);

  const { data } = useQuery({
    // Cache key includes `namespace ?? "__derive__"` so the null-mode result
    // doesn't collide with an explicit-namespace fetch for the same keys.
    queryKey: ["dynamic-t-map", keys.join(","), namespace ?? "__derive__", currentLocale, fallbackLocale],
    staleTime: 10 * 60 * 1000, // 10 minutes - translations are stable
    gcTime: 60 * 60 * 1000, // 60 minutes
    placeholderData: (prev) => prev, // Keep previous data during refetch
    queryFn: async () => {
      if (keys.length === 0) return {};
      const rpcName = fallbackLocale ? "get_translations_map_with_fallback" : "get_translations_map";
      // `p_namespace` PŘIJÍMÁ NULL: obě RPC mají v těle
      // COALESCE(p_namespace, split_part(k.key, '.', 1)), takže NULL znamená
      // „odvoď jmenný prostor z prefixu každého klíče" (heterogenní dávka).
      //
      // Generované typy to ale říct NEUMÍ. postgres-meta hlásí typ argumentu
      // (`text`), a SQL u skalárního parametru nullability nevyjadřuje — každý
      // smí dostat NULL. Typ proto vyjde jako `string`, ač je `string | null`.
      //
      // Deklarovat to přes DEFAULT NULL v SoT nejde: u get_translations_map
      // stojí za p_namespace ještě p_locale bez defaultu a PostgreSQL zakazuje
      // parametr bez defaultu za parametrem s defaultem. Přeskládat parametry
      // by rozbilo CREATE OR REPLACE při upgradu (třída „přejmenování/přesun
      // parametru rozbije upgrade"). Proto se to řeší TADY, úzce a nahlas.
      const namespaceParam = namespace as unknown as string;
      const { data, error } = fallbackLocale
        ? await aisha.rpc("get_translations_map_with_fallback", {
            p_fallback_locale: fallbackLocale,
            p_keys: keys,
            p_locale: currentLocale,
            p_namespace: namespaceParam,
          })
        : await aisha.rpc("get_translations_map", {
            p_keys: keys,
            p_locale: currentLocale,
            p_namespace: namespaceParam,
          });
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      parseRpcArray(translationMapEntrySchema, data, rpcName).forEach((entry) => {
        map[entry.key] = entry.value;
      });
      return map;
    },
    enabled: keys.length > 0,
  });

  return data ?? {};
}

/**
 * Hook to fetch translations for multiple keys across ALL supported locales.
 * Returns a Map<key, Map<locale, value>> for admin editing.
 *
 * @param keys - Translation keys to fetch
 * @param namespace - Translation namespace
 * @returns Map of key → Map of locale → translated value
 *
 * @example
 * const translationsMap = useDynamicTranslationsMultiLocale(["featured.slug.title"], "featured");
 * const csTitle = translationsMap.get("featured.slug.title")?.get("cs") ?? "";
 */
export function useDynamicTranslationsMultiLocale(
  keys: string[],
  namespace: string
): Map<string, Map<LocaleCode, string>> {
  const { data } = useQuery({
    queryKey: ["dynamic-t-multi-locale", keys.join(","), namespace],
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (keys.length === 0) return new Map<string, Map<LocaleCode, string>>();

      const { data: rows, error } = await aisha.rpc("get_translations_for_keys", {
        p_keys: keys,
        p_namespace: namespace,
      });
      if (error) throw new Error(error.message);

      const map = new Map<string, Map<LocaleCode, string>>();
      const rawRows = (rows ?? []) as Array<{ key: string; locale: string; value: string }>;
      for (const row of rawRows) {
        if (!(SUPPORTED_LOCALES as readonly string[]).includes(row.locale)) continue;
        let localeMap = map.get(row.key);
        if (!localeMap) {
          localeMap = new Map<LocaleCode, string>();
          map.set(row.key, localeMap);
        }
        localeMap.set(row.locale, row.value);
      }
      return map;
    },
    enabled: keys.length > 0,
  });

  return data ?? new Map<string, Map<LocaleCode, string>>();
}

/**
 * Represents a translation entry fetched by key.
 */
export interface TranslationForKey {
  key: string;
  locale: SupportedLocale;
  value: string;
}

/**
 * Hook to fetch translations for multiple keys in a specific namespace.
 * Returns a mutation that can be called imperatively when translations are needed.
 *
 * @returns Mutation for fetching translations by keys
 *
 * @example
 * const { mutateAsync: fetchTranslations } = useFetchTranslationsForKeys();
 * const translations = await fetchTranslations({ keys: ['key1', 'key2'], namespace: 'hero' });
 */
export function useFetchTranslationsForKeys() {
  return useMutation({
    mutationFn: async ({
      keys,
      namespace,
    }: {
      keys: string[];
      namespace: string;
    }): Promise<TranslationForKey[]> => {
      if (keys.length === 0) return [];

      const { data, error } = await aisha.rpc("get_translations_for_keys", {
        p_keys: keys,
        p_namespace: namespace,
      });
      if (error) throw new Error(error.message);

      // Validate and filter to supported locales
      const rows = (data ?? []) as Array<{ key: string; locale: string; value: string }>;
      return rows
        .filter((row): row is TranslationForKey =>
          (SUPPORTED_LOCALES as readonly string[]).includes(row.locale)
        )
        .map((row) => ({
          key: row.key,
          locale: row.locale,
          value: row.value,
        }));
    },
  });
}

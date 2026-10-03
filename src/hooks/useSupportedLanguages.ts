import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";

/**
 * Represents a supported language in the application.
 */
export interface SupportedLanguage {
  code: string;
  name_native: string;
  name_key: string;
  is_active: boolean | null;
  is_default: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Hook to fetch supported languages.
 *
 * @param activeOnly - If true, returns only active languages. If false, returns all languages (requires admin privileges).
 * @returns Query object containing the list of supported languages.
 */
/**
 * Query options for supported languages
 */
export const supportedLanguagesQueryOptions = (activeOnly = true) => ({
  queryKey: ["supported-languages", activeOnly],
  queryFn: async () => {
    // RPC-only: explicit calls for proper typing
    if (activeOnly) {
      const { data, error } = await aisha.rpc("get_supported_languages");
      if (error) throw new Error(error.message);
      return data ?? [];
    } else {
      const { data, error } = await aisha.rpc("get_all_supported_languages");
      if (!error) return data ?? [];

      // Non-admin users may hit this path (e.g. if a component requests "all" languages)
      // - Prefer a safe fallback to the public list instead of surfacing a hard failure.
      const status = (error as unknown as { status?: number }).status;
      if (status === 403) {
        const { data: fallbackData, error: fallbackError } = await aisha.rpc(
          "get_supported_languages"
        );
        if (fallbackError) throw fallbackError;
        return fallbackData ?? [];
      }

      throw new Error(error.message);
    }
  },
} as const);

/**
 * Hook to fetch supported languages.
 *
 * @param activeOnly - If true, returns only active languages. If false, returns all languages (requires admin privileges).
 * @returns Query object containing the list of supported languages.
 */
export function useSupportedLanguages(activeOnly = true) {
  return useQuery(supportedLanguagesQueryOptions(activeOnly));
}

/**
 * Hook to create a new supported language (admin only).
 *
 * @returns Mutation object for creating a language.
 */
export function useCreateLanguage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<SupportedLanguage, "created_at" | "updated_at">) => {
      // RPC-only: use create_supported_language function
      // Convert null to undefined for optional RPC parameters
      const isActive = input.is_active != null ? input.is_active : undefined;
      const isDefault = input.is_default != null ? input.is_default : undefined;
      const sortOrder = input.sort_order != null ? input.sort_order : undefined;

      const { data, error } = await aisha.rpc("create_supported_language", {
        p_code: input.code,
        p_is_active: isActive,
        p_is_default: isDefault,
        p_name_key: input.name_key,
        p_name_native: input.name_native,
        p_sort_order: sortOrder

      });
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supported-languages"] });
    },
  });
}

/**
 * Hook to update an existing supported language (admin only).
 *
 * @returns Mutation object for updating a language.
 */
export function useUpdateLanguage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ code, ...updates }: Partial<SupportedLanguage> & { code: string }) => {
      // RPC-only: use update_supported_language function
      // Convert null to undefined for optional RPC parameters
      const isActive = updates.is_active != null ? updates.is_active : undefined;
      const isDefault = updates.is_default != null ? updates.is_default : undefined;
      const sortOrder = updates.sort_order != null ? updates.sort_order : undefined;

      const { data, error } = await aisha.rpc("update_supported_language", {
        p_code: code,
        p_is_active: isActive,
        p_is_default: isDefault,
        p_name_key: updates.name_key,
        p_name_native: updates.name_native,
        p_sort_order: sortOrder

      });
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supported-languages"] });
    },
  });
}

/**
 * Hook to delete a supported language (admin only).
 *
 * @returns Mutation object for deleting a language.
 */
export function useDeleteLanguage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      // RPC-only: use delete_supported_language function
      const { error } = await aisha.rpc("delete_supported_language", {
        p_code: code,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supported-languages"] });
    },
  });
}

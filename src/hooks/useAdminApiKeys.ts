/**
 * Hooks for admin API key management.
 *
 * Provides query and mutation hooks for fetching API key status
 * and saving API keys via RPC.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Represents the status of a single API key.
 */
export interface ApiKeyStatus {
  key: string;
  isSet: boolean;
  updatedAt: string | null;
  maskedValue: string | null;
}

/**
 * Hook to fetch the status of all managed API keys.
 *
 * @returns Query state with a map of key name → status.
 */
export function useAllApiKeyStatus() {
  return useQuery({
    queryKey: ["admin", "all-api-keys-status"],
    queryFn: async (): Promise<Record<string, ApiKeyStatus>> => {
      const { data, error } = await aisha.rpc("get_api_keys_status_admin");

      if (error) {
        safeError("admin.apiKeys.statusFailed", error as Error);
        throw new Error(error.message);
      }

      // Parse response into status map with type guards
      const statusMap: Record<string, ApiKeyStatus> = {};
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item === "object" && "key_name" in item) {
            const record = item as Record<string, unknown>;
            const keyName = String(record.key_name ?? "");
            statusMap[keyName] = {
              key: keyName,
              isSet: Boolean(record.is_set),
              maskedValue: record.masked_value ? String(record.masked_value) : null,
              updatedAt: record.updated_at ? String(record.updated_at) : null,
            };
          }
        }
      }

      return statusMap;
    },
  });
}

/**
 * Hook to save (set) an API key value.
 *
 * @returns Mutation for saving an API key.
 */
export function useSaveApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ keyName, value }: { keyName: string; value: string }): Promise<void> => {
      const { error } = await aisha.rpc("set_api_key_admin", {
        p_key_name: keyName,
        p_key_value: value,
      });

      if (error) {
        safeError("admin.apiKeys.saveFailed", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "all-api-keys-status"] });
    },
  });
}

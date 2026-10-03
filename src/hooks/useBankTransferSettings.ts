import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const fioBankSettingsSchema = z.object({
  check_interval_minutes: z.number().min(5).max(1440),
  enabled: z.boolean(),
});

/**
 * Fio Bank integration settings stored in system_config.
 */
export type FioBankSettingsConfig = z.infer<typeof fioBankSettingsSchema>;

export const DEFAULT_FIO_BANK_SETTINGS: FioBankSettingsConfig = {
  check_interval_minutes: 30,
  enabled: false,
};

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function normalizeFioBankSettings(raw: unknown): FioBankSettingsConfig {
  const parsed = fioBankSettingsSchema.partial().safeParse(raw);
  if (parsed.success) {
    return { ...DEFAULT_FIO_BANK_SETTINGS, ...parsed.data };
  }
  return DEFAULT_FIO_BANK_SETTINGS;
}

// ---------------------------------------------------------------------------
// Bank Transfer Setup Hook
// ---------------------------------------------------------------------------

/**
 * Result of setting up bank transfer for an order.
 */
export interface BankTransferSetupResult {
  amount: number;
  bic: string;
  currency: string;
  due_date: string;
  iban: string;
  ok: boolean;
  variable_symbol: string;
}

const bankTransferResultSchema = z.object({
  amount: z.number(),
  bic: z.string(),
  currency: z.string(),
  due_date: z.string(),
  iban: z.string(),
  ok: z.boolean(),
  variable_symbol: z.string(),
});

function normalizeBankTransferResult(raw: unknown): BankTransferSetupResult | null {
  const parsed = bankTransferResultSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch Fio Bank settings from system_config.
 *
 * @returns Query with Fio Bank configuration.
 */
export function useFioBankSettingsConfig() {
  return useQuery({
    queryKey: ["system-config", "fio_bank"],
    queryFn: async (): Promise<FioBankSettingsConfig> => {
      try {
        const { data, error } = await aisha.rpc("get_system_config", {
          p_key: "fio_bank",
        });

        if (error) {
          safeError("fioBankSettings.fetch", error);
          return DEFAULT_FIO_BANK_SETTINGS;
        }

        return normalizeFioBankSettings(data);
      } catch (err) {
        safeError("fioBankSettings.fetch", err);
        return DEFAULT_FIO_BANK_SETTINGS;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Update Fio Bank settings via admin RPC.
 *
 * @returns Mutation for updating Fio Bank configuration.
 */
export function useUpdateFioBankSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: FioBankSettingsConfig): Promise<void> => {
      const { error } = await aisha.rpc("set_system_config_admin", {
        p_category: "commerce",
        p_description: "Fio banka API reconciliation settings",
        p_is_public: false,
        p_key: "fio_bank",
        p_value: config,
      });

      if (error) {
        safeError("fioBankSettings.update", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["system-config", "fio_bank"],
      });
    },
  });
}

/**
 * Setup bank transfer for an order. Generates variable symbol, sets IBAN and due date.
 *
 * @returns Mutation for setting up bank transfer on an order.
 */
export function useSetupBankTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string): Promise<BankTransferSetupResult> => {
      const { data, error } = await aisha.rpc(
        "setup_bank_transfer_for_order",
        { p_order_id: orderId }
      );

      if (error) {
        safeError("bankTransfer.setup", error as Error);
        throw new Error(error.message);
      }

      const result = normalizeBankTransferResult(data);
      if (!result) {
        throw new Error("Invalid bank transfer setup response");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}

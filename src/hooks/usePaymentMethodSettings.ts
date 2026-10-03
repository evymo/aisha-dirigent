import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const paymentMethodsSchema = z.object({
  bank_transfer_due_days: z.number().min(1).max(90),
  bank_transfer_enabled: z.boolean(),
  card_enabled: z.boolean(),
  default_method: z.enum(["bank_transfer", "card"]),
});

/**
 * Payment method configuration stored in system_config.
 */
export type PaymentMethodsConfig = z.infer<typeof paymentMethodsSchema>;

export const DEFAULT_PAYMENT_METHODS: PaymentMethodsConfig = {
  bank_transfer_due_days: 7,
  bank_transfer_enabled: true,
  card_enabled: true,
  default_method: "bank_transfer",
};

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function normalizePaymentMethods(raw: unknown): PaymentMethodsConfig {
  const parsed = paymentMethodsSchema.partial().safeParse(raw);
  if (parsed.success) {
    return { ...DEFAULT_PAYMENT_METHODS, ...parsed.data };
  }
  return DEFAULT_PAYMENT_METHODS;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch payment methods config from system_config.
 *
 * @returns Query with payment methods configuration.
 */
export function usePaymentMethodsConfig() {
  return useQuery({
    queryKey: ["system-config", "payment_methods"],
    queryFn: async (): Promise<PaymentMethodsConfig> => {
      try {
        const { data, error } = await aisha.rpc("get_system_config", {
          p_key: "payment_methods",
        });

        if (error) {
          safeError("paymentMethods.fetch", error);
          return DEFAULT_PAYMENT_METHODS;
        }

        return normalizePaymentMethods(data);
      } catch (err) {
        safeError("paymentMethods.fetch", err);
        return DEFAULT_PAYMENT_METHODS;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Update payment methods config via admin RPC.
 *
 * @returns Mutation for updating payment methods configuration.
 */
export function useUpdatePaymentMethods() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: PaymentMethodsConfig): Promise<void> => {
      const { error } = await aisha.rpc("set_system_config_admin", {
        p_category: "commerce",
        p_description: "Payment method configuration (card toggle, bank transfer settings)",
        p_is_public: true,
        p_key: "payment_methods",
        p_value: config,
      });

      if (error) {
        safeError("paymentMethods.update", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["system-config", "payment_methods"],
      });
    },
  });
}

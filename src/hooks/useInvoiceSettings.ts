import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const invoiceHeaderSchema = z.object({
  bank_account_bic: z.string(),
  bank_account_iban: z.string(),
  bank_name: z.string(),
  city: z.string(),
  company_name: z.string(),
  country: z.string(),
  dic: z.string(),
  ico: z.string(),
  address_line1: z.string(),
  address_line2: z.string(),
  logo_path: z.string(),
  postal_code: z.string(),
});

/**
 * Invoice header configuration stored in system_config.
 */
export type InvoiceHeaderConfig = z.infer<typeof invoiceHeaderSchema>;

export const DEFAULT_INVOICE_HEADER: InvoiceHeaderConfig = {
  bank_account_bic: "",
  bank_account_iban: "",
  bank_name: "",
  city: "",
  company_name: "",
  country: "CZ",
  dic: "",
  ico: "",
  address_line1: "",
  address_line2: "",
  logo_path: "",
  postal_code: "",
};

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function normalizeInvoiceHeader(raw: unknown): InvoiceHeaderConfig {
  const parsed = invoiceHeaderSchema.partial().safeParse(raw);
  if (parsed.success) {
    return { ...DEFAULT_INVOICE_HEADER, ...parsed.data };
  }
  return DEFAULT_INVOICE_HEADER;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch invoice header config from system_config.
 *
 * @returns Query with invoice header configuration.
 */
export function useInvoiceHeaderConfig() {
  return useQuery({
    queryKey: ["system-config", "invoice_header"],
    queryFn: async (): Promise<InvoiceHeaderConfig> => {
      try {
        const { data, error } = await aisha.rpc("get_system_config", {
          p_key: "invoice_header",
        });

        if (error) {
          safeError("invoiceHeader.fetch", error);
          return DEFAULT_INVOICE_HEADER;
        }

        return normalizeInvoiceHeader(data);
      } catch (err) {
        safeError("invoiceHeader.fetch", err);
        return DEFAULT_INVOICE_HEADER;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Update invoice header config via admin RPC.
 *
 * @returns Mutation for updating invoice header configuration.
 */
export function useUpdateInvoiceHeader() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: InvoiceHeaderConfig): Promise<void> => {
      const { error } = await aisha.rpc("set_system_config_admin", {
        p_category: "commerce",
        p_description: "Invoice header configuration (company details, bank account)",
        p_is_public: false,
        p_key: "invoice_header",
        p_value: config,
      });

      if (error) {
        safeError("invoiceHeader.update", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["system-config", "invoice_header"],
      });
    },
  });
}

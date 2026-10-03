import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import {
  parseArrayResponse,
  productionBatchArraySchema,
  productionLogAdminArraySchema,
} from "@/lib/schemas/adminSchemas";

export interface LogFormData {
  batch_id: string | null;
  log_type: string;
  log_category: string;
  title: string;
  description: string;
  input_volume: string;
  input_concentration: string;
  output_volume: string;
  output_concentration: string;
  loss_volume: string;
  waste_volume: string;
  material_lot: string;
  source_container: string;
  target_container: string;
  temperature: string;
  notes: string;
}

/**
 * Hook to fetch production logs
 */
export function useProductionLogsAdmin(options: {
  batchId?: string;
  categoryFilter?: string;
  typeFilter?: string;
}) {
  const { batchId, categoryFilter = "all", typeFilter = "all" } = options;
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["production-logs", batchId, categoryFilter, typeFilter],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_production_logs_admin", {
        p_batch_id: batchId,
        p_limit: 100,
        p_log_type: typeFilter === "all" ? undefined : typeFilter,
      });

      if (error) {
        safeError("admin.production.logs.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = parseArrayResponse(
        productionLogAdminArraySchema,
        data,
        "get_production_logs_admin"
      );

      if (categoryFilter === "all") return parsed;
      return parsed.filter((l) => l.log_category === categoryFilter);
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to fetch active production batches (for log creation)
 */
export function useActiveBatches() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["active-batches"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_production_batches_admin", {
        p_product_id: undefined
,
        p_purpose: undefined,
        p_status: undefined
    });

      if (error) {
        safeError("admin.production.batches.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = parseArrayResponse(
        productionBatchArraySchema,
        data,
        "get_production_batches_admin"
      );

      return parsed
        .filter((b) => ["draft", "in_production", "qc_pending"].includes(b.status))
        .map((b) => ({ id: b.id, batch_code: b.batch_code, product_name: b.product_name }));
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a production log entry
 */
export function useCreateProductionLog() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_production_log", async (formData: LogFormData) => {
      const { error } = await aisha.rpc("create_production_log", {
        p_data: {
          batch_id: formData.batch_id || null,
          log_type: formData.log_type,
          description: [
            formData.title,
            formData.description,
            formData.log_category && `Category: ${formData.log_category}`,
            formData.input_volume && `Input: ${formData.input_volume}`,
            formData.output_volume && `Output: ${formData.output_volume}`,
            formData.notes,
          ]
            .filter(Boolean)
            .join("\n"),
          measurements: {
            input_volume: formData.input_volume ? parseFloat(formData.input_volume) : null,
            input_concentration: formData.input_concentration
              ? parseFloat(formData.input_concentration)
              : null,
            output_volume: formData.output_volume ? parseFloat(formData.output_volume) : null,
            output_concentration: formData.output_concentration
              ? parseFloat(formData.output_concentration)
              : null,
            loss_volume: formData.loss_volume ? parseFloat(formData.loss_volume) : null,
            waste_volume: formData.waste_volume ? parseFloat(formData.waste_volume) : null,
            temperature: formData.temperature ? parseFloat(formData.temperature) : null,
          },
        },
      });

      if (error) {
        safeError("admin.production.logs.createFailed", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-logs"] });
    },
  });
}

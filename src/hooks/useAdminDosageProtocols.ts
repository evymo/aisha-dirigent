import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

const distributionProtocolSchema = z.object({
  id: z.string(),
  study_id: z.string().nullable(),
  product_id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  name_key: z.string().nullable().default(null),
  description_key: z.string().nullable().default(null),
  dose_amount: z.number(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  dose_timing: z.array(z.string()).nullable(),
  arm_code: z.string().nullable(),
  is_active: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
  study_name: z.string().nullable().default(null),
  study_code: z.string().nullable().default(null),
  product_name: z.string().nullable().default(null),
});

const distributionProtocolArraySchema = z.array(distributionProtocolSchema);

export type DistributionProtocol = z.infer<typeof distributionProtocolSchema>;

export interface StudyDropdownDistribution {
  id: string;
  name: string;
  code: string;
}

export interface ProductDropdownDistribution {
  id: string;
  name: string;
}

/**
 * Hook for fetching distribution protocols (admin only)
 */
export function useDistributionProtocolsAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-distribution-protocols"],
    queryFn: async (): Promise<DistributionProtocol[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_distribution_protocols_admin");
      if (error) {
        safeError("adminDistributionProtocols.fetch.failed", error);
        throw new Error(error.message);
      }

      const parsed = distributionProtocolArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("adminDistributionProtocols.parse.failed", parsed.error);
        return (data || []) as DistributionProtocol[];
      }

      return parsed.data;
    },
    staleTime: 2 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching studies dropdown for distribution protocols
 */
export function useStudiesDropdownDistribution() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-studies-dropdown-distribution"],
    queryFn: async (): Promise<StudyDropdownDistribution[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_studies_admin");
      if (error) {
        safeError("adminDistributionProtocols.studiesDropdown.failed", error);
        throw new Error(error.message);
      }

      const rawRows: unknown[] = Array.isArray(data) ? data : [];
      return rawRows
        .filter((row): row is { id: string; name: string; code: string } => {
          if (row == null || typeof row !== "object") return false;
          const r = row as Record<string, unknown>;
          return typeof r.id === "string" && typeof r.name === "string" && typeof r.code === "string";
        })
        .map((row) => ({ id: row.id, name: row.name, code: row.code }));
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for fetching products dropdown for distribution protocols
 */
export function useProductsDropdownDistribution() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-products-dropdown-distribution"],
    queryFn: async (): Promise<ProductDropdownDistribution[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_products_admin");
      if (error) {
        safeError("adminDistributionProtocols.productsDropdown.failed", error);
        throw new Error(error.message);
      }

      const rawRows: unknown[] = Array.isArray(data) ? data : [];
      return rawRows
        .filter((row): row is { id: string; name: string } => {
          if (row == null || typeof row !== "object") return false;
          const r = row as Record<string, unknown>;
          return typeof r.id === "string" && typeof r.name === "string";
        })
        .map((row) => ({ id: row.id, name: row.name }));
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

export interface CreateDistributionProtocolParams {
  study_id: string | null;
  product_id: string | null;
  name: string;
  description: string;
  name_key?: string | null;
  description_key?: string | null;
  dose_amount: number;
  dose_unit: string;
  doses_per_day: number;
  dose_timing: string[];
  arm_code: string;
  is_active: boolean;
}

/**
 * Hook for creating a distribution protocol
 */
export function useCreateDistributionProtocol() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_distribution_protocol_admin", async (params: CreateDistributionProtocolParams) => {
      const { error } = await aisha.rpc("upsert_distribution_protocol_admin", {
        p_arm_code: params.arm_code || undefined,
        p_description: params.description || undefined,
        p_description_key: params.description_key || undefined,
        p_dose_amount: params.dose_amount,
        p_dose_timing: params.dose_timing,
        p_dose_unit: params.dose_unit,
        p_doses_per_day: params.doses_per_day,
        p_id: undefined,
        p_is_active: params.is_active,
        p_name: params.name,
        p_name_key: params.name_key || undefined,
        p_product_id: params.product_id || undefined,
        p_study_id: params.study_id || undefined,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-distribution-protocols"] });
    },
    onError: (error) => {
      safeError("adminDistributionProtocols.create.failed", error);
    },
  });
}

export interface UpdateDistributionProtocolParams {
  id: string;
  data: Partial<CreateDistributionProtocolParams>;
}

/**
 * Hook for updating a distribution protocol
 */
export function useUpdateDistributionProtocol() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("upsert_distribution_protocol_admin", async ({ id, data }: UpdateDistributionProtocolParams) => {
      const { error } = await aisha.rpc("upsert_distribution_protocol_admin", {
        p_arm_code: data.arm_code ?? undefined,
        p_description: data.description ?? undefined,
        p_description_key: data.description_key ?? undefined,
        p_dose_amount: data.dose_amount ?? undefined,
        p_dose_timing: data.dose_timing ?? undefined,
        p_dose_unit: data.dose_unit ?? undefined,
        p_doses_per_day: data.doses_per_day ?? undefined,
        p_id: id,
        p_is_active: data.is_active ?? undefined,
        p_name: data.name ?? undefined,
        p_name_key: data.name_key ?? undefined,
        p_product_id: data.product_id ?? undefined,
        p_study_id: data.study_id ?? undefined,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-distribution-protocols"] });
    },
    onError: (error) => {
      safeError("adminDistributionProtocols.update.failed", error);
    },
  });
}

/**
 * Hook for deleting a distribution protocol
 */
export function useDeleteDistributionProtocol() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_distribution_protocol_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_distribution_protocol_admin", {
        p_id: id,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-distribution-protocols"] });
    },
    onError: (error) => {
      safeError("adminDistributionProtocols.delete.failed", error);
    },
  });
}

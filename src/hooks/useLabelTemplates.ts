import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { EKORTN } from "@/lib/constants/companyData";
import {
  labelArchivePublicAdminArraySchema,
  labelTemplateAdminArraySchema,
  parseArrayResponse,
  productListArraySchema,
  type LabelTemplateAdminRow,
} from "@/lib/schemas/adminSchemas";


/**
 * Hook to fetch label templates
 */
export function useLabelTemplatesAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["label-templates"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];

      const { data, error } = await aisha.rpc("get_label_templates_admin");

      if (error) {
        safeError("admin.production.labels.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseArrayResponse(labelTemplateAdminArraySchema, data, "get_label_templates_admin");
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook to fetch archived labels
 */
export function useLabelArchiveAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["label-archive"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];

      const { data, error } = await aisha.rpc("get_label_archive_public_admin");

      if (error) {
        safeError("admin.production.labels.archiveFetchFailed", error);
        throw new Error(error.message);
      }

      return parseArrayResponse(
        labelArchivePublicAdminArraySchema,
        data,
        "get_label_archive_public_admin"
      );
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook to fetch products for label creation
 */
export function useProductsForLabels() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["products-for-labels"],
    queryFn: async () => {
      if (!isAdmin || !user) return [];

      const { data, error } = await aisha.rpc("get_production_products_admin");

      if (error) {
        safeError("admin.production.products.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseArrayResponse(productListArraySchema, data, "get_production_products_admin");
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook to initialize label templates from existing product data in DB.
 * Creates a label template for each active product using its DB-stored content.
 */
export function useInitializeLabels() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const { data: products } = useProductsForLabels();

  return useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error("Unauthorized");
      }

      if (!isAdmin) {
        throw new Error("Unauthorized");
      }

      if (!products || products.length === 0) {
        throw new Error("Products not loaded");
      }

      for (const product of products) {
        const templateData = {
          product_name_key: `label_template.${product.slug}.product_name`,
          manufacturer: EKORTN.name,
          manufacturer_address: EKORTN.registeredOffice,
          country_of_origin: "Česká republika",
        };

        const payload = {
          product_id: product.id,
          template_name: product.name ?? product.slug,
          version: "1.0",
          is_active: true,
          template_data: templateData,
        };

        const { error } = await aisha.rpc("create_label_template_admin", {
          p_data: payload,
        });

        if (error) {
          safeError("admin.production.labels.initFailed", error);
          throw new Error(error.message);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
  });
}

/**
 * Hook to archive a label template
 */
export function useArchiveLabelTemplate() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useMutation({
    mutationFn: async (template: LabelTemplateAdminRow) => {
      if (!user) {
        throw new Error("Unauthorized");
      }

      if (!isAdmin) {
        throw new Error("Unauthorized");
      }

      const { error } = await aisha.rpc("archive_label_template_admin", {
        p_archived_by: user.id
,
        p_template_id: template.id
    });

      if (error) {
        safeError("admin.production.labels.archiveFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label-templates"] });
      queryClient.invalidateQueries({ queryKey: ["label-archive"] });
    },
  });
}

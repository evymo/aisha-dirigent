import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { usePermissions } from "@/hooks/usePermissions";
import {
  IntegrationServicesArraySchema,
  type IntegrationService,
} from "@/schemas/integrationServiceSchemas";

async function fetchIntegrationServices(errorContext: string) {
  const { data, error } = await aisha.rpc("list_integration_services", {
    p_active_only: true,
  });
  if (error) {
    safeError(errorContext, error);
    throw new Error(error.message);
  }
  return IntegrationServicesArraySchema.parse(data ?? []);
}

/**
 * Fetch all active integration services for admin dashboard.
 *
 * Data source: `public.list_integration_services()`
 * Requires: `view_admin_dashboard` or `view_staff_dashboard` permission.
 */
export function useIntegrationServices() {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard") || hasPermission("view_staff_dashboard");

  return useQuery<IntegrationService[]>({
    queryKey: ["admin", "integration-services"],
    enabled: canView,
    staleTime: 5 * 60_000,
    queryFn: () => fetchIntegrationServices("admin.integrationServices.list"),
  });
}

/**
 * Fetch a specific integration service by name.
 *
 * @param serviceName - The service_name to filter by (e.g. "appsmith", "nocodb").
 */
export function useIntegrationServiceByName(serviceName: string | null) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard") || hasPermission("view_staff_dashboard");

  return useQuery<IntegrationService | null>({
    queryKey: ["admin", "integration-services", serviceName],
    enabled: canView && !!serviceName,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const parsed = await fetchIntegrationServices("admin.integrationServices.byName");
      return parsed.find((s) => s.service_name === serviceName) ?? null;
    },
  });
}

/**
 * Fetch multiple integration services by names in a single RPC call.
 */
export function useIntegrationServicesByNames(serviceNames: string[]) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard") || hasPermission("view_staff_dashboard");
  const normalizedNames = [...new Set(serviceNames.map((v) => v.trim()).filter(Boolean))].sort();

  return useQuery<Record<string, IntegrationService | null>>({
    queryKey: ["admin", "integration-services", "batch", normalizedNames],
    enabled: canView && normalizedNames.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const parsed = await fetchIntegrationServices("admin.integrationServices.batch");
      const lookup = new Map(parsed.map((svc) => [svc.service_name, svc]));
      return normalizedNames.reduce<Record<string, IntegrationService | null>>((acc, name) => {
        acc[name] = lookup.get(name) ?? null;
        return acc;
      }, {});
    },
  });
}

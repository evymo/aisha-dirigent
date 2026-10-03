import { z } from "zod";

/**
 * Schema for a single integration service from `list_integration_services` RPC.
 */
export const IntegrationServiceSchema = z.object({
  id: z.string().uuid(),
  service_name: z.string(),
  display_name: z.string(),
  service_type: z.string(),
  base_url: z.string(),
  config: z.record(z.unknown()).nullable(),
  health_status: z.string(),
  last_health_check: z.string().nullable(),
  is_active: z.boolean(),
  managed_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Inferred type for a single integration service. */
export type IntegrationService = z.infer<typeof IntegrationServiceSchema>;

/** Schema for an array of integration services. */
export const IntegrationServicesArraySchema = z.array(IntegrationServiceSchema);

/**
 * Hook for managing the MCP Server Registry (admin).
 *
 * Parallel to useProviderRegistry but for the MCP catalog (aisha-knowledge,
 * huggingface-inference, github-mcp, etc.). After PR #81 (WF_MCP_PROBE),
 * last_tested_at + last_test_result are updated every 5 min.
 *
 * Status lifecycle (vs binary toggle on providers):
 *   discovered → tested_ok / tested_failed
 *   tested_ok  → enabled (operator approves)
 *   enabled    → in_use (becomes actively used)
 *   in_use     → deprecated (winding down)
 *   any        → rejected (operator-driven retirement)
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/** Zod schema for MCP registry rows returned by get_mcp_registry_admin. */
const McpRegistryRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  transport: z.string(),
  endpoint_url: z.string().nullable(),
  stdio_command: z.array(z.string()).nullable(),
  auth_kind: z.string(),
  auth_env_var: z.string().nullable(),
  capability_tags: z.array(z.string()).nullable(),
  exposes_llm: z.boolean(),
  status: z.string(),
  last_tested_at: z.string().nullable(),
  last_test_result: z.unknown().nullable(),
  test_failure_count: z.number(),
  source: z.string(),
  registered_by: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Type for a single MCP registry row. */
export type McpRegistryRow = z.infer<typeof McpRegistryRowSchema>;

/** Filter options for the MCP registry query. */
export interface McpRegistryFilters {
  transport?: string;
  status?: string;
  activeOnly?: boolean;
}

/** Valid status values — operator UI can show as Select options. */
export const MCP_STATUSES = [
  "discovered",
  "tested_ok",
  "tested_failed",
  "enabled",
  "in_use",
  "deprecated",
  "rejected",
] as const;
export type McpStatus = (typeof MCP_STATUSES)[number];

/**
 * Fetches all MCP servers from the registry (admin).
 *
 * Sorted by operational lifecycle priority: in_use first, then enabled,
 * tested_ok, discovered, tested_failed, deprecated, rejected.
 *
 * @param filters - Optional filters for transport, status, active-only.
 * @returns Query result with array of McpRegistryRow.
 */
export function useMcpRegistry(filters?: McpRegistryFilters) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["mcp-registry", user?.id, filters],
    queryFn: async (): Promise<McpRegistryRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_mcp_registry_admin", {
        p_active_only: filters?.activeOnly ?? false,
        p_status: filters?.status,
        p_transport: filters?.transport,
      });

      if (error) {
        safeError("useMcpRegistry.fetch", error);
        throw new Error(error.message);
      }

      return z.array(McpRegistryRowSchema).parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Mutation to transition MCP status. Server-side enforces valid transitions
 * per the state machine — bad transitions throw with explicit error message
 * the UI can surface.
 *
 * @returns Mutation for status transition.
 */
export function useUpdateMcpStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      mcpId: string;
      newStatus: McpStatus;
      note?: string;
    }) => {
      const { data, error } = await aisha.rpc("update_mcp_status_admin", {
        p_mcp_id: params.mcpId,
        p_new_status: params.newStatus,
        p_note: params.note,
      });

      if (error) {
        safeError("useUpdateMcpStatus.mutate", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-registry"] });
    },
  });
}

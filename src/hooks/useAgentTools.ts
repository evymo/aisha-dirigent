/**
 * Admin hooks for managing AI agent tools (Phase 2 — Tool System).
 *
 * Provides CRUD operations for the `agent_tools` registry.
 * Tool-to-agent bindings were removed in the channel-centric migration.
 *
 * All data access uses the RPC-only pattern with SECURITY DEFINER functions.
 *
 * @module hooks/useAgentTools
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import type { Json } from "@/integrations/db/types";

// ============================================================================
// Zod Schemas
// ============================================================================

const AgentToolSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  display_name_key: z.string(),
  description: z.string(),
  parameters_schema: z.unknown(),
  handler_type: z.enum(["rpc", "edge_function", "webhook"]),
  handler_ref: z.string(),
  access_tier_min: z.string(),
  is_active: z.boolean(),
  requires_consent: z.boolean(),
  audit_action: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
  binding_count: z.number().optional(),
});

export type AgentTool = z.infer<typeof AgentToolSchema>;

export interface AgentToolUpsertInput {
  p_name: string;
  p_display_name_key: string;
  p_description: string;
  p_parameters_schema: Json;
  p_handler_type: "rpc" | "edge_function" | "webhook";
  p_handler_ref: string;
  p_access_tier_min: string;
  p_is_active: boolean;
  p_requires_consent: boolean;
  p_audit_action: string | null;
  p_metadata: Json | null;
}

// ============================================================================
// Query Keys
// ============================================================================

const QUERY_KEYS = {
  all: ["agent-tools"] as const,
  list: () => [...QUERY_KEYS.all, "list"] as const,
  detail: (name: string) => [...QUERY_KEYS.all, "detail", name] as const,
};

// ============================================================================
// Hooks — Queries
// ============================================================================

/**
 * Hook for fetching a single agent tool by name.
 * Uses `get_agent_tool` RPC.
 *
 * @param toolName - The unique name of the tool to fetch.
 * @returns Query object containing the tool details.
 */
export function useAgentTool(toolName: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: QUERY_KEYS.detail(toolName ?? ""),
    queryFn: async () => {
      if (!toolName || !isAdmin) return null;

      const { data, error } = await aisha.rpc("get_agent_tool", {
        p_name: toolName,
      });

      if (error) {
        safeError("useAgentTool.fetch", error);
        throw new Error(error.message);
      }

      if (!data) return null;
      return AgentToolSchema.parse(data);
    },
    enabled: !!user && !!toolName && isAdmin,
  });
}

// ============================================================================
// Hooks — Mutations
// ============================================================================

/**
 * Hook for creating or updating an agent tool.
 * Uses `upsert_agent_tool_admin` RPC.
 *
 * @returns Mutation object for upserting an agent tool.
 * @example
 * const { mutateAsync } = useUpsertAgentTool();
 * await mutateAsync({ p_name: "my_tool", ... });
 */
export function useUpsertAgentTool() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "upsert_agent_tool_admin",
      async (input: AgentToolUpsertInput) => {
        const { data, error } = await aisha.rpc("upsert_agent_tool_admin", {
          ...input,
          p_audit_action: input.p_audit_action ?? undefined,
          p_metadata: input.p_metadata ?? undefined,
        });

        if (error) {
          safeError("useUpsertAgentTool.mutate", error);
          throw new Error(error.message);
        }

        return data as string; // Returns tool UUID
      }
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all });
    },
  });
}

/**
 * Hook for deleting an agent tool.
 * Uses `delete_agent_tool_admin` RPC.
 *
 * @returns Mutation object for deleting an agent tool.
 */
export function useDeleteAgentTool() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "delete_agent_tool_admin",
      async (toolId: string) => {
        const { error } = await aisha.rpc("delete_agent_tool_admin", {
          p_tool_id: toolId,
        });

        if (error) {
          safeError("useDeleteAgentTool.mutate", error);
          throw new Error(error.message);
        }
      }
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.all });
    },
  });
}



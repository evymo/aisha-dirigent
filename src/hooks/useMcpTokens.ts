/**
 * Hook for managing MCP Auth Tokens (admin).
 *
 * Provides list, create, toggle, and revoke operations for MCP bearer tokens.
 * Token hash is never exposed to the frontend (only on creation).
 * Uses RPC-only pattern with SECURITY DEFINER + is_admin_or_staff() checks.
 *
 * @module hooks/useMcpTokens
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import {
  mcpAuthTokenArraySchema,
  type McpAuthTokenRow,
} from "@/lib/schemas/expertOverlaySchemas";

/** Query key factory for MCP tokens */
export const mcpTokenKeys = {
  all: ["mcp-tokens"] as const,
  list: () => [...mcpTokenKeys.all, "list"] as const,
};

/**
 * Hook for fetching all MCP auth tokens (without hash).
 *
 * @returns Query object with parsed token rows.
 * @example
 * const { data: tokens, isLoading } = useMcpTokens();
 */
export function useMcpTokens() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: mcpTokenKeys.list(),
    queryFn: async (): Promise<McpAuthTokenRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc("get_mcp_tokens_admin");

      if (error) {
        safeError("useMcpTokens.fetch", error);
        throw new Error(error.message);
      }

      return mcpAuthTokenArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Input type for creating an MCP token.
 */
export interface CreateMcpTokenInput {
  scope?: string;
  allowed_tools?: string[];
  denied_tools?: string[];
  rate_limit_rpm?: number;
  rate_limit_daily?: number;
  project_id?: string | null;
  account_id?: string | null;
  expires_in_days?: number | null;
}

/**
 * Hook for creating a new MCP auth token.
 * Returns the raw token hash (shown once to the user, then never again).
 *
 * @returns Mutation that returns { token_hash: string }.
 * @example
 * const { mutateAsync } = useCreateMcpToken();
 * const result = await mutateAsync({ scope: "read_only" });
 * // Show result.token_hash to user ONCE
 */
export function useCreateMcpToken() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "create_mcp_token",
      async (input: CreateMcpTokenInput) => {
        const { data, error } = await aisha.rpc("create_mcp_token", {
          p_account_id: input.account_id ?? undefined,
          p_allowed_tools: input.allowed_tools ?? [],
          p_denied_tools: input.denied_tools ?? [],
          p_expires_in_days: input.expires_in_days ?? 90,
          p_project_id: input.project_id ?? undefined,
          p_rate_limit_daily: input.rate_limit_daily ?? 10000,
          p_rate_limit_rpm: input.rate_limit_rpm ?? 60,
          p_scope: input.scope ?? "read_only",
        });

        if (error) {
          safeError("useCreateMcpToken.create", error);
          throw new Error(error.message);
        }

        return data as unknown as { token_hash: string };
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpTokenKeys.all });
    },
  });
}

/**
 * Hook for toggling an MCP token's active status.
 *
 * @returns Mutation for activating/deactivating a token.
 * @example
 * const { mutateAsync } = useToggleMcpToken();
 * await mutateAsync({ id: tokenId, isActive: false });
 */
export function useToggleMcpToken() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "toggle_mcp_token_admin",
      async ({ id, isActive }: { id: string; isActive: boolean }) => {
        const { data, error } = await aisha.rpc("toggle_mcp_token_admin", {
          p_id: id,
          p_is_active: isActive,
        });

        if (error) {
          safeError("useToggleMcpToken.toggle", error);
          throw new Error(error.message);
        }

        return { id: data };
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpTokenKeys.all });
    },
  });
}

/**
 * Hook for permanently revoking an MCP token.
 * Sets is_active=false, expires_at=now(), clears tool arrays.
 *
 * @returns Mutation for revoking a token (irreversible).
 * @example
 * const { mutateAsync } = useRevokeMcpToken();
 * await mutateAsync(tokenId);
 */
export function useRevokeMcpToken() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "revoke_mcp_token_admin",
      async (id: string) => {
        const { data, error } = await aisha.rpc("revoke_mcp_token_admin", {
          p_id: id,
        });

        if (error) {
          safeError("useRevokeMcpToken.revoke", error);
          throw new Error(error.message);
        }

        return { id: data };
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpTokenKeys.all });
    },
  });
}

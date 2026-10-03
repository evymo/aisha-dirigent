/**
 * Hook for AI long-term (cross-session) user memory management.
 *
 * Provides React Query hooks for reading and writing persistent
 * memory entries that survive across conversations.
 *
 * All operations are audited — reads and writes create audit_journal entries.
 * Admin/staff can access other users' memory with elevated permissions.
 *
 * @module hooks/useAiUserMemory
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

const UserMemoryEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  last_updated: z.string(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Single long-term memory entry. */
export type UserMemoryEntry = z.infer<typeof UserMemoryEntrySchema>;

// ============================================================================
// Query Key Factory
// ============================================================================

/** Query key factory for user memory. */
export const userMemoryKeys = {
  all: ["ai-user-memory"] as const,
  own: () => [...userMemoryKeys.all, "own"] as const,
  user: (userId: string) => [...userMemoryKeys.all, "user", userId] as const,
  admin: (limit?: number) => [...userMemoryKeys.all, "admin", limit] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch own long-term memory entries (audited).
 *
 * @returns Query with array of user memory entries
 * @example
 * const { data: memories } = useAiUserMemory();
 */
export function useAiUserMemory() {
  const { user } = useSession();

  return useQuery({
    queryKey: userMemoryKeys.own(),
    queryFn: async (): Promise<UserMemoryEntry[]> => {
      const { data, error } = await aisha.rpc("get_user_memory_audited", {
        p_target_user_id: undefined,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = UserMemoryEntrySchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is UserMemoryEntry => x !== null);
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/**
 * Fetch a specific user's memory entries (admin/staff only, audited).
 *
 * @param targetUserId - UUID of the user whose memory to access
 * @returns Query with array of user memory entries
 */
export function useAiUserMemoryForUser(targetUserId: string | null | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: userMemoryKeys.user(targetUserId ?? ""),
    queryFn: async (): Promise<UserMemoryEntry[]> => {
      if (!targetUserId) return [];

      const { data, error } = await aisha.rpc("get_user_memory_audited", {
        p_target_user_id: targetUserId,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = UserMemoryEntrySchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is UserMemoryEntry => x !== null);
    },
    enabled: !!user && !!targetUserId && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

/**
 * Admin: list all user memories across the platform.
 *
 * @param limit - Maximum results (default 100)
 */
export function useAdminUserMemories(limit = 100) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();

  return useQuery({
    queryKey: userMemoryKeys.admin(limit),
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_admin_user_memories", {
        p_limit: limit,
      });

      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!user && hasPermission("view_admin_panel"),
    staleTime: 30_000,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Set a long-term memory entry (audited).
 *
 * @example
 * const { mutateAsync: setMemory } = useSetUserMemory();
 * await setMemory({ key: "preferred_language", value: "cs", source: "user_explicit" });
 */
export function useSetUserMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      key: string;
      value: unknown;
      source?: "user_explicit" | "inferred" | "admin_set" | "agent_derived";
      confidence?: number;
      targetUserId?: string | null;
    }): Promise<void> => {
      const { error } = await aisha.rpc("set_user_memory_audited", {
        p_confidence: input.confidence ?? 1.0,
        p_key: input.key,
        p_source: input.source ?? "user_explicit",
        p_target_user_id: input.targetUserId ?? undefined,
      
        p_value: toJson(input.value),});

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userMemoryKeys.all });
    },
    onError: (error) => {
      safeError("useSetUserMemory.failed", error);
    },
  });
}

/**
 * Delete a long-term memory entry.
 *
 * @example
 * const { mutateAsync: deleteMemory } = useDeleteUserMemory();
 * await deleteMemory("preferred_language");
 */
export function useDeleteUserMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (key: string): Promise<void> => {
      const { error } = await aisha.rpc("delete_user_memory", {
        p_key: key,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userMemoryKeys.all });
    },
    onError: (error) => {
      safeError("useDeleteUserMemory.failed", error);
    },
  });
}

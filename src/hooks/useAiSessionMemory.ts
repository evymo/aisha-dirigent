/**
 * Hook for AI session memory management.
 *
 * Provides React Query hooks for reading, writing, and clearing
 * conversation-scoped memory entries (key-value pairs).
 *
 * Session memory is ephemeral and tied to a specific conversation.
 * It automatically expires based on configured TTL.
 *
 * @module hooks/useAiSessionMemory
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";
import { toJson } from "@/lib/types/json";
import { z } from "zod";

// ============================================================================
// Zod Schemas
// ============================================================================

const SessionMemoryEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  expires_at: z.string().nullable(),
  updated_at: z.string(),
});

// ============================================================================
// Exported Types
// ============================================================================

/** Single session memory entry. */
export type SessionMemoryEntry = z.infer<typeof SessionMemoryEntrySchema>;

// ============================================================================
// Query Key Factory
// ============================================================================

/** Query key factory for session memory. */
export const sessionMemoryKeys = {
  all: ["ai-session-memory"] as const,
  conversation: (conversationId: string | null | undefined) =>
    [...sessionMemoryKeys.all, conversationId] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch all session memory entries for a conversation.
 *
 * @param conversationId - UUID of the conversation
 * @returns Query with array of session memory entries
 * @example
 * const { data: entries } = useAiSessionMemory(conversationId);
 */
export function useAiSessionMemory(
  conversationId: string | null | undefined,
) {
  const { user } = useSession();

  return useQuery({
    queryKey: sessionMemoryKeys.conversation(conversationId),
    queryFn: async (): Promise<SessionMemoryEntry[]> => {
      if (!conversationId) return [];

      const { data, error } = await aisha.rpc("get_session_memory", {
        p_conversation_id: conversationId,
      });

      if (error) throw new Error(error.message);
      if (!data || !Array.isArray(data)) return [];

      return data
        .map((item) => {
          const parsed = SessionMemoryEntrySchema.safeParse(item);
          return parsed.success ? parsed.data : null;
        })
        .filter((x): x is SessionMemoryEntry => x !== null);
    },
    enabled: !!user && !!conversationId,
    staleTime: 10_000,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Set a session memory key-value pair.
 *
 * @example
 * const { mutateAsync: setMemory } = useSetSessionMemory();
 * await setMemory({ conversationId, key: "topic", value: { name: "sleep" } });
 */
export function useSetSessionMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      conversationId: string;
      key: string;
      value: unknown;
      expiresAt?: string | null;
    }): Promise<void> => {
      const { error } = await aisha.rpc("set_session_memory", {
        p_conversation_id: input.conversationId,
        p_expires_at: input.expiresAt ?? undefined,
      
        p_key: input.key,
        p_value: toJson(input.value),});

      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: sessionMemoryKeys.conversation(variables.conversationId),
      });
    },
    onError: (error) => {
      safeError("useSetSessionMemory.failed", error);
    },
  });
}

/**
 * Clear all session memory for a conversation.
 *
 * @example
 * const { mutateAsync: clearMemory } = useClearSessionMemory();
 * await clearMemory(conversationId);
 */
export function useClearSessionMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string): Promise<void> => {
      const { error } = await aisha.rpc("clear_session_memory", {
        p_conversation_id: conversationId,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({
        queryKey: sessionMemoryKeys.conversation(conversationId),
      });
    },
    onError: (error) => {
      safeError("useClearSessionMemory.failed", error);
    },
  });
}

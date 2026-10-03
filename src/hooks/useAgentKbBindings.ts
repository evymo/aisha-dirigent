/**
 * useAgentKbBindings — Phase 5 bot ↔ expert_rule binding accessor.
 *
 * Two surfaces:
 *   useAgentKbBindings  — read-side (list_agent_kb_bindings RPC)
 *   useSetAgentKbBinding — write-side (set_agent_knowledge_binding_audited)
 *
 * The mutation is admin/staff-only (enforced in the RPC body); the read
 * is participant-aware.
 *
 * @module hooks/useAgentKbBindings
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

const BindingRowSchema = z.object({
  binding_id: z.string().uuid(),
  agent_slug: z.string(),
  knowledge_item_id: z.string().uuid(),
  knowledge_title: z.string(),
  knowledge_slug: z.string(),
  knowledge_category: z.string(),
  knowledge_status: z.string(),
  binding_type: z.string(),
  priority: z.number().int(),
  version: z.number().int().nullable(),
  is_active: z.boolean(),
  story_id: z.string().uuid().nullable(),
  is_global: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().uuid().nullable(),
});

const BindingArraySchema = z.array(BindingRowSchema);

export type AgentKbBinding = z.infer<typeof BindingRowSchema>;

interface UseAgentKbBindingsOptions {
  storyId: string | null | undefined;
  agentSlug?: string | null;
  enabled?: boolean;
}

export function useAgentKbBindings(opts: UseAgentKbBindingsOptions) {
  const { storyId, agentSlug = null, enabled = true } = opts;
  return useQuery({
    queryKey: ["agent_kb_bindings", storyId, agentSlug],
    enabled: enabled && !!storyId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<AgentKbBinding[]> => {
      if (!storyId) return [];
      const { data, error } = await aisha.rpc("list_agent_kb_bindings", {
        p_agent_slug: agentSlug ?? undefined,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useAgentKbBindings", error);
        throw error;
      }
      return BindingArraySchema.parse(data ?? []);
    },
  });
}

export interface SetBindingInput {
  agentSlug: string;
  knowledgeItemId: string;
  bindingType?: string;
  priority?: number;
  version?: number | null;
  isActive?: boolean;
  storyId?: string | null;
  notes?: string | null;
}

export function useSetAgentKbBinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetBindingInput) => {
      const { data, error } = await aisha.rpc(
        "set_agent_knowledge_binding_audited",
        {
          p_agent_slug: input.agentSlug,
          p_knowledge_item_id: input.knowledgeItemId,
          p_binding_type: input.bindingType ?? "rule",
          p_priority: input.priority ?? 100,
          p_version: input.version ?? undefined,
          p_is_active: input.isActive ?? true,
          p_story_id: input.storyId ?? undefined,
          p_notes: input.notes ?? undefined,
        },
      );
      if (error) {
        safeError("useSetAgentKbBinding", error);
        throw error;
      }
      return data as string | null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent_kb_bindings"] });
    },
  });
}

/**
 * Story AI-parametrization hooks — the rulesets + knowledge context that make
 * AISHA story-specific. Surfaced read-only so the chat can show "what AISHA is
 * parametrized with" for this story. Backed by get_story_rulesets +
 * get_story_knowledge_context (both authenticated; visibility enforced server-side,
 * so they degrade to empty for callers without access).
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { storyRulesetSchema, storyKnowledgeContextItemSchema } from "@/types/schemas";
import { safeWarn } from "@/lib/security/safeLogger";
import type { StoryRuleset, StoryKnowledgeContextItem } from "@/types/schemas";

function parseArray<T>(
  data: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<T[]>((acc, item) => {
    const r = schema.safeParse(item);
    if (r.success && r.data !== undefined) acc.push(r.data);
    return acc;
  }, []);
}

/** Rulesets bound to a story (most recent first = active). */
export function useStoryRulesets(storyId: string | undefined, enabled = true) {
  return useQuery<StoryRuleset[]>({
    queryKey: ["story-rulesets", storyId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_story_rulesets", { p_story_id: storyId! });
      if (error) {
        safeWarn("useStoryRulesets.fetch", error);
        return [];
      }
      return parseArray<StoryRuleset>(data, storyRulesetSchema);
    },
    enabled: enabled && !!storyId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Knowledge context docs AISHA draws on for a story. */
export function useStoryKnowledgeContext(storyId: string | undefined, enabled = true) {
  return useQuery<StoryKnowledgeContextItem[]>({
    queryKey: ["story-knowledge-context", storyId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_story_knowledge_context", {
        p_context_tags: [],
        p_story_id: storyId!,
      });
      if (error) {
        safeWarn("useStoryKnowledgeContext.fetch", error);
        return [];
      }
      return parseArray<StoryKnowledgeContextItem>(data, storyKnowledgeContextItemSchema);
    },
    enabled: enabled && !!storyId,
    staleTime: 5 * 60 * 1000,
  });
}

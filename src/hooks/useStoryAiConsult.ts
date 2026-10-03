import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import {
  AiConsultResponseSchema,
  type AiConsultRequest,
  type AiConsultResponse,
} from "@/schemas/storyLoopSchemas";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

interface UseStoryAiConsultOptions {
  storyId: string;
  /** Language for AI responses */
  language?: string;
  /** Enable streaming mode for real-time response display */
  enableStreaming?: boolean;
}

const RequestValidationSchema = z.object({
  story_id: z.string().uuid(),
  action: z.enum(["chat", "recap", "translate", "recommend", "analyze"]),
  message: z.string().optional(),
  target_language: z.string().optional(),
  entry_ids: z.array(z.string().uuid()).optional(),
  include_health_data: z.boolean().optional(),
  conversation_id: z.string().uuid().optional(),
  language: z.enum(["cs", "en"]).optional(),
});

const StoryThreadResolveSchema = z.object({
  conversation_id: z.string().uuid(),
  created: z.boolean().optional(),
  story_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
});

const StoryThreadMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  routing_category: z.string().optional().default(""),
  created_at: z.string(),
});

export type StoryThreadMessage = z.infer<typeof StoryThreadMessageSchema>;

function normalizeAiLanguage(language?: string): "cs" | "en" {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) return "cs";
  if (normalized.startsWith("en")) return "en";
  if (!normalized) return "cs";
  return "en";
}

async function resolveStoryConversation(storyId: string, userId: string): Promise<string> {
  const { data, error } = await aisha.rpc("edge_story_ai", {
    p_action: "get_or_create_story_conversation",
    p_payload: {
      story_id: storyId,
      user_id: userId,
      title: `Story consultation ${storyId.substring(0, 8)}`,
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to resolve story thread");
  }

  const parsed = StoryThreadResolveSchema.safeParse(data);
  if (!parsed.success) {
    safeError("storyloop.ai.resolveThread.validation", parsed.error);
    throw new Error("Invalid story thread response");
  }

  return parsed.data.conversation_id;
}

async function fetchThreadMessages(conversationId: string): Promise<StoryThreadMessage[]> {
  const { data, error } = await aisha.rpc("get_chat_messages_audited", {
    p_conversation_id: conversationId,
  });

  if (error) {
    throw new Error(error.message || "Failed to load story thread messages");
  }

  const parsed = z.array(StoryThreadMessageSchema).safeParse(data || []);
  if (!parsed.success) {
    safeError("storyloop.ai.messages.validation", parsed.error);
    return [];
  }

  return parsed.data;
}

async function invokeAiConsult(request: AiConsultRequest): Promise<AiConsultResponse> {
  const validatedRequest = RequestValidationSchema.parse(request);

  const { data, error } = await aisha.functions.invoke("ai-story-consult", {
    body: validatedRequest,
  });

  if (error) {
    throw new Error(error.message || "AI consultation failed");
  }

  const parsed = AiConsultResponseSchema.safeParse(data);
  if (!parsed.success) {
    safeError("storyloop.ai.validation", parsed.error);
    throw new Error("Invalid AI response format");
  }

  safeInfo("storyloop.ai.success", {
    action: parsed.data.action,
    tokens: parsed.data.tokens_used,
    conversation_id: parsed.data.conversation_id,
  });
  return parsed.data;
}

export function useStoryAiConsult({ storyId, language, enableStreaming = false }: UseStoryAiConsultOptions) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const requestLanguage = normalizeAiLanguage(language);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState<string>("");

  const resetStreaming = useCallback(() => {
    setIsStreaming(false);
    setStreamedContent("");
  }, []);

  const startStreaming = useCallback(() => {
    if (enableStreaming) {
      setIsStreaming(true);
      setStreamedContent("");
    }
  }, [enableStreaming]);

  const conversationQuery = useQuery({
    queryKey: ["story-ai-conversation", storyId, session?.user?.id],
    queryFn: async (): Promise<string | null> => {
      if (!session?.user?.id) return null;
      return resolveStoryConversation(storyId, session.user.id);
    },
    enabled: !!storyId && !!session?.user?.id,
    staleTime: 30000,
  });

  const messagesQuery = useQuery({
    queryKey: ["story-ai-messages", storyId, conversationQuery.data],
    queryFn: async (): Promise<StoryThreadMessage[]> => {
      if (!conversationQuery.data) return [];
      return fetchThreadMessages(conversationQuery.data);
    },
    enabled: !!conversationQuery.data,
    staleTime: 10000,
  });

  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (!session?.user?.id) {
      throw new Error("Not authenticated");
    }

    if (conversationQuery.data) {
      return conversationQuery.data;
    }

    const resolved = await resolveStoryConversation(storyId, session.user.id);
    queryClient.setQueryData(["story-ai-conversation", storyId, session.user.id], resolved);
    return resolved;
  }, [conversationQuery.data, queryClient, session?.user?.id, storyId]);

  const handleMutationSuccess = useCallback((response: AiConsultResponse) => {
    if (session?.user?.id) {
      queryClient.setQueryData(
        ["story-ai-conversation", storyId, session.user.id],
        response.conversation_id,
      );
    }
    queryClient.invalidateQueries({ queryKey: ["story-ai-messages", storyId] });
    queryClient.invalidateQueries({ queryKey: ["story-detail", storyId] });
  }, [queryClient, session?.user?.id, storyId]);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const conversationId = await ensureConversationId();
      return invokeAiConsult({
        story_id: storyId,
        action: "chat",
        message,
        include_health_data: true,
        conversation_id: conversationId,
        language: requestLanguage,
      });
    },
    onMutate: async (message: string) => {
      // Cancel pending message fetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["story-ai-messages", storyId] });

      const previousMessages = queryClient.getQueryData<StoryThreadMessage[]>(
        ["story-ai-messages", storyId, conversationQuery.data],
      );

      // Optimistically add the user message so it appears immediately in UI
      const optimisticMessage: StoryThreadMessage = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: message,
        routing_category: "story_chat",
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<StoryThreadMessage[]>(
        ["story-ai-messages", storyId, conversationQuery.data],
        (old) => [...(old || []), optimisticMessage],
      );

      return { previousMessages };
    },
    onSuccess: handleMutationSuccess,
    onError: (err, _message, context) => {
      // Rollback optimistic update on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["story-ai-messages", storyId, conversationQuery.data],
          context.previousMessages,
        );
      }
      safeError("storyloop.ai.chat", err);
    },
  });

  const recapMutation = useMutation({
    mutationFn: async () => {
      const conversationId = await ensureConversationId();
      return invokeAiConsult({
        story_id: storyId,
        action: "recap",
        include_health_data: true,
        conversation_id: conversationId,
        language: requestLanguage,
      });
    },
    onSuccess: handleMutationSuccess,
    onError: (err) => {
      safeError("storyloop.ai.recap", err);
    },
  });

  const translateMutation = useMutation({
    mutationFn: async (params: { targetLanguage: string; entryIds?: string[] }) => {
      const conversationId = await ensureConversationId();
      return invokeAiConsult({
        story_id: storyId,
        action: "translate",
        target_language: params.targetLanguage,
        entry_ids: params.entryIds,
        include_health_data: false,
        conversation_id: conversationId,
        language: requestLanguage,
      });
    },
    onSuccess: handleMutationSuccess,
    onError: (err) => {
      safeError("storyloop.ai.translate", err);
    },
  });

  const recommendMutation = useMutation({
    mutationFn: async () => {
      const conversationId = await ensureConversationId();
      return invokeAiConsult({
        story_id: storyId,
        action: "recommend",
        include_health_data: true,
        conversation_id: conversationId,
        language: requestLanguage,
      });
    },
    onSuccess: handleMutationSuccess,
    onError: (err) => {
      safeError("storyloop.ai.recommend", err);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const conversationId = await ensureConversationId();
      return invokeAiConsult({
        story_id: storyId,
        action: "analyze",
        include_health_data: true,
        conversation_id: conversationId,
        language: requestLanguage,
      });
    },
    onSuccess: handleMutationSuccess,
    onError: (err) => {
      safeError("storyloop.ai.analyze", err);
    },
  });

  return {
    // Actions
    sendChat: chatMutation.mutateAsync,
    generateRecap: recapMutation.mutateAsync,
    translate: translateMutation.mutateAsync,
    generateRecommendations: recommendMutation.mutateAsync,
    analyzeTracking: analyzeMutation.mutateAsync,

    // Thread state
    conversationId: conversationQuery.data ?? null,
    conversationLoading: conversationQuery.isLoading,
    messages: messagesQuery.data || [],
    messagesLoading: messagesQuery.isLoading,
    refetchMessages: messagesQuery.refetch,

    // Mutation states
    isLoading:
      chatMutation.isPending ||
      recapMutation.isPending ||
      translateMutation.isPending ||
      recommendMutation.isPending ||
      analyzeMutation.isPending,
    isChatLoading: chatMutation.isPending,
    isRecapLoading: recapMutation.isPending,
    isTranslateLoading: translateMutation.isPending,
    isRecommendLoading: recommendMutation.isPending,
    isAnalyzeLoading: analyzeMutation.isPending,

    // Streaming state (for future real-time display)
    isStreaming,
    streamedContent,
    resetStreaming,
    startStreaming,

    // Errors
    chatError: chatMutation.error,
    recapError: recapMutation.error,
    translateError: translateMutation.error,
    recommendError: recommendMutation.error,
    analyzeError: analyzeMutation.error,

    // Last responses
    lastChatResponse: chatMutation.data,
    lastRecapResponse: recapMutation.data,
    lastTranslateResponse: translateMutation.data,
    lastRecommendResponse: recommendMutation.data,
    lastAnalyzeResponse: analyzeMutation.data,
  };
}

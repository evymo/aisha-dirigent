import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { z } from "zod";
import {
  ChatAccessResponseSchema,
  type ChatAccessResponse,
} from "@/schemas/rpcResponseSchemas";

// ============================================
// ZOD SCHEMAS FOR TYPE-SAFE VALIDATION
// ============================================

const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  routing_category: z.string().optional().default(""),
  created_at: z.string(),
  // Step 2 UI: tracer run id (public.ai_runs.id) — populated from
  // ChatResponse metadata.run_id at mutation onSuccess. Used by
  // FaithfulnessChip + CitationPanel + dual-write FeedbackButtons to
  // resolve per-run RPCs. Historical messages (loaded from chat_messages
  // table via fetch) won't have this, hence optional.
  ai_run_id: z.string().uuid().nullable().optional(),
});

const ChatResponseSchema = z.object({
  conversation_id: z.string().uuid(),
  message: ChatMessageSchema,
  aisha_observing: z.boolean().optional().default(true),
  metadata: z.object({
    tokens_used: z.number(),
    response_time_ms: z.number(),
    specialist_used: z.string(),
    // Step 2 UI: tracer + aisha runIds surfaced by svc-ai-chat /chat
    // response (chat.ts:1159-1164). Declaring here lets Zod admit them
    // and onSuccess can copy run_id onto data.message.ai_run_id before
    // appending to the conversation cache.
    run_id: z.string().uuid().nullable().optional(),
    aisha_run_id: z.string().uuid().nullable().optional(),
  }).optional(),
  debug: z.array(z.object({
    stage: z.string(),
    message: z.string(),
    level: z.enum(["info", "warn", "error"]).optional(),
    timestamp: z.string().optional(),
  })).optional(),
});

const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().default(""),
  status: z.string(),
  message_count: z.number(),
  created_at: z.string(),
  last_message_at: z.string().nullable(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type { ChatAccessResponse };

interface UseChatOptions {
  conversationId?: string;
  language?: string;
  debugMode?: boolean;
}

interface SendMessageContext {
  queryKey: readonly [string, string | undefined];
  optimisticMessage: ChatMessage;
}

interface ChatDebugEvent {
  stage: string;
  message: string;
  level?: "info" | "warn" | "error";
  timestamp?: string;
}

// Raw shape of the ai-chat edge-function invoke payload. The client returns an
// opaque `{}` for `data`; this typed view names the fields the mutation reads
// before ChatResponseSchema.parse() validates the response.
interface RawChatInvokeResponse {
  conversation_id?: string;
  message?: { id?: string } & Record<string, unknown>;
  error?: string;
  debug?: unknown;
}

async function toInvokeError(error: unknown): Promise<Error & { debug?: ChatDebugEvent[] }> {
  const enrichedError = new Error(
    error instanceof Error ? error.message : "AI request failed"
  ) as Error & { debug?: ChatDebugEvent[] };

  const hasContextJson =
    error &&
    typeof error === "object" &&
    "context" in error &&
    typeof (error as { context?: unknown }).context === "object" &&
    (error as { context?: { json?: unknown } }).context &&
    typeof (error as { context?: { json?: unknown } }).context?.json === "function";

  if (!hasContextJson) {
    return enrichedError;
  }

  try {
    const payload = await (error as { context: { json: () => Promise<unknown> } }).context.json();
    if (!payload || typeof payload !== "object") {
      return enrichedError;
    }

    const parsed = payload as { error?: unknown; debug?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      enrichedError.message = parsed.error;
    }

    if (Array.isArray(parsed.debug)) {
      enrichedError.debug = parsed.debug as ChatDebugEvent[];
    }
  } catch (parseError) {
    safeError("useAiChat.sendMessage.invoke.parseError", parseError);
  }

  return enrichedError;
}

function createClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const suffix = Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function toDebugMessages(events: ChatDebugEvent[]): ChatMessage[] {
  return events.map((event) => ({
    id: createClientMessageId(),
    role: "system",
    content: `[${(event.level ?? "info").toUpperCase()}] ${event.stage}: ${event.message}`,
    routing_category: "",
    created_at: event.timestamp || new Date().toISOString(),
  }));
}

function normalizeAiLanguage(language?: string): "cs" | "en" {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized.startsWith("cs")) return "cs";
  if (normalized.startsWith("en")) return "en";
  if (!normalized) return "cs";
  return "en";
}

// ============================================
// SECURE CHAT HOOK WITH RPC-ONLY DATA ACCESS
// ============================================

/**
 * Hook for AI chat functionality.
 * Manages chat access, conversations, messages, and sending messages via Edge Function.
 *
 * @param options - Configuration options for the chat session.
 * @returns Object containing chat state, data, and actions.
 */
export function useAiChat(options: UseChatOptions = {}) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(options.conversationId);
  const requestLanguage = normalizeAiLanguage(options.language);

  // ----------------------------------------
  // RPC: Get chat access level
  // ----------------------------------------
  const accessQuery = useQuery({
    queryKey: ["chat-access", session?.user?.id],
    queryFn: async (): Promise<ChatAccessResponse> => {
      if (!session?.user?.id) {
        return {
          access_level: "none",
          can_chat: false,
          block_reason: "not_authenticated",
        };
      }

      const { data, error } = await aisha.rpc("get_chat_access_level");

      if (error) {
        safeError("useAiChat.getAccessLevel", error);
        throw new Error(error.message);
      }

      return ChatAccessResponseSchema.parse(data);
    },
    enabled: !!session?.user?.id,
    staleTime: 60000, // 1 minute
  });

  // ----------------------------------------
  // RPC: Fetch conversations list
  // ----------------------------------------
  const conversationsQuery = useQuery({
    queryKey: ["chat-conversations", session?.user?.id],
    queryFn: async (): Promise<Conversation[]> => {
      if (!session?.user?.id) return [];

      const { data, error } = await aisha.rpc("get_my_chat_conversations", {
        p_limit: 50,
        p_status: "active",
      });

      if (error) {
        safeError("useAiChat.fetchConversations", error);
        throw new Error(error.message);
      }

      // RPC returns JSONB array
      const parsed = z.array(ConversationSchema).safeParse(data || []);
      if (!parsed.success) {
        safeError("useAiChat.parseConversations", parsed.error);
        safeError("useAiChat.parseConversations.dropped", { count: (data as unknown[])?.length ?? 0, issues: parsed.error.issues.length });
        return [];
      }

      return parsed.data;
    },
    enabled: !!session?.user?.id,
    staleTime: 30000,
  });

  // ----------------------------------------
  // RPC: Fetch messages for active conversation
  // ----------------------------------------
  const messagesQuery = useQuery({
    queryKey: ["chat-messages", activeConversationId],
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!activeConversationId) return [];

      const { data, error } = await aisha.rpc("get_chat_messages_audited", {
        p_conversation_id: activeConversationId,
      });

      if (error) {
        safeError("useAiChat.fetchMessages", error);
        throw new Error(error.message);
      }

      const parsed = z.array(ChatMessageSchema).safeParse(data || []);
      if (!parsed.success) {
        safeError("useAiChat.parseMessages", parsed.error);
        safeError("useAiChat.parseMessages.dropped", { conversationId: activeConversationId, count: (data as unknown[])?.length ?? 0, issues: parsed.error.issues.length });
        return [];
      }

      return parsed.data;
    },
    enabled: !!activeConversationId,
    staleTime: 10000,
  });

  // ----------------------------------------
  // MUTATION: Send message via edge function
  // ----------------------------------------
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string): Promise<ChatResponse> => {
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Check access before sending
      const access = accessQuery.data;
      if (!access?.can_chat && !options.debugMode) {
        throw new Error(access?.block_reason || "Chat access denied");
      }

      safeInfo("useAiChat.sendMessage", "Sending message to AI");

      const { data: rawData, error } = await aisha.functions.invoke("ai-chat", {
        body: {
          conversation_id: activeConversationId,
          message,
          language: requestLanguage,
          debug: options.debugMode ?? false,
        },
      });
      const data = rawData as RawChatInvokeResponse;

      if (error) {
        safeError("useAiChat.sendMessage.invoke", error);
        throw await toInvokeError(error);
      }

      if (data?.error) {
        const err = new Error(data.error);
        if (Array.isArray(data.debug)) {
          (err as Error & { debug?: ChatDebugEvent[] }).debug = data.debug as ChatDebugEvent[];
        }
        throw err;
      }

      // Ensure message.id exists — fallback when server-side save failed
      if (data?.message && !data.message.id) {
        data.message.id = createClientMessageId();
      }

      try {
        return ChatResponseSchema.parse(data);
      } catch (parseError) {
        // Preserve debug data on Zod validation failure
        if (Array.isArray(data?.debug)) {
          (parseError as Error & { debug?: ChatDebugEvent[] }).debug = data.debug as ChatDebugEvent[];
        }
        throw parseError;
      }
    },
    onMutate: async (message): Promise<SendMessageContext> => {
      const queryKey = ["chat-messages", activeConversationId] as const;
      await queryClient.cancelQueries({ queryKey });

      const currentMessages = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
      const optimisticMessage: ChatMessage = {
        id: createClientMessageId(),
        role: "user",
        content: message,
        routing_category: "",
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<ChatMessage[]>(queryKey, [...currentMessages, optimisticMessage]);

      return { queryKey, optimisticMessage };
    },
    onSuccess: (data, _message, context) => {
      const targetQueryKey = ["chat-messages", data.conversation_id] as const;
      const targetMessages = queryClient.getQueryData<ChatMessage[]>(targetQueryKey) ?? [];

      // Step 2 UI: surface the tracer run id from response metadata onto the
      // assistant ChatMessage so downstream components (FaithfulnessChip,
      // CitationPanel, dual-write FeedbackButtons) can resolve per-run RPCs.
      // metadata.run_id is the tracer.runId that became public.ai_runs.id at
      // the start of the /chat handler (svc-ai-chat/src/routes/chat.ts).
      const assistantMessage: ChatMessage = {
        ...data.message,
        ai_run_id: data.metadata?.run_id ?? data.metadata?.aisha_run_id ?? null,
      };

      // Collect assistant messages
      const newMessages: ChatMessage[] = [assistantMessage];
      newMessages.push(...toDebugMessages(data.debug ?? []));

      // Ensure freshly-created conversations show the just-sent user message immediately.
      if (targetMessages.length === 0 && context?.optimisticMessage) {
        queryClient.setQueryData<ChatMessage[]>(targetQueryKey, [
          context.optimisticMessage,
          ...newMessages,
        ]);
      } else {
        queryClient.setQueryData<ChatMessage[]>(targetQueryKey, [
          ...targetMessages,
          ...newMessages,
        ]);
      }

      // Update active conversation if newly created
      if (!activeConversationId && data.conversation_id) {
        setActiveConversationId(data.conversation_id);
      }

      // Only invalidate conversations list (for sidebar count/title updates).
      // Do NOT invalidate messages — the cache was just set with the correct data.
      // A refetch would lose assistant messages if save_chat_message_audited failed on server.
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: (error, _message, context) => {
      if (context?.queryKey) {
        const errorText = error instanceof Error ? error.message : "An unexpected error occurred";
        const currentMessages = queryClient.getQueryData<ChatMessage[]>(context.queryKey) ?? [];
        const debugEvents = (error as Error & { debug?: ChatDebugEvent[] }).debug ?? [];

        const assistantErrorMessage: ChatMessage = {
          id: createClientMessageId(),
          role: "assistant",
          content: errorText,
          routing_category: "",
          created_at: new Date().toISOString(),
        };

        queryClient.setQueryData<ChatMessage[]>(context.queryKey, [
          ...currentMessages,
          ...toDebugMessages(debugEvents),
          assistantErrorMessage,
        ]);
      }

      safeError("useAiChat.sendMessage.error", error);
    },
  });

  // ----------------------------------------
  // MUTATION: Archive conversation via RPC
  // ----------------------------------------
  const archiveConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await aisha.rpc("archive_chat_conversation_audited", {
        p_conversation_id: conversationId,
      });

      if (error) {
        safeError("useAiChat.archiveConversation", error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (activeConversationId) {
        startNewConversation();
      }
    },
  });

  // ----------------------------------------
  // ACTIONS
  // ----------------------------------------
  const startNewConversation = useCallback(() => {
    setActiveConversationId(undefined);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  // ----------------------------------------
  // STATE: Aisha typing indicator
  // ----------------------------------------
  const [aishaIsTyping, setAishaIsTyping] = useState(false);
  const aishaTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----------------------------------------
  // REALTIME: Subscribe to async Aisha messages
  // ----------------------------------------
  const realtimeChannelRef = useRef<ReturnType<typeof aisha.channel> | null>(null);

  useEffect(() => {
    if (!activeConversationId) return;

    // Clean up previous subscription
    if (realtimeChannelRef.current) {
      aisha.removeChannel(realtimeChannelRef.current);
    }

    const channel = aisha
      .channel(`chat-messages-${activeConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row) return;

          // Only process async Aisha messages — skip messages we already have from mutations
          if (row.routing_category !== "aisha_dirigent") return;

          // Step 2 systemic follow-up: extract ai_run_id from existing
          // content_metadata jsonb (no new column) so realtime-delivered
          // Aisha messages also get FaithfulnessChip + CitationPanel.
          // Mirror of get_chat_messages_audited fallback chain (run_id
          // primary, aisha_run_id secondary).
          const contentMetadata = (row.content_metadata ?? {}) as Record<string, unknown>;
          const aiRunId =
            (typeof contentMetadata.run_id === "string" && contentMetadata.run_id) ||
            (typeof contentMetadata.aisha_run_id === "string" && contentMetadata.aisha_run_id) ||
            null;

          const parsed = ChatMessageSchema.safeParse({
            id: row.id,
            role: row.role,
            content: row.content,
            routing_category: row.routing_category,
            created_at: row.created_at,
            ai_run_id: aiRunId,
          });

          if (!parsed.success) {
            safeError("useAiChat.realtimeParse.dropped", { messageId: row.id, issues: parsed.error.issues.length });
            return;
          }

          const queryKey = ["chat-messages", activeConversationId] as const;
          const existing = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];

          // Deduplicate — don't add if already in cache
          if (existing.some((m) => m.id === parsed.data.id)) return;

          // Clear Aisha typing indicator on receipt of async message
          setAishaIsTyping(false);
          if (aishaTypingTimeoutRef.current) {
            clearTimeout(aishaTypingTimeoutRef.current);
            aishaTypingTimeoutRef.current = null;
          }

          queryClient.setQueryData<ChatMessage[]>(queryKey, [...existing, parsed.data]);
        },
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      aisha.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, [activeConversationId, queryClient]);

  return {
    // Access control
    canChat: accessQuery.data?.can_chat ?? false,
    accessLevel: accessQuery.data?.access_level ?? "none",
    blockReason: accessQuery.data?.block_reason,
    accessLoading: accessQuery.isLoading,

    // State
    activeConversationId,

    // Queries
    conversations: conversationsQuery.data || [],
    conversationsLoading: conversationsQuery.isLoading,
    messages: messagesQuery.data || [],
    messagesLoading: messagesQuery.isLoading,

    // Mutations
    sendMessage: sendMessageMutation.mutateAsync,
    isSending: sendMessageMutation.isPending,
    aishaIsTyping,
    sendError: sendMessageMutation.error,
    sendErrorMessage: sendMessageMutation.error instanceof Error
      ? sendMessageMutation.error.message
      : null,
    clearSendError: sendMessageMutation.reset,

    // Actions
    startNewConversation,
    selectConversation,
    archiveConversation: archiveConversationMutation.mutateAsync,

    // Refetch
    refetchMessages: messagesQuery.refetch,
    refetchConversations: conversationsQuery.refetch,
    refetchAccess: accessQuery.refetch,
  };
}

/**
 * AISHA Chat hook — conversational interface with the AI orchestrator.
 * Supports story-contextual chat and development instructions.
 *
 * Transport: the svc-ai-chat `/functions/v1/ai-chat` handler replies with a
 * single `application/json` object (`{ conversation_id, message: { content } }`),
 * NOT a `text/event-stream`. This client parses that one JSON body — client and
 * server must agree on the wire transport (see the M2 transport-consistency gate).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/config/oidc";
import { api, getBackendUrl } from "@/config/api";
import { chatMessageSchema, chatConversationSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { ChatMessage, ChatConversation } from "@/types/schemas";

function parseConversationArray(data: unknown): ChatConversation[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<ChatConversation[]>((acc, item) => {
    const result = chatConversationSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

function parseMessageArray(data: unknown): ChatMessage[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<ChatMessage[]>((acc, item) => {
    const result = chatMessageSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

/** List conversations */
export function useConversations(userId: string | undefined) {
  return useQuery({
    queryKey: ["conversations", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_chat_conversations", {});
      if (error) {
        safeError("useConversations.fetch", error);
        throw error;
      }
      return parseConversationArray(data);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/** Get messages for a conversation */
export function useChatMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["chat-messages", conversationId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_chat_messages_audited", {
        p_conversation_id: conversationId!,
      });
      if (error) {
        safeError("useChatMessages.fetch", error);
        throw error;
      }
      return parseMessageArray(data);
    },
    enabled: !!conversationId,
    staleTime: 30 * 1000,
  });
}

/** Send a message to AISHA via edge function */
export function useSendMessage() {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState<string>("");

  const mutation = useMutation({
    mutationFn: async ({
      conversationId,
      content,
      storyId,
    }: {
      conversationId?: string;
      content: string;
      storyId?: string;
    }) => {
      setStreamingContent("");

      const token = await getAccessToken();

      if (!token) {
        throw new Error("Not authenticated");
      }

      // Call the ai-chat edge function. The handler returns a single JSON
      // object (not an SSE stream), so we parse one body — no `data:` frames.
      const baseUrl = await getBackendUrl();

      const response = await fetch(`${baseUrl}/functions/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: content,
          story_id: storyId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      // Only a 200 carries a completed reply. The server answers 202 when the
      // turn is DEFERRED — governance approval (fn_admit_clow='ask') or the
      // async reflection lane for complex prompts — with a body that has no
      // message content. Surface that explicitly instead of rendering an empty
      // assistant bubble and silently losing the turn.
      if (response.status === 202) {
        throw new Error(
          "AISHA is processing your request — the reply will appear once it is ready.",
        );
      }

      // Shape mirrors services/svc-ai-chat/src/routes/chat.ts success payload:
      //   { conversation_id, message: { content, ... }, metadata: { ... } }
      const payload = (await response.json()) as {
        conversation_id?: string;
        message?: { content?: string };
      };

      const replyContent = payload.message?.content ?? "";
      // On a brand-new conversation the server mints the id — surface it so the
      // caller can adopt it and the right query keys get invalidated.
      const resolvedConversationId = payload.conversation_id ?? conversationId;

      // Reveal the full reply for the brief window before the persisted message
      // list refetches (keeps the existing streamingContent consumer contract).
      setStreamingContent(replyContent);

      return { conversationId: resolvedConversationId, content: replyContent };
    },
    onSuccess: (data) => {
      if (data.conversationId) {
        queryClient.invalidateQueries({
          queryKey: ["chat-messages", data.conversationId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setStreamingContent("");
    },
    onError: (error) => {
      safeError("useSendMessage.failed", error);
      setStreamingContent("");
    },
  });

  return {
    ...mutation,
    streamingContent,
  };
}

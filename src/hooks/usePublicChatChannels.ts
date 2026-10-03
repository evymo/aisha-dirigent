import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import type { Json } from "@/integrations/db/types";

// ============================================================================
// Schemas
// ============================================================================

const PublicChatChannelSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  channel_type: z.string(),
  status: z.string(),
  context_profile: z.string(),
  system_prompt: z.string(),
  model: z.string(),
  temperature: z.number(),
  max_tokens: z.number(),
  personality_enabled: z.boolean(),
  webhook_url: z.string().nullable(),
  webhook_secret: z.string().nullable(),
  guardrails: z.unknown(),
  routing_rules: z.unknown(),
  allowed_tools: z.unknown(),
  widget_config: z.unknown(),
  lead_capture: z.unknown(),
  total_sessions: z.number(),
  total_messages: z.number(),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  model_settings: z.unknown(),
  vector_store_config: z.unknown(),
});

const ChannelHistorySchema = z.object({
  id: z.string().uuid(),
  channel_id: z.string().uuid(),
  version: z.number(),
  configuration_snapshot: z.unknown(),
  change_summary: z.string().nullable(),
  changed_by: z.string().nullable(),
  changed_at: z.string(),
});

const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  channel_id: z.string().uuid(),
  visitor_id: z.string(),
  visitor_metadata: z.unknown(),
  status: z.string(),
  message_count: z.number(),
  last_message_at: z.string().nullable(),
  lead_captured: z.boolean(),
  escalated_to: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PublicChatChannel = z.infer<typeof PublicChatChannelSchema>;
export type ChannelHistory = z.infer<typeof ChannelHistorySchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export interface ChannelUpsertInput {
  id?: string;
  slug?: string;
  display_name?: string;
  channel_type?: string;
  status?: string;
  context_profile?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  model_settings?: Json | null;
  vector_store_config?: Json | null;
  personality_enabled?: boolean;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  guardrails?: Json | null;
  routing_rules?: Json | null;
  allowed_tools?: Json | null;
  widget_config?: Json | null;
  lead_capture?: Json | null;
  change_summary?: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all public chat channels (admin).
 */
export function usePublicChatChannels() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["public-chat-channels", user?.id],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_public_chat_channels_admin");
      if (error) {
        safeError("usePublicChatChannels.fetch", error);
        throw new Error(error.message);
      }
      return z.array(PublicChatChannelSchema).parse(data || []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30000,
  });
}

/**
 * Fetch sessions for a specific channel.
 */
export function usePublicChatSessions(channelId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["public-chat-sessions", channelId],
    queryFn: async () => {
      if (!channelId || !isAdmin) return [];
      const { data, error } = await aisha.rpc("get_public_chat_sessions_admin", {
        p_channel_id: channelId,
      });
      if (error) {
        safeError("usePublicChatSessions.fetch", error);
        throw new Error(error.message);
      }
      return z.array(ChatSessionSchema).parse(data || []);
    },
    enabled: !!user && !!channelId && isAdmin,
  });
}

/**
 * Fetch channel config history.
 */
export function usePublicChatChannelHistory(channelId: string | undefined) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["public-chat-channel-history", channelId],
    queryFn: async () => {
      if (!channelId || !isAdmin) return [];
      const { data, error } = await aisha.rpc("get_public_chat_channel_history_admin", {
        p_channel_id: channelId,
      });
      if (error) {
        safeError("usePublicChatChannelHistory.fetch", error);
        throw new Error(error.message);
      }
      return z.array(ChannelHistorySchema).parse(data || []);
    },
    enabled: !!user && !!channelId && isAdmin,
  });
}

/**
 * Upsert (create or update) a public chat channel.
 */
export function useUpsertPublicChatChannel() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "upsert_public_chat_channel",
      async (input: ChannelUpsertInput) => {
        const { data, error } = await aisha.rpc("upsert_public_chat_channel", {
          p_allowed_tools: input.allowed_tools ?? null,
          p_change_summary: input.change_summary ?? "Configuration updated",
          p_channel_type: input.channel_type ?? "web_widget",
          p_context_profile: input.context_profile ?? "public_chat",
          p_display_name: input.display_name ?? undefined,
          p_guardrails: input.guardrails ?? null,
          p_id: input.id ?? undefined,
          p_lead_capture: input.lead_capture ?? null,
          p_max_tokens: input.max_tokens ?? undefined,
          p_model: input.model ?? undefined,
          p_model_settings: input.model_settings ?? null,
          p_personality_enabled: input.personality_enabled ?? true,
          p_routing_rules: input.routing_rules ?? null,
          p_slug: input.slug ?? undefined,
          p_status: input.status ?? "draft",
          p_system_prompt: input.system_prompt ?? undefined,
          p_temperature: input.temperature ?? undefined,
          p_vector_store_config: input.vector_store_config ?? null,
          p_webhook_secret: input.webhook_secret ?? undefined,
          p_webhook_url: input.webhook_url ?? undefined,
          p_widget_config: input.widget_config ?? null,
        });

        if (error) {
          safeError("useUpsertPublicChatChannel.mutate", error);
          throw new Error(error.message);
        }

        return data as string; // Returns channel UUID
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-chat-channels"] });
    },
  });
}

/**
 * Toggle channel status (active/paused).
 */
export function useToggleChannelStatus() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "upsert_public_chat_channel",
      async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
        const newStatus = currentStatus === "active" ? "paused" : "active";
        const { data, error } = await aisha.rpc("upsert_public_chat_channel", {
          p_change_summary: `Status changed to ${newStatus}`,
          p_id: id,
          p_status: newStatus,
        });

        if (error) {
          safeError("useToggleChannelStatus.mutate", error);
          throw new Error(error.message);
        }

        return data;
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-chat-channels"] });
    },
  });
}

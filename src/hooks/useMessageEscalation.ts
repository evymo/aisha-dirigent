import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import type { Json } from "@/integrations/db/types";

const EscalationTypeSchema = z.enum([
  "clarification",
  "follow_up",
  "concern",
  "incorrect_info",
  "other",
]);

const EscalationStatusSchema = z.enum([
  "pending",
  "viewed",
  "in_progress",
  "resolved",
  "dismissed",
]);

const EscalationSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  partner_id: z.string().uuid(),
  escalation_type: EscalationTypeSchema,
  user_note: z.string().nullable(),
  status: EscalationStatusSchema,
  priority: z.string(),
  partner_response: z.string().nullable(),
  partner_responded_at: z.string().nullable(),
  created_at: z.string(),
});

const PartnerEscalationSchema = EscalationSchema.extend({
  context_messages: z.unknown(),
});

export type EscalationType = z.infer<typeof EscalationTypeSchema>;
export type EscalationStatus = z.infer<typeof EscalationStatusSchema>;
export type Escalation = z.infer<typeof EscalationSchema>;

interface CreateEscalationParams {
  messageId: string;
  conversationId: string;
  partnerId: string;
  escalationType: EscalationType;
  userNote?: string;
  contextMessages?: Array<{ role: string; content: string }>;
}

/**
 * Hook for users to manage message escalations.
 * Uses RPC-only pattern with SECURITY DEFINER.
 *
 * @returns Object containing escalations list, loading state, and create function.
 */
export function useMessageEscalation() {
  const { session } = useSession();
  const queryClient = useQueryClient();

  // Fetch user's escalations via RPC
  const escalationsQuery = useQuery({
    queryKey: ["message-escalations", session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return [];

      const { data, error } = await aisha.rpc("get_user_escalations", {
        p_user_id: session.user.id,
      });

      if (error) {
        safeError("useMessageEscalation.fetch", error);
        throw new Error(error.message);
      }

      return z.array(EscalationSchema).parse(data || []);
    },
    enabled: !!session?.user?.id,
    staleTime: 60000,
  });

  // Create escalation via RPC
  const createEscalation = useMutation({
    mutationFn: async (params: CreateEscalationParams) => {
      if (!session?.user?.id) {
        throw new Error("Not authenticated");
      }

      const { data, error } = await aisha.rpc("create_message_escalation", {
        p_context_messages: (params.contextMessages || []) as unknown as Json
,
        p_conversation_id: params.conversationId,
        p_escalation_type: params.escalationType,
        p_message_id: params.messageId,
        p_partner_id: params.partnerId,
        p_user_note: params.userNote
    });

      if (error) {
        safeError("useMessageEscalation.create", error);
        throw new Error(error.message);
      }

      return { id: data };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-escalations"] });
    },
  });

  return {
    escalations: escalationsQuery.data || [],
    isLoading: escalationsQuery.isLoading,
    createEscalation: createEscalation.mutateAsync,
    isCreating: createEscalation.isPending,
    refetch: escalationsQuery.refetch,
  };
}

/**
 * Hook for partners to view and respond to escalations.
 * Uses RPC-only pattern with SECURITY DEFINER.
 *
 * @param partnerId - The ID of the partner.
 * @returns Object containing escalations list, loading state, and mutation functions.
 */
export function usePartnerEscalations(partnerId?: string) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  const escalationsQuery = useQuery({
    queryKey: ["partner-escalations", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];

      const { data, error } = await aisha.rpc("get_partner_escalations", {
        p_partner_id: partnerId,
      });

      if (error) {
        safeError("usePartnerEscalations.fetch", error);
        throw new Error(error.message);
      }

      return z.array(PartnerEscalationSchema).parse(data || []);
    },
    enabled: !!partnerId && !!session?.user?.id,
    staleTime: 30000,
  });

  const respondToEscalation = useMutation({
    mutationFn: guardAdminMutation("respond_to_escalation_admin", async (params: {
      escalationId: string;
      response: string;
      newStatus: EscalationStatus;
    }) => {
      const { error } = await aisha.rpc("respond_to_escalation_admin", {
        p_escalation_id: params.escalationId,
        p_new_status: params.newStatus
,
        p_response: params.response
    });

      if (error) {
        safeError("usePartnerEscalations.respond", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-escalations"] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: guardAdminMutation("update_escalation_status_admin", async (params: { escalationId: string; status: EscalationStatus }) => {
      const { error } = await aisha.rpc("update_escalation_status_admin", {
        p_escalation_id: params.escalationId,
        p_status: params.status,
      });

      if (error) {
        safeError("usePartnerEscalations.updateStatus", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-escalations"] });
    },
  });

  return {
    escalations: escalationsQuery.data || [],
    isLoading: escalationsQuery.isLoading,
    respondToEscalation: respondToEscalation.mutateAsync,
    updateStatus: updateStatus.mutateAsync,
    refetch: escalationsQuery.refetch,
  };
}

/**
 * Hook for user rating of AI chat messages.
 *
 * Allows users to rate AI responses with thumbs up/down (-1, 0, 1)
 * and optional text feedback.
 *
 * @module hooks/useRateChatMessage
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Hook to submit user rating for an AI assistant message.
 *
 * @returns Mutation for rating a chat message
 *
 * @example
 * ```tsx
 * const { mutateAsync: rateMessage } = useRateChatMessage();
 *
 * // Thumbs up
 * await rateMessage({ message_id: "uuid", rating: 1 });
 *
 * // Thumbs down with feedback
 * await rateMessage({ message_id: "uuid", rating: -1, feedback: "Not helpful" });
 * ```
 */
export function useRateChatMessage() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      message_id: string;
      rating: -1 | 0 | 1;
      feedback?: string;
    }): Promise<void> => {
      if (!user) throw new Error("Authentication required");

      const { error } = await aisha.rpc("rate_chat_message", {
        p_feedback: input.feedback ?? undefined,
      
        p_message_id: input.message_id,
        p_rating: input.rating,});

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
    onError: (error) => {
      safeError("useRateChatMessage.failed", error);
    },
  });
}

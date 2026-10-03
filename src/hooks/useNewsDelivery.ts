import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

/**
 * Hook that delivers pending news articles to the user's chat as Aisha messages.
 *
 * Call `deliverNews()` when the chat widget opens. Idempotent — already-delivered
 * articles are skipped via `news_article_deliveries` tracking table.
 *
 * @returns Object with `deliverNews` callback, loading state, and delivery count.
 *
 * @example
 * const { deliverNews, isDelivering } = useNewsDelivery();
 * useEffect(() => { if (isOpen) deliverNews(); }, [isOpen]);
 */
export function useNewsDelivery() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const deliveredRef = useRef(false);

  const mutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!session?.user?.id) return 0;

      const { data, error } = await aisha.rpc("deliver_pending_news_to_chat");

      if (error) {
        safeError("useNewsDelivery", error);
        throw new Error(error.message);
      }

      return (data as number) ?? 0;
    },
    onSuccess: (count) => {
      if (count > 0) {
        safeInfo("useNewsDelivery", `Delivered ${count} news articles to chat`);
        // Invalidate chat queries so new messages appear
        queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
        queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      }
    },
    onError: (error) => {
      safeError("useNewsDelivery.error", error);
    },
  });

  const deliverNews = useCallback(() => {
    if (!session?.user?.id || deliveredRef.current || mutation.isPending) return;
    deliveredRef.current = true;
    mutation.mutate();
  }, [session?.user?.id, mutation]);

  return {
    deliverNews,
    isDelivering: mutation.isPending,
    deliveredCount: mutation.data ?? 0,
  };
}

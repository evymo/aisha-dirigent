import { useEffect, useRef } from "react";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { useRewardNotification } from "@/components/gamification/RewardNotification";
import type { RewardTokenType } from "@/components/gamification/RewardNotification";
import { safeInfo } from "@/lib/security/safeLogger";

/**
 * Hook that subscribes to token_transactions realtime channel
 * and shows reward notifications when new tokens are awarded.
 * 
 * Should be used in a layout component (e.g., MemberLayout) to
 * enable notifications across the member portal.
 */
export function useTokenRewardNotification() {
  const { user } = useSession();
  const { showReward } = useRewardNotification();
  const channelRef = useRef<ReturnType<typeof aisha.channel> | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    // Subscribe to token_transactions for the current user
    const channel = aisha
      .channel(`token-rewards-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "token_transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newRecord = payload.new as {
            token_type?: string;
            amount?: number;
            description?: string;
            transaction_type?: string;
          };

          // Only show notification for positive amounts (rewards)
          if (newRecord.amount && newRecord.amount > 0) {
            const tokenType = (newRecord.token_type || "impact") as RewardTokenType;
            
            safeInfo("token.reward.received", {
              type: tokenType,
              amount: newRecord.amount,
            });

            showReward({
              tokenType,
              amount: newRecord.amount,
              reason: newRecord.description || undefined,
            });
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        aisha.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, showReward]);
}

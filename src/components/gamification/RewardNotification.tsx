/**
 * RewardNotification - Toast notification for earned rewards
 */

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Award, Coins, Database } from "lucide-react";

export type RewardTokenType = "governance" | "impact" | "data";

interface RewardNotificationOptions {
  tokenType: RewardTokenType;
  amount: number;
  reason?: string;
}

const tokenIcons = {
  governance: Award,
  impact: Coins,
  data: Database,
};

const tokenColors = {
  governance: "text-chart-1",
  impact: "text-chart-2",
  data: "text-chart-3",
};

/**
 * Show a toast notification for a token reward
 */
export function showRewardNotification(options: RewardNotificationOptions) {
  const { tokenType, amount, reason } = options;
  const Icon = tokenIcons[tokenType];

  toast.success(
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-full bg-background ${tokenColors[tokenType]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="font-medium">
          +{amount} {tokenType} tokenů
        </div>
        {reason && (
          <div className="text-sm text-muted-foreground">{reason}</div>
        )}
      </div>
    </div>,
    {
      duration: 5000,
    }
  );
}

/**
 * Hook for showing reward notifications with i18n
 */
export function useRewardNotification() {
  const { t } = useTranslation();

  const showReward = (options: RewardNotificationOptions) => {
    const { tokenType, amount, reason } = options;
    const Icon = tokenIcons[tokenType];

    const tokenLabel = t(`gamification.widget.${tokenType}`, tokenType);
    const reasonText = reason
      ? t("gamification.reward.reason", { reason })
      : undefined;

    toast.success(
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-full bg-background ${tokenColors[tokenType]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium">
            {t("gamification.reward.earned", {
              amount,
              type: tokenLabel,
            })}
          </div>
          {reasonText && (
            <div className="text-sm text-muted-foreground">{reasonText}</div>
          )}
        </div>
      </div>,
      {
        duration: 5000,
      }
    );
  };

  return { showReward };
}

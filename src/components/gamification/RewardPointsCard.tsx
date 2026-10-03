/**
 * RewardPointsCard — Display reward points earned from questionnaires,
 * check-ins, and other activities (from token_allocations system).
 *
 * Separate from governance/impact/data membership tokens.
 */

import { useTranslation } from "react-i18next";
import { Star, Flame, TrendingUp, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGamificationStats } from "@/hooks/useGamificationStats";
import { cn } from "@/lib/utils";

interface RewardPointsCardProps {
  className?: string;
}

/**
 * Card displaying reward points, streaks, and weekly/monthly totals.
 *
 * @example
 * <RewardPointsCard className="col-span-1" />
 */
export function RewardPointsCard({ className }: RewardPointsCardProps) {
  const { t } = useTranslation();
  const { stats, isLoading } = useGamificationStats();

  if (isLoading) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardContent className="p-4">
          <div className="h-24 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total_points === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500" />
            {t("gamification.rewardPoints.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            {t("gamification.rewardPoints.noData")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500" />
            {t("gamification.rewardPoints.title")}
          </span>
          <span className="text-2xl font-bold text-primary">{stats.total_points}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-500" />
              <span className="text-muted-foreground">
                {t("gamification.rewardPoints.weeklyPoints")}
              </span>
            </div>
            <span className="font-medium">{stats.weekly_points}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {t("gamification.rewardPoints.monthlyPoints")}
              </span>
            </div>
            <span className="font-medium">{stats.monthly_points}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-muted-foreground">
                {t("gamification.rewardPoints.currentStreak")}
              </span>
            </div>
            <span className="font-medium">
              {stats.current_streak} {t("gamification.rewardPoints.days")}
            </span>
          </div>

          {stats.best_streak > stats.current_streak && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t("gamification.rewardPoints.bestStreak")}
                </span>
              </div>
              <span className="font-medium text-muted-foreground">
                {stats.best_streak} {t("gamification.rewardPoints.days")}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

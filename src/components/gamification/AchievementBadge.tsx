/**
 * AchievementBadge - Visual badge for milestones
 */

import { useTranslation } from "react-i18next";
import { Trophy, Star, Flame, Heart, Target, Award } from "lucide-react";
import { cn } from "@/lib/utils";

export type AchievementType =
  | "first_checkin"
  | "week_streak"
  | "month_active"
  | "first_document"
  | "study_completed"
  | "token_milestone";

interface AchievementBadgeProps {
  type: AchievementType;
  unlocked: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const achievementConfig: Record<
  AchievementType,
  {
    icon: typeof Trophy;
    color: string;
    bgColor: string;
    labelKey: string;
  }
> = {
  first_checkin: {
    icon: Heart,
    color: "text-chart-1",
    bgColor: "bg-chart-1/10",
    labelKey: "gamification.achievements.firstCheckin",
  },
  week_streak: {
    icon: Flame,
    color: "text-chart-2",
    bgColor: "bg-chart-2/10",
    labelKey: "gamification.achievements.weekStreak",
  },
  month_active: {
    icon: Star,
    color: "text-chart-3",
    bgColor: "bg-chart-3/10",
    labelKey: "gamification.achievements.monthActive",
  },
  first_document: {
    icon: Target,
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
    labelKey: "gamification.achievements.firstDocument",
  },
  study_completed: {
    icon: Trophy,
    color: "text-chart-5",
    bgColor: "bg-chart-5/10",
    labelKey: "gamification.achievements.studyCompleted",
  },
  token_milestone: {
    icon: Award,
    color: "text-primary",
    bgColor: "bg-primary/10",
    labelKey: "gamification.achievements.tokenMilestone",
  },
};

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const iconSizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export function AchievementBadge({
  type,
  unlocked,
  label,
  size = "md",
  showLabel = true,
  className,
}: AchievementBadgeProps) {
  const { t } = useTranslation();
  const config = achievementConfig[type];
  const Icon = config.icon;

  const displayLabel =
    label || t(config.labelKey, type.replace(/_/g, " "));

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div
        className={cn(
          "rounded-full flex items-center justify-center transition-all duration-300",
          sizeClasses[size],
          unlocked
            ? cn(config.bgColor, config.color, "ring-2 ring-current/20")
            : "bg-muted text-muted-foreground opacity-50 grayscale"
        )}
      >
        <Icon className={iconSizeClasses[size]} />
      </div>
      {showLabel && (
        <span
          className={cn(
            "text-xs text-center max-w-[80px] leading-tight",
            unlocked ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {displayLabel}
        </span>
      )}
    </div>
  );
}

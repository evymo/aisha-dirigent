/**
 * MemberActivityTimeline - Chronological list of member activities with rewards
 */

import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import {
  Heart,
  Coins,
  GraduationCap,
  Pill,
  FileText,
  Activity,
  Filter,
} from "lucide-react";
import { format, Locale } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useMemberActivityTimeline,
  filterActivities,
  type ActivityTimelineItem,
  type ActivityFilter,
} from "@/hooks/useMemberActivities";
import { cn } from "@/lib/utils";

interface MemberActivityTimelineProps {
  limit?: number;
  className?: string;
  maxHeight?: string;
}

const activityIcons: Record<string, typeof Heart> = {
  health_checkin: Heart,
  token_earned: Coins,
  study_enrolled: GraduationCap,
  dosing_logged: Pill,
  document_uploaded: FileText,
};

const activityColors: Record<string, string> = {
  health_checkin: "text-chart-1 bg-chart-1/10",
  token_earned: "text-chart-2 bg-chart-2/10",
  study_enrolled: "text-chart-3 bg-chart-3/10",
  dosing_logged: "text-chart-4 bg-chart-4/10",
  document_uploaded: "text-chart-5 bg-chart-5/10",
};

export function MemberActivityTimeline({
  limit = 50,
  className,
  maxHeight = "400px",
}: MemberActivityTimelineProps) {
  const { t, i18n } = useTranslation();
  const { data: activities, isLoading } = useMemberActivityTimeline(limit);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const dateLocale = getDateFnsLocale(i18n.language);
  const filteredActivities = filterActivities(activities || [], filter);

  const filterOptions: { value: ActivityFilter; label: string }[] = [
    { value: "all", label: t("memberActivity.filter.all") },
    { value: "health", label: t("memberActivity.filter.tracking") },
    { value: "tokens", label: t("memberActivity.filter.tokens") },
    {
      value: "documents",
      label: t("memberActivity.filter.documents"),
    },
    { value: "studies", label: t("memberActivity.filter.studies") },
  ];

  if (isLoading) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardContent className="p-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {t("memberActivity.title")}
          </CardTitle>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-1" />
                {filterOptions.find((f) => f.value === filter)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {filterOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent>
        {filteredActivities.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {t("memberActivity.empty")}
          </div>
        ) : (
          <ScrollArea style={{ maxHeight }}>
            <div className="space-y-4">
              {filteredActivities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  dateLocale={dateLocale}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityItemProps {
  activity: ActivityTimelineItem;
  dateLocale: Locale;
}

function ActivityItem({ activity, dateLocale }: ActivityItemProps) {
  const { t } = useTranslation();
  const Icon = activityIcons[activity.activity_type] || Activity;
  const colorClass = activityColors[activity.activity_type] || "text-muted-foreground bg-muted";

  const typeLabel = t(
    `memberActivity.types.${activity.activity_type}`,
    activity.activity_type.replace(/_/g, " ")
  );

  const hasReward =
    activity.token_reward_amount > 0 && activity.token_reward_type;

  return (
    <div className="flex items-start gap-3">
      <div className={cn("rounded-full p-2 shrink-0", colorClass)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{activity.title}</span>
          {hasReward && (
            <Badge variant="secondary" className="text-xs shrink-0">
              +{activity.token_reward_amount} {activity.token_reward_type}
            </Badge>
          )}
        </div>

        {activity.description && (
          <p className="text-sm text-muted-foreground truncate">
            {activity.description}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs">
            {typeLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {format(new Date(activity.created_at), "d. MMM yyyy, HH:mm", {
              locale: dateLocale,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

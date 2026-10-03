/**
 * GamificationWidget - Compact token balance display for sidebar/dashboard
 */

import { useTranslation } from "react-i18next";
import { Coins, Award, Database, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTokens } from "@/hooks/useTokens";
import { cn } from "@/lib/utils";

interface GamificationWidgetProps {
  onViewAll?: () => void;
  className?: string;
  compact?: boolean;
}

export function GamificationWidget({
  onViewAll,
  className,
  compact = false,
}: GamificationWidgetProps) {
  const { t } = useTranslation();
  const { balance, totalTokens, loading } = useTokens();

  if (loading) {
    return (
      <Card className={cn("animate-pulse", className)}>
        <CardContent className="p-4">
          <div className="h-16 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const tokenItems = [
    {
      type: "governance",
      label: t("gamification.widget.governance"),
      value: balance.governance,
      icon: Award,
      color: "text-chart-1",
    },
    {
      type: "impact",
      label: t("gamification.widget.impact"),
      value: balance.impact,
      icon: Coins,
      color: "text-chart-2",
    },
    {
      type: "data",
      label: t("gamification.widget.data"),
      value: balance.data,
      icon: Database,
      color: "text-chart-3",
    },
  ];

  if (compact) {
    return (
      <div className={cn("flex items-center gap-4", className)}>
        <Coins className="h-5 w-5 text-primary" />
        <span className="font-medium">{totalTokens}</span>
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span>{t("gamification.widget.title")}</span>
          <span className="text-2xl font-bold text-primary">{totalTokens}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {tokenItems.map((item) => (
            <div
              key={item.type}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <item.icon className={cn("h-4 w-4", item.color)} />
                <span className="text-muted-foreground">{item.label}</span>
              </div>
              <span className="font-medium">{item.value}</span>
            </div>
          ))}
        </div>

        {onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 text-xs"
            onClick={onViewAll}
          >
              {t("gamification.widget.viewAll")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

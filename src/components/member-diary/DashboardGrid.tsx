/**
 * Dashboard Grid
 * Drag & drop grid for member diary widgets
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pill,
  Heart,
  Clock,
  Plus,
  Package,
  LayoutGrid,
} from "lucide-react";
import { format } from "date-fns";
import type { MemberDashboardWidget, MemberProductPlan, MemberTrackingState } from "@/lib/schemas/memberDiarySchemas";
import { LongevityScoreCard } from "@/components/tracking/LongevityScoreCard";

interface DashboardGridProps {
  widgets: MemberDashboardWidget[];
  plans: MemberProductPlan[];
  healthStates: MemberTrackingState[];
  onWidgetClick: (widget: MemberDashboardWidget) => void;
  onAddWidget: () => void;
}

export function DashboardGrid({
  widgets,
  plans,
  healthStates,
  onWidgetClick,
  onAddWidget,
}: DashboardGridProps) {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  const getWidgetData = (widget: MemberDashboardWidget) => {
    if (widget.widget_type === "product" && widget.reference_id) {
      return plans.find((p) => p.id === widget.reference_id);
    }
    if (widget.widget_type === "health_state" && widget.reference_id) {
      return healthStates.find((s) => s.id === widget.reference_id);
    }
    return null;
  };

  const renderProductWidget = (widget: MemberDashboardWidget, plan: MemberProductPlan) => {
    const lastTaken = plan.last_taken_at
      ? format(new Date(plan.last_taken_at), "d. M. HH:mm", { locale })
      : t("memberDiary.never");

    return (
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => onWidgetClick(widget)}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Pill className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                {plan.product_name || plan.product_name || t("memberDiary.unknownProduct")}
              </p>
              <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{lastTaken}</span>
              </div>
              {plan.remaining_doses !== undefined && plan.remaining_doses !== null && (
                <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                  <Package className="h-3 w-3" />
                  <span>{t("memberDiary.remainingDoses", { count: Math.round(plan.remaining_doses) })}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderTrackingStateWidget = (widget: MemberDashboardWidget, state: MemberTrackingState) => {
    const currentSeverity = state.current_severity;
    const isActive = currentSeverity !== null && currentSeverity !== undefined;
    const severityColor = isActive
      ? currentSeverity >= 4
        ? "text-destructive"
        : currentSeverity >= 2
        ? "text-warning"
        : "text-success"
      : "text-muted-foreground";

    return (
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => onWidgetClick(widget)}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: state.color ? `${state.color}20` : "hsl(var(--muted))" }}
            >
              <Heart
                className="h-5 w-5"
                style={{ color: state.color || "hsl(var(--muted-foreground))" }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">
                {state.custom_name || t(`healthStates.${state.name_key}`, state.name_key)}
              </p>
              <p className={`text-sm mt-1 ${severityColor}`}>
                {isActive
                  ? t("memberDiary.activeSeverity", { level: currentSeverity, max: state.severity_scale })
                  : t("memberDiary.noIssues")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderWidget = (widget: MemberDashboardWidget) => {
    const data = getWidgetData(widget);

    if (widget.widget_type === "product" && data) {
      return renderProductWidget(widget, data as MemberProductPlan);
    }

    if (widget.widget_type === "health_state" && data) {
      return renderTrackingStateWidget(widget, data as MemberTrackingState);
    }

    // Generic widget
    return (
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => onWidgetClick(widget)}
      >
        <CardContent className="p-4">
          <p className="font-medium text-foreground">
            {t(`memberDiary.widgetType.${widget.widget_type}`)}
          </p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Longevity Score Card - Always visible at top */}
      <LongevityScoreCard />
      
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {t("memberDiary.myDashboard")}
        </h2>
        <Button variant="outline" size="sm" onClick={onAddWidget}>
          <Plus className="h-4 w-4 mr-2" />
          {t("memberDiary.addWidget")}
        </Button>
      </div>

      {widgets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <LayoutGrid className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>{t("memberDiary.noWidgets")}</p>
          <Button variant="link" onClick={onAddWidget}>
            {t("memberDiary.addFirstWidget")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {widgets
            .filter((w) => w.is_visible)
            .sort((a, b) => {
              const posA = a.position as { row?: number; col?: number } | null;
              const posB = b.position as { row?: number; col?: number } | null;
              const rowA = posA?.row ?? 0;
              const rowB = posB?.row ?? 0;
              const colA = posA?.col ?? 0;
              const colB = posB?.col ?? 0;
              return rowA - rowB || colA - colB;
            })
            .map((widget) => (
              <div key={widget.id}>{renderWidget(widget)}</div>
            ))}
        </div>
      )}
    </div>
  );
}

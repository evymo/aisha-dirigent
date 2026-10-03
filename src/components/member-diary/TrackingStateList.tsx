/**
 * Tracking State List
 * List of user's tracked health states
 */

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, AlertCircle } from "lucide-react";
import type { MemberTrackingState } from "@/lib/schemas/memberDiarySchemas";

interface TrackingStateListProps {
  healthStates: MemberTrackingState[];
  selectedStateId: string | null;
  onSelectState: (state: MemberTrackingState) => void;
  onAddState: () => void;
  onLogState: (stateId: string) => void;
  isLoading?: boolean;
}

export function TrackingStateList({
  healthStates,
  selectedStateId,
  onSelectState,
  onAddState,
  onLogState,
  isLoading: _isLoading,
}: TrackingStateListProps) {
  const { t } = useTranslation();

  const activeStates = healthStates.filter((s) => s.is_active);

  const getSeverityLabel = (state: MemberTrackingState) => {
    if (state.current_severity === null || state.current_severity === undefined) {
      return { label: t("memberDiary.noIssues"), variant: "secondary" as const };
    }
    const ratio = state.current_severity / (state.severity_scale || 5);
    if (ratio >= 0.8) {
      return { label: t("memberDiary.severityHigh"), variant: "destructive" as const };
    }
    if (ratio >= 0.4) {
      return { label: t("memberDiary.severityMedium"), variant: "outline" as const };
    }
    return { label: t("memberDiary.severityLow"), variant: "secondary" as const };
  };

  const renderState = (state: MemberTrackingState) => {
    const isSelected = selectedStateId === state.id;
    const hasIssue = state.current_severity !== null && state.current_severity !== undefined;
    const severity = getSeverityLabel(state);

    return (
      <div
        key={state.id}
        className={cn(
          "p-3 border-b border-border cursor-pointer transition-colors",
          isSelected ? "bg-accent" : "hover:bg-accent/50"
        )}
        onClick={() => onSelectState(state)}
      >
        <div className="flex items-start gap-3">
          <div
            className="p-2 rounded-lg shrink-0"
            style={{
              backgroundColor: state.color ? `${state.color}20` : "hsl(var(--muted))",
            }}
          >
            <Heart
              className="h-4 w-4"
              style={{ color: state.color || "hsl(var(--muted-foreground))" }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground truncate">
                {state.custom_name || t(`healthStates.${state.name_key}`, state.name_key)}
              </p>
              {hasIssue && (
                <AlertCircle className="h-4 w-4 text-warning shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={severity.variant} className="text-xs">
                {hasIssue
                  ? `${state.current_severity}/${state.severity_scale}`
                  : severity.label}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onLogState(state.id);
            }}
          >
            {t("memberDiary.log")}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddState}>
          <Plus className="h-4 w-4 mr-2" />
          {t("memberDiary.addState")}
        </Button>
      </div>

      {activeStates.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-muted-foreground">
          <div>
            <Heart className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t("memberDiary.noTrackingStates")}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {activeStates.map(renderState)}
        </div>
      )}
    </div>
  );
}

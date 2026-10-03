/**
 * BranchDeployRail — vertical "where it lives" rail for a story.
 *
 * Per app:
 *   branch          (partner_stories.default_branch)
 *      ↓
 *   active slot     (coolify_app_slots.active_slot + image_tag + health)
 *      ↓
 *   last switch     (coolify_app_slots.last_switch_at)
 *      ↓
 *   last rollback   (rollback_history latest per app)
 *
 * Live via useStoryBranchDeployRail (subscribes to coolify_app_slots).
 */
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  Activity,
  ArrowLeftRight,
  Undo2,
  Clock,
} from "lucide-react";

import { useStoryBranchDeployRail } from "@/hooks/useStoryBranchDeployRail";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface BranchDeployRailProps {
  storyId: string;
}

export function BranchDeployRail({ storyId }: BranchDeployRailProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading, error } = useStoryBranchDeployRail({
    storyId,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  if (rows.length === 0) {
    return (
      <Alert data-test="branch-deploy-rail-empty">
        <AlertDescription>
          {t(
            "storyDetail.timeline.railEmpty",
            "No deployed apps linked to this story yet.",
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3" data-test="branch-deploy-rail">
      {rows.map((row) => (
        <Card key={row.app_name} data-test={`rail-${row.app_name}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {row.app_name}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] capitalize",
                  row.active_slot === "blue"
                    ? "border-blue-500/40"
                    : "border-emerald-500/40",
                )}
              >
                {row.active_slot}
              </Badge>
              {row.active_health && (
                <Badge
                  variant={
                    row.active_health === "healthy"
                      ? "default"
                      : "destructive"
                  }
                  className="text-[10px] font-normal"
                >
                  <Activity className="mr-0.5 size-2.5" aria-hidden="true" />
                  {row.active_health}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {row.default_branch && (
              <div className="flex items-center gap-2">
                <GitBranch
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t("storyDetail.timeline.branch", "Branch")}:
                </span>
                <span className="font-mono">{row.default_branch}</span>
              </div>
            )}
            {row.active_image_tag && (
              <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span>{t("storyDetail.timeline.active", "Active")}:</span>
                <span>{row.active_image_tag}</span>
              </div>
            )}
            {row.last_switch_at && (
              <div className="flex items-center gap-2">
                <ArrowLeftRight
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t("storyDetail.timeline.lastSwitch", "Last switch")}:
                </span>
                <time dateTime={row.last_switch_at}>
                  {new Date(row.last_switch_at).toLocaleString()}
                </time>
              </div>
            )}
            {row.last_rollback_at && (
              <div className="flex items-center gap-2">
                <Undo2
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t("storyDetail.timeline.lastRollback", "Last rollback")}:
                </span>
                <time dateTime={row.last_rollback_at}>
                  {new Date(row.last_rollback_at).toLocaleString()}
                </time>
                {row.last_rollback_status && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {row.last_rollback_status}
                  </Badge>
                )}
              </div>
            )}
            {!row.last_switch_at && !row.last_rollback_at && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
                {t("storyDetail.timeline.noActivity", "No deploy activity yet")}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

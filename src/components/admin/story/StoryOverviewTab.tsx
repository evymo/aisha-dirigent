/**
 * StoryOverviewTab — title, status, priority, project_preview snapshot,
 * branch + last activity, plus the existing web-artifact-jobs feed (rolled
 * in from the AdminStoryTimeline stub).
 *
 * Live status badge is wired through useLiveTable so the kanban status
 * stays in sync when other clients move the story across columns.
 */
import { useTranslation } from "react-i18next";
import { Clock, GitBranch, Flag, Star } from "lucide-react";

import { aisha } from "@/integrations/db/client";
import { useLiveTable } from "@/hooks/useLiveTable";
import { useWorkflowStatusMap } from "@/hooks/useWorkflowStatuses";
import { StoryFaithfulnessSparkline } from "@/components/admin/story/StoryFaithfulnessSparkline";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import type { StoryDetail } from "@/hooks/useStoryDetail";

interface StoryRow {
  id: string;
  status: string;
  priority: string;
  last_activity_at: string;
  default_branch: string | null;
}

export interface StoryOverviewTabProps {
  story: StoryDetail;
}

export function StoryOverviewTab({ story }: StoryOverviewTabProps) {
  const { t } = useTranslation();
  const { statusMap } = useWorkflowStatusMap();
  const statusMeta = statusMap.get(story.status);

  // Live status — subscribes to partner_stories.id=eq.<storyId>; React Query
  // re-fetches via the rpc on every event. The hook returns the latest row
  // shape so the badge updates without a manual setState.
  const live = useLiveTable<StoryRow>({
    table: "partner_stories",
    filter: `id=eq.${story.id}`,
    queryKey: ["story_live", story.id],
    rpc: async () => {
      const { data, error } = await aisha.rpc("get_story_detail_audited", {
        p_story_id: story.id,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows as unknown as StoryRow[];
    },
  });

  const liveStatus = live.data?.[0]?.status ?? story.status;
  const liveStatusMeta = statusMap.get(liveStatus) ?? statusMeta;

  const projectPreview = (story as unknown as { project_preview?: ProjectPreview })
    .project_preview;

  return (
    <div className="grid gap-4 md:grid-cols-3" data-test="story-overview-tab">
      {/* Status / priority / branch / last activity */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">
            {t("storyDetail.overview.summary", "Summary")}
          </CardTitle>
          <CardDescription>
            {t(
              "storyDetail.overview.summaryHint",
              "Current state of the story. Live-updated from partner_stories.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="default"
              data-test="story-status-badge"
              data-status={liveStatus}
            >
              {liveStatusMeta
                ? t(liveStatusMeta.label_i18n_key)
                : t(`storyloop.statuses.${liveStatus}`)}
            </Badge>
            {story.priority !== "normal" && (
              <Badge variant="secondary" className="capitalize">
                <Flag className="mr-1 size-3" aria-hidden="true" />
                {story.priority}
              </Badge>
            )}
            {story.is_starred && (
              <Badge variant="outline">
                <Star className="mr-1 size-3" aria-hidden="true" />
                {t("storyDetail.overview.starred", "Starred")}
              </Badge>
            )}
          </div>

          {projectPreview?.summary && (
            <p className="text-sm text-muted-foreground">
              {projectPreview.summary}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Meta column */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("storyDetail.overview.meta", "Meta")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {live.data?.[0]?.default_branch ? (
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">
                {t("storyDetail.overview.branch", "Branch")}:
              </span>
              <span className="font-mono">{live.data[0].default_branch}</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t("storyDetail.overview.noBranch", "No branch linked")}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">
              {t("storyDetail.overview.lastActivity", "Last activity")}:
            </span>
            <span>
              {new Date(story.last_activity_at).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {live.isLoading && <Skeleton className="h-4 md:col-span-3" />}

      {/* Phase 12 WP 1.5 — faithfulness trend sparkline */}
      <StoryFaithfulnessSparkline
        storyId={story.id}
        className="md:col-span-3"
      />
    </div>
  );
}

interface ProjectPreview {
  summary?: string;
  goals?: string[];
  constraints?: string[];
  success_criteria?: string[];
}

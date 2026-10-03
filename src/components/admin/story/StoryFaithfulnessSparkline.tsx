/**
 * StoryFaithfulnessSparkline — Phase 12 WP 1.5.
 *
 * Sparkline of the last 50 faithfulness scores for a story. Mounted on
 * AdminStoryDetail Overview tab. Reuses recharts + the existing
 * faithfulnessTier color palette (green ≥0.85, amber 0.6-0.85, red <0.6).
 *
 * Hook-Only Data Access (CLAUDE.md): consumes useStoryFaithfulnessTrend
 * which RPC-only-calls fn_list_story_faithfulness_trend. No direct table
 * access.
 */
import { useTranslation } from "react-i18next";
import { ShieldCheck, AlertTriangle, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";

import {
  useStoryFaithfulnessTrend,
  computeTrendStats,
  faithfulnessTierFor,
  type FaithfulnessPoint,
} from "@/hooks/useStoryFaithfulnessTrend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StoryFaithfulnessSparklineProps {
  storyId: string;
  className?: string;
}

const TIER_BADGE_STYLE = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  noData: "bg-muted text-muted-foreground",
} as const;

const TIER_ICON = {
  high: ShieldCheck,
  medium: AlertTriangle,
  low: TrendingDown,
  noData: ShieldCheck,
} as const;

/** Reverse the array so the chart reads left=old, right=newest. */
function reverseForChart(points: ReadonlyArray<FaithfulnessPoint>) {
  return points
    .slice()
    .reverse()
    .map((p, idx) => ({
      idx,
      score: p.faithfulness === null ? undefined : p.faithfulness,
      timestamp: p.started_at,
      agent_slug: p.agent_slug,
    }));
}

export function StoryFaithfulnessSparkline({
  storyId,
  className,
}: StoryFaithfulnessSparklineProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useStoryFaithfulnessTrend({
    storyId,
    limit: 50,
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("storyDetail.faithfulness.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("storyDetail.faithfulness.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("storyDetail.faithfulness.error")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const stats = computeTrendStats(data);
  if (!stats) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("storyDetail.faithfulness.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("storyDetail.faithfulness.noData")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = reverseForChart(data);
  const latestTier = faithfulnessTierFor(stats.latest);
  const TierIcon = TIER_ICON[latestTier];

  return (
    <Card className={className}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {t("storyDetail.faithfulness.title")}
        </CardTitle>
        <Badge
          variant="secondary"
          className={cn("gap-1", TIER_BADGE_STYLE[latestTier])}
          aria-label={t(`storyDetail.faithfulness.${latestTier}`)}
        >
          <TierIcon className="h-3 w-3" aria-hidden="true" />
          {stats.latest !== null
            ? stats.latest.toFixed(2)
            : t("storyDetail.faithfulness.noScore")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-24 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="idx" hide />
              <YAxis domain={[0, 1]} hide />
              <ReferenceLine y={0.85} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.4} />
              <ReferenceLine y={0.6} stroke="#f59e0b" strokeDasharray="2 2" strokeOpacity={0.4} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]?.payload) return null;
                  const p = payload[0].payload as {
                    score?: number;
                    timestamp: string;
                    agent_slug: string | null;
                  };
                  return (
                    <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow">
                      <div>
                        {p.score !== undefined
                          ? `${(p.score * 100).toFixed(1)}%`
                          : "—"}
                      </div>
                      <div className="text-muted-foreground">
                        {new Date(p.timestamp).toLocaleString()}
                      </div>
                      {p.agent_slug && (
                        <div className="text-muted-foreground">
                          {p.agent_slug}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="currentColor"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                className="text-foreground"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">
              {t("storyDetail.faithfulness.avg")}
            </div>
            <div className="text-sm font-medium">{stats.avg.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("storyDetail.faithfulness.high")}
            </div>
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {stats.high}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("storyDetail.faithfulness.medium")}
            </div>
            <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {stats.medium}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("storyDetail.faithfulness.low")}
            </div>
            <div className="text-sm font-medium text-rose-700 dark:text-rose-400">
              {stats.low}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * UserLongevityScoreList
 * Partner view of consented users' Longevity Scores with aggregations
 */

import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Activity,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import {
  useConsentedUsersLongevityScores,
  useConsentedUsersScoreStats,
  type UserLongevityScore,
} from "@/hooks/useConsentedUsersLongevityScores";

/**
 * Trend badge component
 */
function TrendBadge({ trend, percentage }: { trend: string; percentage: number }) {
  const { t } = useTranslation();

  if (trend === "up") {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        <TrendingUp className="h-3 w-3 mr-1" />
        +{percentage.toFixed(1)}%
      </Badge>
    );
  }

  if (trend === "down") {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        <TrendingDown className="h-3 w-3 mr-1" />
        -{percentage.toFixed(1)}%
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="bg-gray-50 text-gray-600">
      <Minus className="h-3 w-3 mr-1" />
      {t("longevityScore.trend.stable")}
    </Badge>
  );
}

/**
 * Score color based on value
 */
function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

function getProgressColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * Single user score card
 */
function UserScoreCard({ user }: { user: UserLongevityScore }) {
  const { t, i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  const topDomains = Object.entries(user.domains)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="font-medium text-foreground">{user.display_name}</h4>
            <p className="text-xs text-muted-foreground">
              {user.assessed_at
                ? format(new Date(user.assessed_at), "d. M. yyyy", { locale })
                : t("longevityScore.noDataYet")}
            </p>
          </div>
          <TrendBadge trend={user.trend} percentage={user.trend_percentage} />
        </div>

        <div className="flex items-end gap-2 mb-3">
          <span className={`text-3xl font-bold ${getScoreColor(user.overall_score)}`}>
            {Math.round(user.overall_score)}
          </span>
          <span className="text-sm text-muted-foreground mb-1">/100</span>
        </div>

        <Progress
          value={user.overall_score}
          className="h-2 mb-3"
          style={{
            ["--progress-foreground" as string]: getProgressColor(user.overall_score),
          }}
        />

        {topDomains.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {topDomains.map(([domain, score]) => (
              <Badge key={domain} variant="secondary" className="text-xs">
                {t(`longevityScore.domains.${domain}`, domain)}: {Math.round(score)}
              </Badge>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2">
          {t("longevityScore.partner.assessmentCount", { count: user.assessment_count })}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Aggregate statistics card
 */
function StatsCard() {
  const { t } = useTranslation();
  const { stats, isLoading } = useConsentedUsersScoreStats();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <Card className="bg-gradient-to-r from-primary/5 to-primary/10">
      <CardContent className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Users className="h-4 w-4 text-primary mr-1" />
            </div>
            <p className="text-2xl font-bold text-primary">{stats.totalUsers}</p>
            <p className="text-xs text-muted-foreground">{t("longevityScore.partner.totalUsers")}</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Activity className="h-4 w-4 text-primary mr-1" />
            </div>
            <p className="text-2xl font-bold text-primary">{stats.avgScore.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">{t("longevityScore.partner.avgScore")}</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.improving}</p>
            <p className="text-xs text-muted-foreground">{t("longevityScore.partner.improving")}</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <TrendingDown className="h-4 w-4 text-red-600 mr-1" />
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.declining}</p>
            <p className="text-xs text-muted-foreground">{t("longevityScore.partner.declining")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state
 */
function EmptyState() {
  const { t } = useTranslation();

  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        {t("longevityScore.partner.noConsentedUsers")}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Main component - User Longevity Score List for Partners
 */
export function UserLongevityScoreList() {
  const { t } = useTranslation();
  const { data: scores, isLoading, error } = useConsentedUsersLongevityScores();

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t("errors.genericError")}
        </AlertDescription>
      </Alert>
    );
  }

  if (!scores || scores.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">
          {t("longevityScore.partner.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("longevityScore.partner.description")}
        </p>
      </div>

      <StatsCard />

      <ScrollArea className="h-[500px]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pr-4">
          {scores.map((user) => (
            <UserScoreCard key={user.user_id} user={user} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

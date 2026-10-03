/**
 * Longevity Score Card Component
 *
 * Displays the user's Celkový Longevity Score (CLS) with domain breakdown
 * and trend indicator. Used in member dashboard and health overview.
 *
 * @module components/health/LongevityScoreCard
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  useLongevityScoreHistory,
  getScoreColorClass,
  getDomainName,
  getDomainsNeedingAttention,
  getStrongestDomains,
  type DomainScore,
} from "@/hooks/useLongevityScore";

interface LongevityScoreCardProps {
  /** Optional custom class for styling */
  className?: string;
  /** Show detailed domain breakdown */
  showDetails?: boolean;
  /** Show action button to take assessment */
  showAction?: boolean;
  /** Maximum number of domains to show in compact view */
  maxDomains?: number;
}

/**
 * Compact card showing current Longevity Score with trend
 */
export function LongevityScoreCard({
  className = "",
  showDetails = false,
  showAction = true,
  maxDomains = 3,
}: LongevityScoreCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const { data: history, isLoading, error } = useLongevityScoreHistory({ limit: 2 });

  if (isLoading) {
    return <LongevityScoreCardSkeleton className={className} />;
  }

  if (error || !history || history.length === 0) {
    return (
      <LongevityScoreEmptyCard
        className={className}
        showAction={showAction}
      />
    );
  }

  const latest = history[0];
  const trendDirection = latest.trend_direction;
  const trendChange = latest.trend_change_percent;

  const weakDomains = getDomainsNeedingAttention(latest.domain_scores ?? [], 50);
  const strongDomains = getStrongestDomains(latest.domain_scores ?? [], 75);

  return (
    <Card className={`${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {t("longevityScore.title")}
          </span>
          {trendDirection && (
            <TrendBadge direction={trendDirection} change={trendChange} />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Main Score */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative">
            <div
              className={`text-4xl font-bold ${getScoreColorClass(latest.cls_score ?? 0)}`}
            >
              {latest.cls_score?.toFixed(0) ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground text-center">
              / 100
            </div>
          </div>
          <div className="flex-1">
            <Progress
              value={latest.cls_score ?? 0}
              className="h-3"
            />
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>{t("longevityScore.low")}</span>
              <span>{t("longevityScore.high")}</span>
            </div>
          </div>
        </div>

        {/* Domain Summary */}
        {showDetails && latest.domain_scores && (
          <DomainBreakdown
            domains={latest.domain_scores}
            locale={locale}
            maxDomains={maxDomains}
          />
        )}

        {/* Insights */}
        {(weakDomains.length > 0 || strongDomains.length > 0) && (
          <div className="mt-4 space-y-2">
            {strongDomains.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Sparkles className="h-4 w-4" />
                <span>
                  {t("longevityScore.strongAreas", {
                    count: strongDomains.length,
                    areas: strongDomains
                      .slice(0, 2)
                      .map((d) => getDomainName(d, locale, t))
                      .join(", "),
                  })}
                </span>
              </div>
            )}
            {weakDomains.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {t("longevityScore.needsAttention", {
                    count: weakDomains.length,
                    areas: weakDomains
                      .slice(0, 2)
                      .map((d) => getDomainName(d, locale, t))
                      .join(", "),
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action Button */}
        {showAction && (
          <div className="mt-4 flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link to="/member/tracking/longevity">
                {t("longevityScore.viewHistory")}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild className="flex-1">
              <Link to="/member/tracking/longevity/assess">
                {t("longevityScore.takeAssessment")}
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function TrendBadge({
  direction,
  change,
}: {
  direction: "up" | "down" | "stable";
  change?: number | null;
}) {
  const { t } = useTranslation();

  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    up: "default",
    down: "destructive",
    stable: "secondary",
  };

  const icons: Record<string, React.ReactNode> = {
    up: <TrendingUp className="h-3 w-3" />,
    down: <TrendingDown className="h-3 w-3" />,
    stable: <Minus className="h-3 w-3" />,
  };

  return (
    <Badge variant={variants[direction]} className="flex items-center gap-1">
      {icons[direction]}
      {change != null && Math.abs(change) >= 1 && (
        <span>{change > 0 ? "+" : ""}{change.toFixed(0)}%</span>
      )}
      {(!change || Math.abs(change) < 1) && (
        <span>{t(`longevityScore.trend.${direction}`)}</span>
      )}
    </Badge>
  );
}

function DomainBreakdown({
  domains,
  locale,
  maxDomains,
}: {
  domains: DomainScore[];
  locale: string;
  maxDomains: number;
}) {
  const { t } = useTranslation();
  const sortedDomains = [...domains].sort(
    (a, b) => (b.percentage ?? 0) - (a.percentage ?? 0)
  );
  const displayDomains = sortedDomains.slice(0, maxDomains);
  const remainingCount = domains.length - maxDomains;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-muted-foreground mb-2">
        {t("longevityScore.domainBreakdown")}
      </div>
      {displayDomains.map((domain) => (
        <div key={domain.domain_code} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{getDomainName(domain, locale, t)}</span>
            <span className={getScoreColorClass(domain.percentage ?? 0)}>
              {domain.percentage?.toFixed(0) ?? "—"}%
            </span>
          </div>
          <Progress value={domain.percentage ?? 0} className="h-1.5" />
        </div>
      ))}
      {remainingCount > 0 && (
        <div className="text-xs text-muted-foreground text-center pt-1">
          {t("longevityScore.moreDomainsHint", { count: remainingCount })}
        </div>
      )}
    </div>
  );
}

function LongevityScoreCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="h-12 w-16" />
          <div className="flex-1">
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

function LongevityScoreEmptyCard({
  className = "",
  showAction = true,
}: {
  className?: string;
  showAction?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          {t("longevityScore.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">
            {t("longevityScore.noDataYet")}
          </p>
          {showAction && (
            <Button asChild>
              <Link to="/member/tracking/longevity/assess">
                {t("longevityScore.takeFirstAssessment")}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default LongevityScoreCard;

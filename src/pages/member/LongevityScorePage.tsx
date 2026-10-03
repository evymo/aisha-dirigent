/**
 * Longevity Score History Page
 *
 * Shows member's Longevity Score history with trends, domain breakdown,
 * and insights. Accessible from member dashboard.
 *
 * @module pages/member/LongevityScorePage
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import type { Locale } from "date-fns";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import {
  useLongevityScoreHistory,

  getScoreColorClass,
  getDomainName,
  calculateOverallImprovement,
  type LongevityScoreHistoryEntry,
  type DomainScore,
} from "@/hooks/useLongevityScore";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export default function LongevityScorePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const dateLocale = getDateFnsLocale(locale);

  const { data: history, isLoading, error } = useLongevityScoreHistory({ limit: 20 });

  const improvementResult = history ? calculateOverallImprovement(history) : null;
  const overallImprovement = improvementResult?.totalChange ?? 0;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/member/story">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              {t("longevityScore.history.title")}
            </h1>
            {history && history.length > 0 && (
              <p className="text-muted-foreground">
                {t("longevityScore.history.periodLabel", { count: history.length })}
              </p>
            )}
          </div>
        </div>

        {/* Overall Improvement Summary */}
        {improvementResult !== null && improvementResult.hasImproved && Math.abs(overallImprovement) >= 1 && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("longevityScore.history.periodLabel", { count: history?.length ?? 0 })}
                </span>
                <Badge
                  variant={overallImprovement > 0 ? "default" : "destructive"}
                  className="flex items-center gap-1"
                >
                  {overallImprovement > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {overallImprovement > 0
                    ? t("longevityScore.history.improvement", { percent: overallImprovement.toFixed(0) })
                    : t("longevityScore.history.decline", { percent: Math.abs(overallImprovement).toFixed(0) })}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-destructive">{t("common.error")}</p>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!isLoading && !error && (!history || history.length === 0) && (
          <Card>
            <CardContent className="py-12 text-center">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                {t("longevityScore.history.noHistory")}
              </p>
              <Button asChild>
                <Link to="/member/tracking/longevity/assess">
                  {t("longevityScore.takeFirstAssessment")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* History List */}
        {history && history.length > 0 && (
          <div className="space-y-4">
            {history.map((entry, index) => (
              <HistoryEntryCard
                key={entry.response_id}
                entry={entry}
                isLatest={index === 0}
                locale={locale}
                dateLocale={dateLocale}
              />
            ))}
          </div>
        )}

        {/* Action Button */}
        {history && history.length > 0 && (
          <div className="mt-6 text-center">
            <Button asChild size="lg">
              <Link to="/member/tracking/longevity/assess">
                {t("longevityScore.takeAssessment")}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        )}
        </div>
      </main>
      <Footer />
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function HistoryEntryCard({
  entry,
  isLatest,
  locale,
  dateLocale,
}: {
  entry: LongevityScoreHistoryEntry;
  isLatest: boolean;
  locale: string;
  dateLocale?: Locale;
}) {
  const { t } = useTranslation();
  const direction = entry.trend_direction;

  const TrendIcon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const trendColor =
    direction === "up"
      ? "text-green-600 dark:text-green-400"
      : direction === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <Card className={isLatest ? "border-primary" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {format(new Date(entry.completed_at), "d. MMMM yyyy", { locale: dateLocale })}
            {isLatest && (
              <Badge variant="secondary" className="ml-2">
                {t("common.latest")}
              </Badge>
            )}
          </div>
          {direction && (
            <div className={`flex items-center gap-1 ${trendColor}`}>
              <TrendIcon className="h-4 w-4" />
              {entry.trend_change_percent != null && Math.abs(entry.trend_change_percent) >= 1 && (
                <span className="text-sm">
                  {entry.trend_change_percent > 0 ? "+" : ""}
                  {entry.trend_change_percent.toFixed(0)}%
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Main Score */}
        <div className="flex items-center gap-6 mb-4">
          <div>
            <div className={`text-3xl font-bold ${getScoreColorClass(entry.cls_score ?? 0)}`}>
              {entry.cls_score?.toFixed(0) ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">{t("longevityScore.clsLabel")}</div>
          </div>
          <div className="flex-1">
            <Progress value={entry.cls_score ?? 0} className="h-2" />
          </div>
        </div>

        {/* Domain Grid */}
        {entry.domain_scores && entry.domain_scores.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {entry.domain_scores.map((domain) => (
              <DomainMiniCard key={domain.domain_code} domain={domain} locale={locale} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DomainMiniCard({ domain, locale }: { domain: DomainScore; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-muted/50 rounded-lg p-2 text-center">
      <div className={`text-lg font-semibold ${getScoreColorClass(domain.percentage ?? 0)}`}>
        {domain.percentage?.toFixed(0) ?? "—"}%
      </div>
      <div className="text-xs text-muted-foreground truncate">{getDomainName(domain, locale, t)}</div>
    </div>
  );
}

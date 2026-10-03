import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CohortTrackingTrendsChart,
  CohortLabTrendsChart,
  type CohortTrendData,
  type CohortLabTrendData,
} from "@/components/partner/CohortTrendsChart";
import type { CohortStatistics } from "./userTypes";
import {
  Heart,
  Moon,
  Zap,
  Brain,
  TestTube,
  TrendingUp,
  Lock,
  BarChart3,
} from "lucide-react";

interface CohortStatisticsViewProps {
  cohortStats: CohortStatistics[];
  cohortTrends: CohortTrendData[];
  cohortLabTrends: CohortLabTrendData[];
  uniqueStudies: { id: string; name: string; code: string }[];
  anonymousCount: number;
  totalCount: number;
}

/**
 * View showing aggregated cohort statistics per study,
 * including health metrics, lab trends and activity counts.
 */
export function CohortStatisticsView({
  cohortStats,
  cohortTrends,
  cohortLabTrends,
  uniqueStudies,
  anonymousCount,
  totalCount,
}: CohortStatisticsViewProps) {
  const { t } = useTranslation();

  const statsMap = useMemo(() => {
    const map = new Map<string, CohortStatistics>();
    cohortStats.forEach((s) => {
      if (s.study_id) map.set(s.study_id, s);
    });
    return map;
  }, [cohortStats]);

  const trendsMap = useMemo(() => {
    const map = new Map<string, CohortTrendData[]>();
    cohortTrends.forEach((item) => {
      if (!item.study_id) return;
      const existing = map.get(item.study_id) || [];
      existing.push(item);
      map.set(item.study_id, existing);
    });
    return map;
  }, [cohortTrends]);

  const labTrendsMap = useMemo(() => {
    const map = new Map<string, CohortLabTrendData[]>();
    cohortLabTrends.forEach((item) => {
      if (!item.study_id) return;
      const existing = map.get(item.study_id) || [];
      existing.push(item);
      map.set(item.study_id, existing);
    });
    return map;
  }, [cohortLabTrends]);

  return (
    <div className="space-y-6">
      {/* Anonymity Notice */}
      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle>{t("partnerUsers.cohort.anonymousNotice.title")}</AlertTitle>
        <AlertDescription>
          {t("partnerUsers.cohort.anonymousNotice.description", { count: anonymousCount, total: totalCount })}
        </AlertDescription>
      </Alert>

      {uniqueStudies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {t("partnerUsers.cohort.noStudies.title")}
            </h3>
            <p className="text-muted-foreground">
              {t("partnerUsers.cohort.noStudies.description")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {uniqueStudies.map((study) => {
            const stats = statsMap.get(study.id);
            const trends = trendsMap.get(study.id) || [];
            const labTrends = labTrendsMap.get(study.id) || [];

            return (
              <Card key={study.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    {study.code} - {study.name}
                  </CardTitle>
                  <CardDescription>
                    {t("partnerUsers.cohort.aggregateStatistics")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {stats ? (
                    <div className="space-y-6">
                      {/* Participant Counts */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50 text-center">
                          <p className="text-2xl font-semibold">{stats.total_participants ?? 0}</p>
                          <p className="text-sm text-muted-foreground">{t("partnerUsers.cohort.totalParticipants")}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-primary/10 text-center">
                          <p className="text-2xl font-semibold">{stats.active_participants ?? 0}</p>
                          <p className="text-sm text-muted-foreground">{t("partnerUsers.cohort.activeParticipants")}</p>
                        </div>
                        <div className="p-4 rounded-lg bg-green-100 dark:bg-green-900/30 text-center">
                          <p className="text-2xl font-semibold">{stats.completed_participants ?? 0}</p>
                          <p className="text-sm text-muted-foreground">{t("partnerUsers.cohort.completedParticipants")}</p>
                        </div>
                      </div>

                      {/* Tracking Trends Chart */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-4 h-4 text-muted-foreground" />
                          <h4 className="text-sm font-medium">{t("partnerUsers.cohort.trackingTrends")}</h4>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{t("partnerUsers.cohort.weeklyAverages")}</p>
                        <CohortTrackingTrendsChart data={trends} />
                      </div>

                      {/* Tracking Metrics */}
                      <div>
                        <h4 className="text-sm font-medium mb-3">{t("partnerUsers.cohort.averageTrackingMetrics")}</h4>
                        <div className="grid grid-cols-5 gap-3">
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <Heart className="w-5 h-5 mx-auto mb-1 text-destructive" />
                            <p className="text-lg font-semibold">{stats.avg_pain_level?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.pain")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <Zap className="w-5 h-5 mx-auto mb-1 text-chart-2" />
                            <p className="text-lg font-semibold">{stats.avg_energy_level?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.energy")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <Brain className="w-5 h-5 mx-auto mb-1 text-chart-4" />
                            <p className="text-lg font-semibold">{stats.avg_mood_level?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.mood")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <Moon className="w-5 h-5 mx-auto mb-1 text-chart-3" />
                            <p className="text-lg font-semibold">{stats.avg_sleep_quality?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.sleepQuality")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <Moon className="w-5 h-5 mx-auto mb-1 text-chart-3" />
                            <p className="text-lg font-semibold">{stats.avg_sleep_hours?.toFixed(1) ?? t("common.placeholderDash")}{t("common.unitHourShort")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.sleepHours")}</p>
                          </div>
                        </div>
                      </div>

                      {/* Lab Trends Chart */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <TestTube className="w-4 h-4 text-muted-foreground" />
                          <h4 className="text-sm font-medium">{t("partnerUsers.cohort.labTrends")}</h4>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{t("partnerUsers.cohort.monthlyAverages")}</p>
                        <CohortLabTrendsChart data={labTrends} />
                      </div>

                      {/* Lab Averages */}
                      <div>
                        <h4 className="text-sm font-medium mb-3">{t("partnerUsers.cohort.averageLabValues")}</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.avg_crp?.toFixed(2) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.biomarkers.crp")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.avg_vitamin_d?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.biomarkers.vitaminD")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.avg_glucose?.toFixed(1) ?? t("common.placeholderDash")}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.biomarkers.glucose")}</p>
                          </div>
                        </div>
                      </div>

                      {/* Activity Counts */}
                      <div>
                        <h4 className="text-sm font-medium mb-3">{t("partnerUsers.cohort.activityCounts")}</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.total_check_ins ?? 0}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.totalCheckIns")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.total_lab_results ?? 0}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.totalLabResults")}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 text-center">
                            <p className="text-lg font-semibold">{stats.total_dosing_logs ?? 0}</p>
                            <p className="text-xs text-muted-foreground">{t("partnerUsers.cohort.totalDosingLogs")}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">
                      {t("partnerUsers.cohort.noData")}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

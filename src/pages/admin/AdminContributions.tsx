import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { DollarSign, Users, TrendingUp, Coins } from "lucide-react";
import {
  useStudyContributionsAdmin,
  useStudiesWithDynamicFunding,
  useUpdateStudyContributionStatus,
} from "@/hooks";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getContributionColumns } from "./contributions-columns";

export default function AdminContributions() {
  const { t } = useTranslation();

  const defaultCurrency = t("admin.contributions.defaultCurrency");

  const { data: contributions, isLoading } = useStudyContributionsAdmin();
  const { data: studiesWithDynamicFunding } = useStudiesWithDynamicFunding();
  const updateStatusMutation = useUpdateStudyContributionStatus();

  const handleStatusUpdate = useCallback((id: string, status: string) => {
    updateStatusMutation.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(t("admin.contributions.statusUpdated")),
        onError: () => toast.error(t("admin.contributions.errors.statusUpdateFailed")),
      }
    );
  }, [updateStatusMutation, t]);

  const totalAmount = contributions?.reduce((sum, c) =>
    c.status === "completed" ? sum + Number(c.amount) : sum, 0
  ) || 0;

  const tokenContributions = contributions?.filter(c => c.contribution_type.startsWith("tokens_")).length || 0;
  const moneyContributions = contributions?.filter(c => c.contribution_type === "financial").length || 0;

  const columns = useMemo(() => getContributionColumns(
    t,
    handleStatusUpdate,
    defaultCurrency
  ), [t, handleStatusUpdate, defaultCurrency]);

  if (isLoading) {
    return <div className="p-6">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("admin.contributions.title")}</h1>
        <p className="text-muted-foreground">{t("admin.contributions.subtitle")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.contributions.stats.totalRaised")}</p>
                <p className="text-2xl font-semibold">{totalAmount.toLocaleString()} {defaultCurrency}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <Users className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.contributions.stats.contributors")}</p>
                <p className="text-2xl font-semibold">{contributions?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <TrendingUp className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.contributions.stats.moneyContributions")}</p>
                <p className="text-2xl font-semibold">{moneyContributions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Coins className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.contributions.stats.tokenContributions")}</p>
                <p className="text-2xl font-semibold">{tokenContributions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Study Funding Overview */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.contributions.studyFunding.title")}</CardTitle>
          <CardDescription>{t("admin.contributions.studyFunding.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {studiesWithDynamicFunding?.filter(s => (s.funding_goal || 0) > 0).map((study) => {
              const progress = Math.min(100, (study.dynamic_funding / (study.funding_goal || 1)) * 100);
              return (
                <div key={study.id} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{study.name}</span>
                    <span className="text-muted-foreground">
                      {study.dynamic_funding.toLocaleString()} / {(study.funding_goal || 0).toLocaleString()} {defaultCurrency}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Contributions Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.contributions.allContributions")}</CardTitle>
          <CardDescription>{contributions?.length || 0} {t("admin.contributions.totalContributions")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={contributions || []}
            searchKey="study_name"
          />
        </CardContent>
      </Card>
    </div>
  );
}
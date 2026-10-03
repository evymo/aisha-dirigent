import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import {
  Pill,
  Calendar,
  Clock,
  TrendingUp,
  Award,
  AlertCircle,
  CheckCircle,
  Loader2,
  RefreshCw,
  Utensils,
  Trophy,
} from "lucide-react";
import { useMyDistributionPlans, useMyComplianceSummary } from "@/hooks/useMemberDistribution";

export default function MemberDistributionDashboard() {
  const { t } = useTranslation();

  const {
    data: plans = [],
    isLoading: plansLoading,
    refetch: refetchPlans,
  } = useMyDistributionPlans();

  const {
    data: compliance,
    isLoading: complianceLoading,
    refetch: refetchCompliance,
  } = useMyComplianceSummary();

  const loading = plansLoading || complianceLoading;

  const handleRefresh = async () => {
    try {
      await Promise.all([refetchPlans(), refetchCompliance()]);
    } catch {
      toast.error(t("member.distribution.fetchError"));
    }
  };

  const formatTimings = (timings: string[]) => {
    return timings.map((timing) => t(`admin.distributionProtocols.timing.${timing}`)).join(", ");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3 mr-1" />
            {t("member.distribution.status.active")}
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="secondary">
            <AlertCircle className="h-3 w-3 mr-1" />
            {t("member.distribution.status.paused")}
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline">
            <Trophy className="h-3 w-3 mr-1" />
            {t("member.distribution.status.completed")}
          </Badge>
        );
      case "cancelled":
        return <Badge variant="destructive">{t("member.distribution.status.cancelled")}</Badge>;
      default:
        return null;
    }
  };

  const activePlans = plans.filter((p) => p.status === "active");
  const complianceScore = compliance?.compliance_score || 0;
  const isEligible = compliance?.is_eligible_for_discount || false;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t("member.distribution.title")}</h2>
          <p className="text-muted-foreground">{t("member.distribution.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={handleRefresh} size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Compliance Overview */}
      {compliance && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                {t("member.distribution.compliance.score")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Math.round(complianceScore * 100)}%</div>
              <Progress value={complianceScore * 100} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {t("member.distribution.compliance.target", { target: 90 })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("member.distribution.compliance.streak")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{compliance.current_streak}</div>
              <p className="text-xs text-muted-foreground">
                {t("member.distribution.compliance.consecutiveDays")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Award className="h-4 w-4" />
                {t("member.distribution.compliance.tokens")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{compliance.total_tokens_earned}</div>
              <p className="text-xs text-muted-foreground">
                {t("member.distribution.compliance.earnedTokens")}
              </p>
            </CardContent>
          </Card>

          <Card className={isEligible ? "border-green-200 bg-green-50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                {t("member.distribution.compliance.discount")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isEligible ? (
                <>
                  <div className="text-2xl font-bold text-green-600">
                    {t("member.distribution.compliance.eligible")}
                  </div>
                  <p className="text-xs text-green-600">
                    {t("member.distribution.compliance.discountAvailable")}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-muted-foreground">
                    {t("member.distribution.compliance.notEligible")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("member.distribution.compliance.keepGoing")}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Plans */}
      {activePlans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pill className="h-5 w-5" />
              {t("member.distribution.activePlans")}
            </CardTitle>
            <CardDescription>{t("member.distribution.activePlansDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {activePlans.map((plan, index) => {
                const protocol = plan.protocol;
                const doseAmount = plan.custom_dose_amount || protocol?.dose_amount;
                const dosesPerDay = plan.custom_doses_per_day || protocol?.doses_per_day;
                const instructions =
                  plan.custom_instructions || (protocol?.instructions_key ? t(protocol.instructions_key) : null);

                return (
                  <AccordionItem key={plan.id} value={`plan-${index}`}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-4 text-left">
                        <div>
                          <div className="font-medium">
                            {protocol?.product?.name || t("member.distribution.unknownProduct")}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {protocol?.study?.name} ({protocol?.study?.code})
                          </div>
                        </div>
                        {plan.is_vip && <Badge className="bg-amber-100 text-amber-800">VIP</Badge>}
                        {getStatusBadge(plan.status)}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-2">
                        {/* Dosing info */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="text-xs text-muted-foreground mb-1">
                              {t("member.distribution.dose")}
                            </div>
                            <div className="font-medium">
                              {doseAmount} {protocol?.dose_unit}
                            </div>
                          </div>

                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="text-xs text-muted-foreground mb-1">
                              {t("member.distribution.frequency")}
                            </div>
                            <div className="font-medium">
                              {dosesPerDay}x {t("member.distribution.perDay")}
                            </div>
                          </div>

                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {t("member.distribution.timing")}
                            </div>
                            <div className="font-medium">
                              {protocol?.dose_timing ? formatTimings(protocol.dose_timing) : "-"}
                            </div>
                          </div>

                          {protocol?.take_with_food && (
                            <div className="bg-muted/50 rounded-lg p-3">
                              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Utensils className="h-3 w-3" />
                                {t("member.distribution.withFood")}
                              </div>
                              <div className="font-medium">{t("common.yes")}</div>
                            </div>
                          )}
                        </div>

                        {/* Instructions */}
                        {instructions && (
                          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                            <h4 className="font-medium text-sm mb-2 text-blue-900">
                              {t("member.distribution.instructions")}
                            </h4>
                            <p className="text-sm text-blue-800">{instructions}</p>
                          </div>
                        )}

                        {/* Period */}
                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                          <span>
                            <Calendar className="h-4 w-4 inline mr-1" />
                            {t("member.distribution.started")}:{" "}
                            {new Date(plan.starts_at).toLocaleDateString()}
                          </span>
                          {plan.ends_at && (
                            <span>
                              {t("member.distribution.ends")}:{" "}
                              {new Date(plan.ends_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>

                        {/* VIP info */}
                        {plan.is_vip && plan.compensation_percentage > 0 && (
                          <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                            <div className="flex items-center gap-2 text-amber-800">
                              <Trophy className="h-4 w-4" />
                              <span className="font-medium">
                                {t("member.distribution.vipBenefit", {
                                  percent: plan.compensation_percentage,
                                })}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* No plans message */}
      {plans.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Pill className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">{t("member.distribution.noPlans")}</p>
            <p className="text-sm text-muted-foreground mt-2">{t("member.distribution.noPlansHint")}</p>
          </CardContent>
        </Card>
      )}

      {/* Historical plans */}
      {plans.filter((p) => p.status !== "active").length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("member.distribution.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plans
                .filter((p) => p.status !== "active")
                .map((plan) => (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{plan.protocol?.product?.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(plan.starts_at).toLocaleDateString()} -{" "}
                        {plan.ends_at
                          ? new Date(plan.ends_at).toLocaleDateString()
                          : t("member.distribution.ongoing")}
                      </div>
                    </div>
                    {getStatusBadge(plan.status)}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

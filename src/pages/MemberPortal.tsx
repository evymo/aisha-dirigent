import { Suspense, lazy, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrency } from "@/hooks/useCurrency";
import { RequireSecureMode } from "@/components/security/RequireSecureMode";
import { toast } from "sonner";
import { useMembership, useSubscriptionPackages } from "@/hooks/useMembership";
import { useStudies, useMyRegistrations } from "@/hooks/useStudies";
import { useTrackingCheckIns, useLabResults } from "@/hooks/useTracking";

import { useRIIMembership } from "@/hooks/useRIIMembership";
import { useHasInformedConsent } from "@/hooks/useInformedConsent";
import { useMyQualificationResults, useMyPartnerCertification } from "@/hooks/useTestResults";
import { useSubscriptionPurchase, useMySubscriptions } from "@/hooks/useSubscriptionPurchase";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { TrackingDocumentsManager } from "@/components/member/TrackingDocumentsManager";
import { MemberActivityTimeline } from "@/components/member/MemberActivityTimeline";
import { GamificationWidget, RewardPointsCard } from "@/components/gamification";
import { LeaderboardWidget } from "@/components/gamification/LeaderboardWidget";
import { useTokenRewardNotification } from "@/hooks/useTokenRewardNotification";
import { 
  Crown, Activity, FlaskConical, 
  TrendingUp, Heart, Moon, Zap, ClipboardList, CheckCircle2, GraduationCap, Users, FileSignature, AlertCircle, Loader2, FileText, Check
} from "lucide-react";

const TrackingTrendsChart = lazy(() =>
  import("@/components/member/TrackingTrendsChart").then((m) => ({ default: m.TrackingTrendsChart })),
);

export default function MemberPortal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatCurrency, convertAmount, preferredCurrency } = useCurrency();
  const { isLoading: authLoading } = useSession();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { membership, loading: membershipLoading, isUpgraded } = useMembership();
  const { packages } = useSubscriptionPackages();
  const { studies } = useStudies();
  const { registrations } = useMyRegistrations();
  const { checkIns, todayCheckIn } = useTrackingCheckIns();
  const { labResults } = useLabResults();
  const { isRIIMember, isRIIActive, isPendingRII, hasCompletedQuestionnaire, canTakeQualificationTest, registration: riiRegistration } = useRIIMembership();
  const { hasInformedConsent } = useHasInformedConsent();
  const { data: qualificationResult } = useMyQualificationResults();
  const { data: _certificationResult } = useMyPartnerCertification();
  const { requestPackage, loading: purchaseLoading } = useSubscriptionPurchase();
  const { data: mySubscriptions } = useMySubscriptions();
  const { createSubscriptionCheckout, loading: checkoutLoading } = useStripeCheckout();
  const [purchasingPackageId, setPurchasingPackageId] = useState<string | null>(null);
  
  // Enable realtime token reward notifications
  useTokenRewardNotification();

  // Translations are resolved server-side in get_active_studies(p_locale).
  
  const hasPassedQualification = hasPermission("view_studies");
  const needsRiiQuestionnaire = isRIIMember && !hasCompletedQuestionnaire;
  const membershipTierLabel =
    typeof membership?.tier === "string" && membership.tier.length > 0
      ? membership.tier.charAt(0).toUpperCase() + membership.tier.slice(1)
      : t("header.basicMembership");

  // useMemo hooks MUST be called before any early returns to comply with Rules of Hooks
  const recentCheckIns = useMemo(() => checkIns.slice(0, 7), [checkIns]);
  
  const { avgPain, avgEnergy, avgSleep } = useMemo(() => {
    const painCheckIns = recentCheckIns.filter(c => c.pain_level);
    const energyCheckIns = recentCheckIns.filter(c => c.energy_level);
    const sleepCheckIns = recentCheckIns.filter(c => c.sleep_quality);
    
    return {
      avgPain: painCheckIns.reduce((sum, c) => sum + (c.pain_level || 0), 0) / (painCheckIns.length || 1),
      avgEnergy: energyCheckIns.reduce((sum, c) => sum + (c.energy_level || 0), 0) / (energyCheckIns.length || 1),
      avgSleep: sleepCheckIns.reduce((sum, c) => sum + (c.sleep_quality || 0), 0) / (sleepCheckIns.length || 1),
    };
  }, [recentCheckIns]);

  // Note: Auth redirect is handled by RequireAuth in App.tsx - this check is redundant
  // Keeping loading state check for proper UX

  if (authLoading || membershipLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 py-12">
        <RequireSecureMode>
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">{t("memberPortal.title")}</h1>
              <p className="text-muted-foreground mt-1">
                {t("memberPortal.subtitle")}
              </p>
            </div>
            {membership && (
              <Badge variant={isUpgraded ? "default" : "secondary"} className="text-sm py-1 px-3">
                <Crown className="w-4 h-4 mr-1" />
                {membershipTierLabel} {t("memberPortal.member")}
              </Badge>
            )}
          </div>

          {/* Membership Status Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* RII Membership - Step 1 */}
            <Card className={isRIIMember ? "border-primary/30 bg-primary/5" : ""}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isRIIMember ? "bg-primary/20" : "bg-muted"}`}>
                    <Users className={`w-5 h-5 ${isRIIMember ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-medium truncate">{t("memberPortal.status.riiMembership")}</p>
                      {isRIIMember && !needsRiiQuestionnaire && (
                        <Badge variant="default" className="gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          {riiRegistration?.status || t("common.completed")}
                        </Badge>
                      )}
                      {isPendingRII && !isRIIMember && (
                        <Badge variant="secondary" className="gap-1 shrink-0">
                          {t("memberPortal.status.pending")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {isRIIMember
                        ? needsRiiQuestionnaire
                          ? t("memberPortal.status.riiQuestionnaireRequired")
                          : isRIIActive
                            ? t("memberPortal.status.riiActive")
                            : t("memberPortal.status.riiEnrolled", { status: riiRegistration?.status })
                        : isPendingRII
                          ? t("memberPortal.status.riiPending")
                          : t("memberPortal.status.riiNotEnrolled")}
                    </p>
                    {isRIIMember && needsRiiQuestionnaire && (
                      <Button size="sm" asChild className="mt-3">
                        <Link to="/study-registration">
                          {t("memberPortal.status.completeQuestionnaire")}
                        </Link>
                      </Button>
                    )}
                    {!isRIIMember && !isPendingRII && (
                      <Button size="sm" asChild className="mt-3">
                        <Link to="/studies">{t("memberPortal.status.enrollNow")}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Qualification Test - Step 2 */}
            <Card className={hasPassedQualification ? "border-primary/30 bg-primary/5" : ""}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${hasPassedQualification ? "bg-primary/20" : "bg-muted"}`}>
                    <GraduationCap className={`w-5 h-5 ${hasPassedQualification ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-medium truncate">{t("memberPortal.status.qualificationTest")}</p>
                      {hasPassedQualification && (
                        <Badge variant="default" className="gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          {qualificationResult?.score ? `${qualificationResult.score}%` : t("common.completed")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {hasPassedQualification 
                        ? qualificationResult
                          ? t("memberPortal.status.qualificationPassedWithScore", { score: qualificationResult.score })
                          : t("memberPortal.status.qualificationPassed")
                        : t("memberPortal.status.qualificationNotPassed")}
                    </p>
                    {!hasPassedQualification && (
                      <Button size="sm" asChild disabled={!canTakeQualificationTest} className="mt-3">
                        <Link to="/qualification-test">{t("memberPortal.status.takeTest")}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Informed Consent - Step 3 */}
            <Card className={hasInformedConsent ? "border-primary/30 bg-primary/5" : ""}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${hasInformedConsent ? "bg-primary/20" : "bg-muted"}`}>
                    <FileSignature className={`w-5 h-5 ${hasInformedConsent ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-medium truncate">{t("memberPortal.status.informedConsent")}</p>
                      {hasInformedConsent && (
                        <Badge variant="default" className="gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          {t("common.completed")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {hasInformedConsent 
                        ? t("memberPortal.status.consentSigned")
                        : t("memberPortal.status.consentNotSigned")}
                    </p>
                    {!hasInformedConsent && (
                      <Button size="sm" asChild disabled={!hasPassedQualification} className="mt-3">
                        <Link to="/informed-consent">{t("memberPortal.status.signConsent")}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Heart className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberPortal.stats.avgPain")}</p>
                    <p className="text-2xl font-semibold">
                      {t("common.valueOutOf", { value: avgPain.toFixed(1), total: 10 })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberPortal.stats.avgEnergy")}</p>
                    <p className="text-2xl font-semibold">
                      {t("common.valueOutOf", { value: avgEnergy.toFixed(1), total: 10 })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-secondary/50">
                    <Moon className="w-5 h-5 text-secondary-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberPortal.stats.avgSleep")}</p>
                    <p className="text-2xl font-semibold">
                      {t("common.valueOutOf", { value: avgSleep.toFixed(1), total: 10 })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent/50">
                    <ClipboardList className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("memberPortal.stats.checkIns")}</p>
                    <p className="text-2xl font-semibold">{checkIns.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview">{t("memberPortal.tabs.overview")}</TabsTrigger>
              <TabsTrigger value="activity">{t("memberPortal.tabs.activity")}</TabsTrigger>
              <TabsTrigger value="tracking">{t("memberPortal.tabs.tracking")}</TabsTrigger>
              <TabsTrigger value="documents">{t("memberPortal.tabs.documents")}</TabsTrigger>
              <TabsTrigger value="studies">{t("memberPortal.tabs.studies")}</TabsTrigger>
              <TabsTrigger value="subscription">{t("memberPortal.tabs.subscription")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              {/* Gamification Row */}
              <div className="grid md:grid-cols-3 gap-6">
                <GamificationWidget onViewAll={() => navigate("/member/tokens")} />
                <RewardPointsCard />
                <LeaderboardWidget />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Today's Check-in */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      {t("memberPortal.todayCheckIn.title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {todayCheckIn ? (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{t("memberPortal.todayCheckIn.completed")}</p>
                        <div className="grid grid-cols-3 gap-4 mt-4">
                          <div className="text-center">
                            <p className="text-2xl font-semibold">{todayCheckIn.pain_level ?? "-"}</p>
                            <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.pain")}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-semibold">{todayCheckIn.energy_level ?? "-"}</p>
                            <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.energy")}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-semibold">{todayCheckIn.sleep_quality ?? "-"}</p>
                            <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.sleep")}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-muted-foreground mb-4">{t("memberPortal.todayCheckIn.noCheckIn")}</p>
                        <Button asChild>
                          <Link to="/member/check-in">{t("memberPortal.todayCheckIn.complete")}</Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Active Studies */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FlaskConical className="w-5 h-5" />
                      {t("memberPortal.studyParticipation.title")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {registrations.length > 0 ? (
                      <div className="space-y-3">
                        {registrations.slice(0, 3).map((registration) => (
                          <div key={registration.id} className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{registration.study_name || t("memberPortal.studyParticipation.study")}</p>
                              <p className="text-xs text-muted-foreground truncate">{registration.study_code}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0">{registration.status}</Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-muted-foreground mb-4">{t("memberPortal.studyParticipation.notEnrolled")}</p>
                        <Button variant="outline" asChild>
                          <Link to="/studies">{t("memberPortal.studyParticipation.browse")}</Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Recent Lab Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    {t("memberPortal.labResults.title")}
                  </CardTitle>
                  <CardDescription>{t("memberPortal.labResults.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {labResults.length > 0 ? (
                    <div className="space-y-3">
                      {labResults.slice(0, 3).map((result) => (
                        <div key={result.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">{result.lab_name || t("memberPortal.labResults.labTest")}</p>
                            <p className="text-sm text-muted-foreground">{new Date(result.test_date).toLocaleDateString()}</p>
                          </div>
                          <Badge variant={result.status === "reviewed" ? "default" : "secondary"}>
                            {result.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-6">{t("memberPortal.labResults.noResults")}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-6">
              <MemberActivityTimeline maxHeight="600px" />
            </TabsContent>

            <TabsContent value="tracking" className="space-y-6">
              <div className="flex justify-end">
                <Button asChild>
                  <Link to="/member/check-in">{t("memberPortal.tracking.newCheckIn")}</Link>
                </Button>
              </div>
              
              <Suspense fallback={<div className="h-[300px] w-full rounded-lg border bg-card" />}>
                <TrackingTrendsChart />
              </Suspense>

              <Card>
                <CardHeader>
                  <CardTitle>{t("memberPortal.tracking.recentCheckIns")}</CardTitle>
                  <CardDescription>{t("memberPortal.tracking.latestEntries")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {checkIns.length > 0 ? (
                    <div className="space-y-3">
                      {checkIns.slice(0, 5).map((checkIn) => (
                        <div key={checkIn.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">
                              {new Date(checkIn.check_in_date).toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                            <p className="text-sm text-muted-foreground capitalize">
                              {checkIn.check_in_type} {t("memberPortal.tracking.checkIn")}
                            </p>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div className="text-center">
                              <p className="font-semibold">{checkIn.pain_level ?? "-"}</p>
                              <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.pain")}</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold">{checkIn.energy_level ?? "-"}</p>
                              <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.energy")}</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold">{checkIn.sleep_quality ?? "-"}</p>
                              <p className="text-xs text-muted-foreground">{t("memberPortal.metrics.sleep")}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-4">{t("memberPortal.tracking.noCheckIns")}</p>
                      <Button asChild>
                        <Link to="/member/check-in">{t("memberPortal.tracking.startTracking")}</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {t("member.documents.title")}
                  </CardTitle>
                  <CardDescription>{t("member.documents.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <TrackingDocumentsManager />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="studies">
              <Card>
                <CardHeader>
                  <CardTitle>{t("memberPortal.studies.available")}</CardTitle>
                  <CardDescription>{t("memberPortal.studies.joinProgram")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {studies.map((study) => (
                      <div key={study.id} className="p-4 border rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{study.name}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{study.description}</p>
                            <div className="flex gap-2 mt-2">
                              <Badge variant="outline">{study.study_type.replace("_", " ")}</Badge>
                              <Badge variant="secondary">{study.duration_weeks} {t("memberPortal.studies.weeks")}</Badge>
                            </div>
                          </div>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/studies/${study.id}`}>{t("memberPortal.studies.learnMore")}</Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="subscription" className="space-y-6">
              {/* Subscription requires only RII membership (enrolled status) */}
              {!isRIIMember && (
                <Alert className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("memberPortal.subscription.riiRequired")}
                    <Button asChild variant="link" className="p-0 h-auto ml-1">
                      <Link to="/studies">{t("memberPortal.subscription.joinRII")}</Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* My Subscriptions Section */}
              {mySubscriptions && mySubscriptions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Crown className="w-5 h-5" />
                      {t("memberPortal.subscription.mySubscriptions")}
                    </CardTitle>
                    <CardDescription>{t("memberPortal.subscription.mySubscriptionsDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {mySubscriptions.map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between gap-3 p-4 border rounded-lg">
                          <div className="flex items-center gap-4 min-w-0 flex-1">
                            <div className={`p-2 rounded-lg shrink-0 ${sub.status === 'approved' ? 'bg-green-100' : sub.status === 'pending' ? 'bg-yellow-100' : sub.status === 'active' ? 'bg-primary/10' : 'bg-muted'}`}>
                              <Crown className={`w-5 h-5 ${sub.status === 'approved' ? 'text-green-600' : sub.status === 'pending' ? 'text-yellow-600' : sub.status === 'active' ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{sub.package?.name || t("memberPortal.subscription.package")}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatCurrency(sub.amount_paid, sub.currency)} {t("common.separatorBullet")} {sub.package?.period || ''}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("memberPortal.subscription.validUntil")}: {new Date(sub.period_end).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <Badge variant={
                              sub.status === 'approved' ? 'default' : 
                              sub.status === 'pending' ? 'secondary' : 
                              sub.status === 'active' ? 'default' :
                              sub.status === 'rejected' ? 'destructive' : 'outline'
                            }>
                              {sub.status === 'approved' ? t("memberPortal.subscription.statusApproved") :
                               sub.status === 'pending' ? t("memberPortal.subscription.statusPending") :
                               sub.status === 'active' ? t("memberPortal.subscription.statusActive") :
                               sub.status === 'rejected' ? t("memberPortal.subscription.statusRejected") :
                               sub.status}
                            </Badge>
                            {sub.status === 'approved' && (
                              <Button
                                size="sm"
                                disabled={checkoutLoading}
                                onClick={async () => {
                                  const selectedPackage = packages.find((pkg) => pkg.id === sub.package_id);
                                  if (!selectedPackage) {
                                    toast.error(t("common.error"), {
                                      description: t("errors.genericError"),
                                    });
                                    return;
                                  }

                                  await createSubscriptionCheckout(
                                    selectedPackage,
                                    selectedPackage.is_recurring ? "recurring" : "one_time",
                                    sub.id,
                                  );
                                }}
                              >
                                {t("memberPortal.subscription.payNow")}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Available Packages */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("memberPortal.subscription.availablePackages")}</CardTitle>
                  <CardDescription>{t("memberPortal.subscription.selectToRequest")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-3 gap-6">
                    {packages.filter(p => !p.is_recurring).slice(0, 6).map((pkg) => {
                      const isProcessing = purchaseLoading && purchasingPackageId === pkg.id;
                      const hasPendingRequest = mySubscriptions?.some(s => s.package_id === pkg.id && (s.status === 'pending' || s.status === 'approved'));
                      
                      const handlePurchase = async () => {
                        setPurchasingPackageId(pkg.id);
                        await requestPackage(pkg);
                        setPurchasingPackageId(null);
                      };
                      
                      return (
                        <Card key={pkg.id} className={pkg.tier === "upgraded" ? "border-primary" : ""}>
                          <CardHeader>
                            <CardTitle className="text-lg">{pkg.name}</CardTitle>
                            <CardDescription>{pkg.description}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="mb-4">
                              <span className="text-3xl font-bold">
                                {formatCurrency(
                                  convertAmount(pkg.price, (pkg.currency || preferredCurrency).toUpperCase(), preferredCurrency),
                                  preferredCurrency
                                )}
                              </span>
                            </div>
                            <ul className="text-sm space-y-2 mb-6">
                              <li><Check className="inline h-3.5 w-3.5 mr-1" />{pkg.governance_tokens ?? 0} {t("memberPortal.subscription.governanceTokens")}</li>
                              <li><Check className="inline h-3.5 w-3.5 mr-1" />{pkg.impact_tokens ?? 0} {t("memberPortal.subscription.impactTokens")}</li>
                              <li><Check className="inline h-3.5 w-3.5 mr-1" />{pkg.period} {t("memberPortal.subscription.access")}</li>
                            </ul>
                            <Button 
                              className="w-full" 
                              variant={pkg.tier === "upgraded" ? "default" : "outline"}
                              disabled={!isRIIMember || isProcessing || hasPendingRequest}
                              onClick={handlePurchase}
                            >
                              {isProcessing ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {t("common.processing")}
                                </>
                              ) : hasPendingRequest ? (
                                t("memberPortal.subscription.alreadyRequested")
                              ) : (
                                t("memberPortal.subscription.selectPackage")
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          </div>
        </RequireSecureMode>
      </main>

      <Footer />
    </div>
  );
}

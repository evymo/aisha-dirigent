import { useState, useMemo, lazy, Suspense } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Locale } from "date-fns";
import { format } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/hooks/useSession";
import { useConsultantUsers, useUserTrackingData, ConsultantUser, UserTrackingData } from "@/hooks/useConsultantUsers";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { UserTrackingTrendsChart } from "@/components/partner/UserTrackingTrendsChart";
import { UserLabTrendsChart } from "@/components/partner/UserLabTrendsChart";
import {
  Users,
  Activity,
  FileText,
  ClipboardCheck,
  ChevronRight,
  Heart,
  Moon,
  Zap,
  Brain,
  TestTube,
  Pill,
  TrendingUp,
  Ticket,
} from "lucide-react";

const Invitations = lazy(() => import("@/pages/shared/Invitations"));

export default function ConsultantDashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { data: users = [], isLoading: usersLoading } = useConsultantUsers();
  const [selectedUser, setSelectedUser] = useState<ConsultantUser | null>(null);
  
  const { data: trackingData, isLoading: trackingDataLoading } = useUserTrackingData(
    selectedUser?.user_id || null
  );

  const dateLocale = getDateFnsLocale(i18n.language);

  if (authLoading || usersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  const activeUsers = users.filter(p => p.status === "active" || p.status === "enrolled");
  const completedUsers = users.filter(p => p.status === "completed");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-primary/10 text-primary";
      case "enrolled": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "completed": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "withdrawn": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("consultantDashboard.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("consultantDashboard.subtitle")}
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/partner/dashboard")}>
              {t("consultantDashboard.backToPartner")}
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("consultantDashboard.stats.totalUsers")}
                    </p>
                    <p className="text-2xl font-semibold">{users.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("consultantDashboard.stats.activeUsers")}
                    </p>
                    <p className="text-2xl font-semibold">{activeUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <ClipboardCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("consultantDashboard.stats.completedUsers")}
                    </p>
                    <p className="text-2xl font-semibold">{completedUsers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="users" className="space-y-6">
            <TabsList>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {t("consultantDashboard.tabs.users")}
              </TabsTrigger>
              <TabsTrigger value="invitations" className="flex items-center gap-2">
                <Ticket className="w-4 h-4" />
                {t("invitations.title")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users">
              {users.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {t("consultantDashboard.noUsers.title")}
                </h3>
                <p className="text-muted-foreground">
                  {t("consultantDashboard.noUsers.description")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6 min-w-0">
              {/* User List */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle>{t("consultantDashboard.userList.title")}</CardTitle>
                  <CardDescription>
                    {t("consultantDashboard.userList.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[600px]">
                    <div className="divide-y">
                      {users.map((user) => (
                        <button
                          key={user.registration_id}
                          onClick={() => setSelectedUser(user)}
                          className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                            selectedUser?.registration_id === user.registration_id ? "bg-muted" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">
                                {user.profile?.display_name || t("consultantDashboard.unknownUser")}
                              </p>
                              <p className="text-sm text-muted-foreground truncate">
                                {user.study_code} - {user.study_name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge className={getStatusColor(user.status)} variant="secondary">
                                  {user.status}
                                </Badge>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* User Details */}
              <div className="lg:col-span-2">
                {!selectedUser ? (
                  <Card className="h-full flex items-center justify-center">
                    <CardContent className="text-center py-12">
                      <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        {t("consultantDashboard.selectUser")}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>
                            {selectedUser.profile?.display_name || t("consultantDashboard.unknownUser")}
                          </CardTitle>
                          <CardDescription>
                            {selectedUser.study_code} • {selectedUser.study_name}
                          </CardDescription>
                        </div>
                        <Badge className={getStatusColor(selectedUser.status)}>
                          {selectedUser.status}
                        </Badge>
                      </div>
                      {selectedUser.enrolled_at && (
                        <div className="flex flex-wrap gap-4 mt-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">{t("consultantDashboard.enrolled")}:</span>{" "}
                            {format(new Date(selectedUser.enrolled_at), "PPP", { locale: dateLocale })}
                          </div>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent>
                      {trackingDataLoading ? (
                        <div className="py-8 text-center text-muted-foreground">
                          {t("common.loading")}
                        </div>
                      ) : trackingData ? (
                        <Tabs defaultValue="checkins" className="space-y-4">
                          <TabsList className="grid grid-cols-5 w-full">
                            <TabsTrigger value="checkins" className="text-xs">
                              <Activity className="w-4 h-4 mr-1" />
                              {t("consultantDashboard.tabs.checkIns")}
                            </TabsTrigger>
                            <TabsTrigger value="labs" className="text-xs">
                              <TestTube className="w-4 h-4 mr-1" />
                              {t("consultantDashboard.tabs.labs")}
                            </TabsTrigger>
                            <TabsTrigger value="dosing" className="text-xs">
                              <Pill className="w-4 h-4 mr-1" />
                              {t("consultantDashboard.tabs.dosing")}
                            </TabsTrigger>
                            <TabsTrigger value="questionnaires" className="text-xs">
                              <FileText className="w-4 h-4 mr-1" />
                              {t("consultantDashboard.tabs.questionnaires")}
                            </TabsTrigger>
                            <TabsTrigger value="consents" className="text-xs">
                              <ClipboardCheck className="w-4 h-4 mr-1" />
                              {t("consultantDashboard.tabs.consents")}
                            </TabsTrigger>
                          </TabsList>

                          <TabsContent value="checkins">
                            <TrackingCheckInsTab checkIns={trackingData.checkIns} dateLocale={dateLocale} />
                          </TabsContent>

                          <TabsContent value="labs">
                            <LabResultsTab labResults={trackingData.labResults} dateLocale={dateLocale} />
                          </TabsContent>

                          <TabsContent value="dosing">
                            <DosingLogsTab dosingLogs={trackingData.dosingLogs} dateLocale={dateLocale} />
                          </TabsContent>

                          <TabsContent value="questionnaires">
                            <QuestionnairesTab responses={trackingData.questionnaireResponses} dateLocale={dateLocale} />
                          </TabsContent>

                          <TabsContent value="consents">
                            <ConsentsTab consents={trackingData.consents} dateLocale={dateLocale} />
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <div className="py-8 text-center text-muted-foreground">
                          {t("consultantDashboard.noData")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
              )}
            </TabsContent>

            <TabsContent value="invitations">
              <Suspense fallback={<div className="p-8 text-center">{t("common.loading")}</div>}>
                <Invitations />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function TrackingCheckInsTab({ checkIns, dateLocale }: { checkIns: UserTrackingData['checkIns']; dateLocale: Locale }) {
  const { t } = useTranslation();
  // Memoize average calculations to prevent recalculation on every render
  const { painAvg, energyAvg, moodAvg, sleepAvg } = useMemo(() => {
    const painValues = checkIns.filter(c => c.pain_level != null);
    const energyValues = checkIns.filter(c => c.energy_level != null);
    const moodValues = checkIns.filter(c => c.mood_level != null);
    const sleepValues = checkIns.filter(c => c.sleep_hours != null);
    
    return {
      painAvg: painValues.length ? painValues.reduce((sum, c) => sum + (c.pain_level ?? 0), 0) / painValues.length : 0,
      energyAvg: energyValues.length ? energyValues.reduce((sum, c) => sum + (c.energy_level ?? 0), 0) / energyValues.length : 0,
      moodAvg: moodValues.length ? moodValues.reduce((sum, c) => sum + (c.mood_level ?? 0), 0) / moodValues.length : 0,
      sleepAvg: sleepValues.length ? sleepValues.reduce((sum, c) => sum + (c.sleep_hours ?? 0), 0) / sleepValues.length : 0,
    };
  }, [checkIns]);
  
  if (checkIns.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.noCheckIns")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tracking Trends Chart */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">{t("consultantDashboard.chart.title")}</h4>
        </div>
        <UserTrackingTrendsChart checkIns={checkIns} />
      </div>

      {/* Averages */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Heart className="w-5 h-5 mx-auto mb-1 text-destructive" />
          <p className="text-xs text-muted-foreground">{t("consultantDashboard.avgPain")}</p>
          <p className="text-lg font-semibold">{painAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Zap className="w-5 h-5 mx-auto mb-1 text-chart-2" />
          <p className="text-xs text-muted-foreground">{t("consultantDashboard.avgEnergy")}</p>
          <p className="text-lg font-semibold">{energyAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Brain className="w-5 h-5 mx-auto mb-1 text-chart-4" />
          <p className="text-xs text-muted-foreground">{t("consultantDashboard.avgMood")}</p>
          <p className="text-lg font-semibold">{moodAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Moon className="w-5 h-5 mx-auto mb-1 text-chart-3" />
          <p className="text-xs text-muted-foreground">{t("consultantDashboard.avgSleep")}</p>
          <p className="text-lg font-semibold">{sleepAvg.toFixed(1)}{t("common.unitHourShort")}</p>
        </div>
      </div>

      {/* Recent check-ins */}
      <ScrollArea className="h-[250px]">
        <div className="space-y-2">
          {checkIns.slice(0, 10).map((checkIn) => (
            <div key={checkIn.id} className="p-3 rounded-lg border bg-card text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">
                  {format(new Date(checkIn.check_in_date), "PPP", { locale: dateLocale })}
                </span>
                <Badge variant="outline">{checkIn.check_in_type}</Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">{t("consultantDashboard.chart.pain")}{t("common.separatorColon")}</span> {checkIn.pain_level ?? t("common.placeholderHyphen")}{t("common.scaleOutOfTen")}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("consultantDashboard.chart.energy")}{t("common.separatorColon")}</span> {checkIn.energy_level ?? t("common.placeholderHyphen")}{t("common.scaleOutOfTen")}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("consultantDashboard.chart.mood")}{t("common.separatorColon")}</span> {checkIn.mood_level ?? t("common.placeholderHyphen")}{t("common.scaleOutOfTen")}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("consultantDashboard.chart.sleep")}{t("common.separatorColon")}</span> {checkIn.sleep_hours ?? t("common.placeholderHyphen")}{t("common.unitHourShort")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function LabResultsTab({ labResults, dateLocale }: { labResults: UserTrackingData['labResults']; dateLocale: Locale }) {
  const { t } = useTranslation();
  if (labResults.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.noLabResults")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Lab Trends Chart */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">{t("consultantDashboard.labChart.title")}</h4>
        </div>
        <UserLabTrendsChart labResults={labResults} />
      </div>

      {/* Recent lab results list */}
      <ScrollArea className="h-[200px]">
        <div className="space-y-2">
          {labResults.slice(0, 10).map((result) => (
            <div key={result.id} className="p-3 rounded-lg border bg-card text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">
                  {format(new Date(result.test_date), "PPP", { locale: dateLocale })}
                </span>
                <Badge variant={result.status === "reviewed" ? "default" : "secondary"}>
                  {result.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {result.crp != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.crp")}{t("common.separatorColon")}</span> {result.crp} {t("common.unitMgPerL")}</div>
                )}
                {result.glucose != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.glucose")}{t("common.separatorColon")}</span> {result.glucose} {t("common.unitMgPerDl")}</div>
                )}
                {result.vitamin_d != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.vitD")}{t("common.separatorColon")}</span> {result.vitamin_d} {t("common.unitNgPerMl")}</div>
                )}
                {result.cholesterol_total != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.chol")}{t("common.separatorColon")}</span> {result.cholesterol_total} {t("common.unitMgPerDl")}</div>
                )}
                {result.hba1c != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.hba1c")}{t("common.separatorColon")}</span> {result.hba1c}{t("common.symbolPercent")}</div>
                )}
                {result.hdl != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.hdl")}{t("common.separatorColon")}</span> {result.hdl} {t("common.unitMgPerDl")}</div>
                )}
                {result.ldl != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.ldl")}{t("common.separatorColon")}</span> {result.ldl} {t("common.unitMgPerDl")}</div>
                )}
                {result.ast != null && (
                  <div><span className="text-muted-foreground">{t("consultantDashboard.biomarkers.ast")}{t("common.separatorColon")}</span> {result.ast} {t("common.unitUPerL")}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function DosingLogsTab({ dosingLogs, dateLocale }: { dosingLogs: UserTrackingData['dosingLogs']; dateLocale: Locale }) {
  const { t } = useTranslation();
  if (dosingLogs.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.noDosingLogs")}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {dosingLogs.map((log) => (
          <div key={log.id} className="p-3 rounded-lg border bg-card text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {format(new Date(log.logged_at), "PPP p", { locale: dateLocale })}
              </span>
              <span className="text-muted-foreground">
                {log.dose_count}{t("common.multiplierTimes")} {log.dose_amount}
              </span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function QuestionnairesTab({ responses, dateLocale }: { responses: UserTrackingData['questionnaireResponses']; dateLocale: Locale }) {
  const { t } = useTranslation();
  const nameKeys = responses
    .map((response) => response.questionnaire_name_key)
    .filter((key): key is string => Boolean(key));
  const nameTranslations = useDynamicTranslationsMap(nameKeys, "questionnaires", "en");

  if (responses.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.noQuestionnaires")}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {responses.map((response) => {
          const name =
            (response.questionnaire_name_key && nameTranslations[response.questionnaire_name_key]) ||
            response.questionnaire_name ||
            response.questionnaire_code ||
            response.questionnaire_id;

          return (
            <div key={response.id} className="p-3 rounded-lg border bg-card text-sm flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-medium truncate">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(response.completed_at), "PPP", { locale: dateLocale })}
                  {response.questionnaire_version ? ` · v${response.questionnaire_version}` : ""}
                </p>
              </div>
              <Badge variant="secondary">
                {t("consultantDashboard.questionnaireCompleted")}
              </Badge>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function ConsentsTab({ consents, dateLocale }: { consents: UserTrackingData['consents']; dateLocale: Locale }) {
  const { t } = useTranslation();
  if (consents.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t("consultantDashboard.noConsents")}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {consents.map((consent) => (
          <div key={consent.id} className="p-3 rounded-lg border bg-card text-sm flex items-center justify-between">
            <div>
              <span className="font-medium capitalize">{consent.consent_type.replace(/_/g, " ")}</span>
              {consent.granted_at && (
                <p className="text-xs text-muted-foreground">
                  {format(new Date(consent.granted_at), "PPP", { locale: dateLocale })}
                </p>
              )}
            </div>
            <Badge variant={consent.granted ? "default" : "destructive"}>
              {consent.granted ? t("consultantDashboard.granted") : t("consultantDashboard.denied")}
            </Badge>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

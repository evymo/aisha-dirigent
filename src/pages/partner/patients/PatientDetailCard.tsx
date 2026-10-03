import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "date-fns";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConsultantUser, UserTrackingData } from "@/hooks/useConsultantUsers";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { UserTrackingTrendsChart } from "@/components/partner/UserTrackingTrendsChart";
import { UserLabTrendsChart } from "@/components/partner/UserLabTrendsChart";
import {
  Activity,
  FileText,
  ClipboardCheck,
  Heart,
  Moon,
  Zap,
  Brain,
  TestTube,
  Pill,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tab sub-components
// ---------------------------------------------------------------------------

function TrackingCheckInsTab({ checkIns, dateLocale }: { checkIns: UserTrackingData['checkIns']; dateLocale: Locale }) {
  const { t } = useTranslation();

  const { painAvg, energyAvg, moodAvg, sleepAvg } = useMemo(() => {
    const painValues = checkIns.filter(c => c.pain_level !== null);
    const energyValues = checkIns.filter(c => c.energy_level !== null);
    const moodValues = checkIns.filter(c => c.mood_level !== null);
    const sleepValues = checkIns.filter(c => c.sleep_hours !== null);

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
        {t("partnerUsers.noCheckIns")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">{t("partnerUsers.chart.title")}</h4>
        </div>
        <UserTrackingTrendsChart checkIns={checkIns} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Heart className="w-5 h-5 mx-auto mb-1 text-destructive" />
          <p className="text-xs text-muted-foreground">{t("partnerUsers.avgPain")}</p>
          <p className="text-lg font-semibold">{painAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Zap className="w-5 h-5 mx-auto mb-1 text-chart-2" />
          <p className="text-xs text-muted-foreground">{t("partnerUsers.avgEnergy")}</p>
          <p className="text-lg font-semibold">{energyAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Brain className="w-5 h-5 mx-auto mb-1 text-chart-4" />
          <p className="text-xs text-muted-foreground">{t("partnerUsers.avgMood")}</p>
          <p className="text-lg font-semibold">{moodAvg.toFixed(1)}{t("common.scaleOutOfTen")}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <Moon className="w-5 h-5 mx-auto mb-1 text-chart-3" />
          <p className="text-xs text-muted-foreground">{t("partnerUsers.avgSleep")}</p>
          <p className="text-lg font-semibold">{sleepAvg.toFixed(1)}{t("common.unitHourShort")}</p>
        </div>
      </div>

      <ScrollArea className="h-[250px]">
        <div className="space-y-2">
          {checkIns.map((checkIn) => (
            <div key={checkIn.id} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {format(new Date(checkIn.check_in_date), "PPP", { locale: dateLocale })}
                </span>
                <Badge variant="secondary">{checkIn.check_in_type}</Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {checkIn.pain_level !== null && (
                  <div><span className="text-muted-foreground">{t("partnerUsers.labels.pain")}{t("common.separatorColon")}</span> {checkIn.pain_level}{t("common.scaleOutOfTen")}</div>
                )}
                {checkIn.energy_level !== null && (
                  <div><span className="text-muted-foreground">{t("partnerUsers.labels.energy")}{t("common.separatorColon")}</span> {checkIn.energy_level}{t("common.scaleOutOfTen")}</div>
                )}
                {checkIn.mood_level !== null && (
                  <div><span className="text-muted-foreground">{t("partnerUsers.labels.mood")}{t("common.separatorColon")}</span> {checkIn.mood_level}{t("common.scaleOutOfTen")}</div>
                )}
                {checkIn.sleep_hours !== null && (
                  <div><span className="text-muted-foreground">{t("partnerUsers.labels.sleep")}{t("common.separatorColon")}</span> {checkIn.sleep_hours}{t("common.unitHourShort")}</div>
                )}
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
        {t("partnerUsers.noLabs")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">{t("partnerUsers.labChart.title")}</h4>
        </div>
        <UserLabTrendsChart labResults={labResults} />
      </div>

      <ScrollArea className="h-[250px]">
        <div className="space-y-2">
          {labResults.map((result) => (
            <div key={result.id} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {format(new Date(result.test_date), "PPP", { locale: dateLocale })}
                </span>
                <Badge variant={result.status === "reviewed" ? "default" : "secondary"}>
                  {result.status}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {result.crp !== null && <div><span className="text-muted-foreground">{t("partnerUsers.labels.crp")}:</span> {result.crp}</div>}
                {result.glucose !== null && <div><span className="text-muted-foreground">{t("partnerUsers.labels.glucose")}:</span> {result.glucose}</div>}
                {result.vitamin_d !== null && <div><span className="text-muted-foreground">{t("partnerUsers.labels.vitD")}:</span> {result.vitamin_d}</div>}
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
        {t("partnerUsers.noDosing")}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {dosingLogs.map((log) => (
          <div key={log.id} className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {format(new Date(log.logged_at), "PPP p", { locale: dateLocale })}
              </span>
              <span className="text-sm">
                {log.dose_count && `${log.dose_count}x`} {log.dose_amount}
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
        {t("partnerUsers.noQuestionnaires")}
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
            <div key={response.id} className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(response.completed_at), "PPP", { locale: dateLocale })}
                  {response.questionnaire_version ? ` · v${response.questionnaire_version}` : ""}
                </p>
              </div>
              <Badge variant="secondary">{t("partnerUsers.completed")}</Badge>
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
        {t("partnerUsers.noConsents")}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {consents.map((consent) => (
          <div key={consent.id} className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
            <div>
              <span className="text-sm font-medium capitalize">{consent.consent_type.replace(/_/g, " ")}</span>
              {consent.granted_at && (
                <p className="text-xs text-muted-foreground">
                  {format(new Date(consent.granted_at), "PPP", { locale: dateLocale })}
                </p>
              )}
            </div>
            <Badge variant={consent.granted ? "default" : "destructive"}>
              {consent.granted ? t("partnerUsers.granted") : t("partnerUsers.denied")}
            </Badge>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

interface UserDetailCardProps {
  user: ConsultantUser;
  trackingData: UserTrackingData | undefined;
  trackingDataLoading: boolean;
  dateLocale: Locale;
  getStatusColor: (status: string) => string;
}

/**
 * Card showing a consented user's detail with tabbed health data
 * (check-ins, labs, dosing logs, questionnaires, consents).
 */
export function UserDetailCard({
  user,
  trackingData,
  trackingDataLoading,
  dateLocale,
  getStatusColor,
}: UserDetailCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-green-600" />
              {user.profile?.display_name || t("partnerUsers.unknownUser")}
            </CardTitle>
            <CardDescription>
              {user.study_code} • {user.study_name}
            </CardDescription>
          </div>
          <Badge className={getStatusColor(user.status)}>
            {user.status}
          </Badge>
        </div>
        {user.enrolled_at && (
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t("partnerUsers.enrolled")}: </span>
              {format(new Date(user.enrolled_at), "PPP", { locale: dateLocale })}
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
                {t("partnerUsers.tabs.checkIns")}
              </TabsTrigger>
              <TabsTrigger value="labs" className="text-xs">
                <TestTube className="w-4 h-4 mr-1" />
                {t("partnerUsers.tabs.labs")}
              </TabsTrigger>
              <TabsTrigger value="dosing" className="text-xs">
                <Pill className="w-4 h-4 mr-1" />
                {t("partnerUsers.tabs.dosing")}
              </TabsTrigger>
              <TabsTrigger value="questionnaires" className="text-xs">
                <FileText className="w-4 h-4 mr-1" />
                {t("partnerUsers.tabs.forms")}
              </TabsTrigger>
              <TabsTrigger value="consents" className="text-xs">
                <ClipboardCheck className="w-4 h-4 mr-1" />
                {t("partnerUsers.tabs.consents")}
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
            {t("partnerUsers.noData")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

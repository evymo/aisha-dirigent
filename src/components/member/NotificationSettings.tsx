import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  BellRing,
  Clock3,
  Globe,
  Loader2,
  Mail,
  MoonStar,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useNotificationPreferences,
  type NotificationReminderPeriod,
  type UserNotificationPreferencesPatch,
} from "@/hooks/useNotificationPreferences";
import { useWebPushSubscription } from "@/hooks/useWebPushSubscription";

const reminderPeriods: NotificationReminderPeriod[] = ["morning", "afternoon", "evening"];

const getBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * User-facing notification settings for web (same backend preferences as mobile).
 */
export function NotificationSettings() {
  const { t } = useTranslation();
  const {
    notificationPreferences,
    isLoading,
    isError,
    isUpdating,
    updateNotificationPreferences,
  } = useNotificationPreferences();
  const {
    browserPushSupported,
    vapidConfigured,
    permission: browserPermission,
    activeSubscriptionCount,
    isCurrentBrowserSubscribed,
    isSyncing: isSyncingBrowserSubscription,
    isEnabling: isEnablingBrowserSubscription,
    isDisabling: isDisablingBrowserSubscription,
    syncSubscription,
    enableWebPush,
    disableWebPush,
  } = useWebPushSubscription({
    enabled: Boolean(notificationPreferences.push_enabled),
    autoSync: true,
  });

  const browserTimezone = useMemo(() => getBrowserTimezone(), []);
  const browserNotificationsSupported = browserPushSupported;

  const handlePatch = async (patch: UserNotificationPreferencesPatch) => {
    try {
      await updateNotificationPreferences({
        ...patch,
        user_timezone: patch.user_timezone ?? notificationPreferences.user_timezone ?? browserTimezone,
      });
    } catch {
      toast.error(t("profile.notifications.errors.saveFailed"));
    }
  };

  const handleBooleanToggle =
    (key: keyof UserNotificationPreferencesPatch) =>
    async (value: boolean): Promise<void> => {
      await handlePatch({ [key]: value });
    };

  const handleTimeChange =
    (key: keyof UserNotificationPreferencesPatch) =>
    async (value: string): Promise<void> => {
      if (!value) return;
      await handlePatch({ [key]: value });
    };

  const handleReminderPeriodChange = async (period: NotificationReminderPeriod): Promise<void> => {
    await handlePatch({ questionnaire_reminder_period: period });
  };

  const handleEnableBrowserPush = async () => {
    if (!browserNotificationsSupported || !vapidConfigured) return;
    try {
      await enableWebPush();
      toast.success(t("profile.notifications.browser.webPushEnabled"));
    } catch {
      toast.error(t("profile.notifications.errors.browserEnableFailed"));
    }
  };

  const handleDisableBrowserPush = async () => {
    if (!browserNotificationsSupported) return;
    try {
      await disableWebPush();
      toast.success(t("profile.notifications.browser.webPushDisabled"));
    } catch {
      toast.error(t("profile.notifications.errors.browserDisableFailed"));
    }
  };

  const handleSyncBrowserPush = async () => {
    if (!browserNotificationsSupported || browserPermission !== "granted") return;
    try {
      await syncSubscription();
    } catch {
      toast.error(t("profile.notifications.errors.browserSyncFailed"));
    }
  };

  const handleSyncTimezone = async () => {
    await handlePatch({ user_timezone: browserTimezone });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t("profile.notifications.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{t("profile.notifications.errors.loadFailed")}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          {t("profile.notifications.title")}
        </CardTitle>
        <CardDescription>{t("profile.notifications.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            {t("profile.notifications.sections.push")}
          </h3>

          <div className="rounded-md border p-3 flex items-center justify-between gap-4">
            <div>
              <Label>{t("profile.notifications.fields.pushEnabled")}</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("profile.notifications.fields.pushEnabledHint")}
              </p>
            </div>
            <Switch
              checked={notificationPreferences.push_enabled}
              disabled={isUpdating}
              onCheckedChange={handleBooleanToggle("push_enabled")}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.pushReminders")}</Label>
              <Switch
                checked={notificationPreferences.push_reminders}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onCheckedChange={handleBooleanToggle("push_reminders")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.pushTrackingInsights")}</Label>
              <Switch
                checked={notificationPreferences.push_health_insights}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onCheckedChange={handleBooleanToggle("push_health_insights")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.pushStudyUpdates")}</Label>
              <Switch
                checked={notificationPreferences.push_study_updates}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onCheckedChange={handleBooleanToggle("push_study_updates")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.pushAchievements")}</Label>
              <Switch
                checked={notificationPreferences.push_achievements}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onCheckedChange={handleBooleanToggle("push_achievements")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4 md:col-span-2">
              <Label>{t("profile.notifications.fields.pushLeaderboard")}</Label>
              <Switch
                checked={notificationPreferences.push_leaderboard}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onCheckedChange={handleBooleanToggle("push_leaderboard")}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <MoonStar className="h-4 w-4" />
            {t("profile.notifications.sections.quietHours")}
          </h3>

          <div className="rounded-md border p-3 flex items-center justify-between gap-4">
            <Label>{t("profile.notifications.fields.quietHoursEnabled")}</Label>
            <Switch
              checked={notificationPreferences.quiet_hours_enabled}
              disabled={isUpdating || !notificationPreferences.push_enabled}
              onCheckedChange={handleBooleanToggle("quiet_hours_enabled")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quiet-hours-start">
                {t("profile.notifications.fields.quietHoursStart")}
              </Label>
              <Input
                id="quiet-hours-start"
                type="time"
                value={notificationPreferences.quiet_hours_start}
                disabled={
                  isUpdating ||
                  !notificationPreferences.push_enabled ||
                  !notificationPreferences.quiet_hours_enabled
                }
                onChange={(event) => void handleTimeChange("quiet_hours_start")(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet-hours-end">
                {t("profile.notifications.fields.quietHoursEnd")}
              </Label>
              <Input
                id="quiet-hours-end"
                type="time"
                value={notificationPreferences.quiet_hours_end}
                disabled={
                  isUpdating ||
                  !notificationPreferences.push_enabled ||
                  !notificationPreferences.quiet_hours_enabled
                }
                onChange={(event) => void handleTimeChange("quiet_hours_end")(event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            {t("profile.notifications.sections.timing")}
          </h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="morning-start">{t("profile.notifications.fields.morningStart")}</Label>
              <Input
                id="morning-start"
                type="time"
                value={notificationPreferences.morning_start}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onChange={(event) => void handleTimeChange("morning_start")(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="afternoon-start">
                {t("profile.notifications.fields.afternoonStart")}
              </Label>
              <Input
                id="afternoon-start"
                type="time"
                value={notificationPreferences.afternoon_start}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onChange={(event) => void handleTimeChange("afternoon_start")(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evening-start">{t("profile.notifications.fields.eveningStart")}</Label>
              <Input
                id="evening-start"
                type="time"
                value={notificationPreferences.evening_start}
                disabled={isUpdating || !notificationPreferences.push_enabled}
                onChange={(event) => void handleTimeChange("evening_start")(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("profile.notifications.fields.questionnairePeriod")}</Label>
            <Select
              value={notificationPreferences.questionnaire_reminder_period}
              onValueChange={(value) =>
                void handleReminderPeriodChange(value as NotificationReminderPeriod)
              }
              disabled={isUpdating || !notificationPreferences.push_enabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reminderPeriods.map((period) => (
                  <SelectItem key={period} value={period}>
                    {t(`profile.notifications.periods.${period}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t("profile.notifications.sections.email")}
          </h3>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.emailWeeklySummary")}</Label>
              <Switch
                checked={notificationPreferences.email_weekly_summary}
                disabled={isUpdating}
                onCheckedChange={handleBooleanToggle("email_weekly_summary")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.emailMonthlyReport")}</Label>
              <Switch
                checked={notificationPreferences.email_monthly_report}
                disabled={isUpdating}
                onCheckedChange={handleBooleanToggle("email_monthly_report")}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between gap-4">
              <Label>{t("profile.notifications.fields.emailStudyInvitations")}</Label>
              <Switch
                checked={notificationPreferences.email_study_invitations}
                disabled={isUpdating}
                onCheckedChange={handleBooleanToggle("email_study_invitations")}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t("profile.notifications.sections.timezone")}
          </h3>

          <div className="rounded-md border p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("profile.notifications.fields.timezone")}</p>
              <p className="text-xs text-muted-foreground">
                {notificationPreferences.user_timezone}
              </p>
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={() => void handleSyncTimezone()}
              disabled={isUpdating || notificationPreferences.user_timezone === browserTimezone}
            >
              {t("profile.notifications.fields.syncTimezone")}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            {t("profile.notifications.sections.browser")}
          </h3>

          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>{t("profile.notifications.browser.permissionStatus")}</Label>
              <Badge variant={browserPermission === "granted" ? "default" : "secondary"}>
                {browserPermission === "granted" &&
                  t("profile.notifications.browser.permissionGranted")}
                {browserPermission === "denied" &&
                  t("profile.notifications.browser.permissionDenied")}
                {browserPermission === "default" &&
                  t("profile.notifications.browser.permissionDefault")}
                {browserPermission === "unsupported" &&
                  t("profile.notifications.browser.permissionUnsupported")}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("profile.notifications.browser.permissionHint")}
            </p>

            <div className="flex items-center justify-between gap-3">
              <Label>{t("profile.notifications.browser.subscriptionStatus")}</Label>
              <Badge variant={isCurrentBrowserSubscribed ? "default" : "secondary"}>
                {isCurrentBrowserSubscribed
                  ? t("profile.notifications.browser.subscriptionActive")
                  : t("profile.notifications.browser.subscriptionInactive")}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("profile.notifications.browser.activeDevices", {
                count: activeSubscriptionCount,
              })}
            </p>

            {browserPermission === "denied" && (
              <Alert>
                <AlertDescription>
                  {t("profile.notifications.browser.permissionDeniedHint")}
                </AlertDescription>
              </Alert>
            )}

            {!vapidConfigured && (
              <Alert variant="destructive">
                <AlertDescription>
                  {t("profile.notifications.browser.missingVapidConfigHint")}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleEnableBrowserPush()}
                disabled={
                  isUpdating ||
                  !browserNotificationsSupported ||
                  !vapidConfigured ||
                  isCurrentBrowserSubscribed ||
                  isEnablingBrowserSubscription
                }
              >
                {t("profile.notifications.browser.enableWebPush")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDisableBrowserPush()}
                disabled={
                  isUpdating ||
                  !browserNotificationsSupported ||
                  !isCurrentBrowserSubscribed ||
                  isDisablingBrowserSubscription
                }
              >
                {t("profile.notifications.browser.disableWebPush")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleSyncBrowserPush()}
                disabled={
                  isUpdating ||
                  !browserNotificationsSupported ||
                  browserPermission !== "granted" ||
                  isSyncingBrowserSubscription
                }
              >
                {t("profile.notifications.browser.syncCurrentBrowser")}
              </Button>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useUpsertNotificationCampaignSchedule,
  useDeleteNotificationCampaignSchedule,
  type NotificationCampaignScheduleInput,
} from "@/hooks/useAdminNotificationCampaigns";
import type { NotificationCampaignScheduleRow } from "@/lib/schemas/adminSchemas";
import {
  type ScheduleFormData,
  EMPTY_SCHEDULE_FORM,
  repeatOptionFromMinutes,
  resolveRepeatMinutes,
  toLocalDateTimeInput,
} from "./notificationTypes";

interface CampaignScheduleCardProps {
  campaignId: string | null;
  schedules: NotificationCampaignScheduleRow[];
}

export function CampaignScheduleCard({
  campaignId,
  schedules,
}: CampaignScheduleCardProps) {
  const { t } = useTranslation();
  const upsertSchedule = useUpsertNotificationCampaignSchedule();
  const deleteSchedule = useDeleteNotificationCampaignSchedule();

  const [scheduleForm, setScheduleForm] =
    useState<ScheduleFormData>(EMPTY_SCHEDULE_FORM);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  );

  const resetScheduleForm = () => {
    setEditingScheduleId(null);
    setScheduleForm(EMPTY_SCHEDULE_FORM);
  };

  const getRepeatLabel = (minutes: number | null) => {
    if (!minutes) return t("admin.notifications.schedule.repeatOnce");
    if (minutes === 1440) return t("admin.notifications.schedule.repeatDaily");
    if (minutes === 10080)
      return t("admin.notifications.schedule.repeatWeekly");
    if (minutes === 43200)
      return t("admin.notifications.schedule.repeatMonthly");
    return t("admin.notifications.schedule.repeatEveryMinutes", {
      count: minutes,
    });
  };

  const getScheduleStatusLabel = (status: string) => {
    switch (status) {
      case "scheduled":
        return t("admin.notifications.schedule.statuses.scheduled");
      case "running":
        return t("admin.notifications.schedule.statuses.running");
      case "completed":
        return t("admin.notifications.schedule.statuses.completed");
      case "paused":
        return t("admin.notifications.schedule.statuses.paused");
      case "failed":
        return t("admin.notifications.schedule.statuses.failed");
      default:
        return status;
    }
  };

  const getStatusVariant = (
    status: string
  ): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "failed":
        return "destructive";
      case "paused":
      case "partial":
        return "secondary";
      case "running":
      case "sent":
        return "default";
      default:
        return "outline";
    }
  };

  const handleSaveSchedule = async () => {
    if (!campaignId) {
      toast.error(t("admin.notifications.errors.selectCampaign"));
      return;
    }
    if (!scheduleForm.run_at) {
      toast.error(t("admin.notifications.errors.missingScheduleDate"));
      return;
    }

    const date = new Date(scheduleForm.run_at);
    if (Number.isNaN(date.getTime())) {
      toast.error(t("admin.notifications.errors.invalidScheduleDate"));
      return;
    }

    const repeatMinutes = resolveRepeatMinutes(
      scheduleForm.repeat,
      scheduleForm.custom_minutes
    );
    const payload: NotificationCampaignScheduleInput = {
      id: editingScheduleId ?? null,
      campaign_id: campaignId,
      run_at: date.toISOString(),
      repeat_interval_minutes: repeatMinutes,
      status: scheduleForm.status,
    };

    try {
      await upsertSchedule.mutateAsync(payload);
      resetScheduleForm();
      toast.success(
        editingScheduleId
          ? t("admin.notifications.toast.scheduleUpdated")
          : t("admin.notifications.toast.scheduleCreated")
      );
    } catch {
      toast.error(
        editingScheduleId
          ? t("admin.notifications.errors.scheduleUpdateFailed")
          : t("admin.notifications.errors.scheduleFailed")
      );
    }
  };

  const handleEditSchedule = (schedule: NotificationCampaignScheduleRow) => {
    setEditingScheduleId(schedule.id);
    const repeatOption = repeatOptionFromMinutes(
      schedule.repeat_interval_minutes ?? null
    );
    setScheduleForm({
      run_at: toLocalDateTimeInput(schedule.next_run_at || schedule.run_at),
      repeat: repeatOption,
      custom_minutes:
        repeatOption === "custom" && schedule.repeat_interval_minutes
          ? String(schedule.repeat_interval_minutes)
          : "",
      status: schedule.status === "paused" ? "paused" : "scheduled",
    });
  };

  const handleToggleScheduleStatus = async (
    schedule: NotificationCampaignScheduleRow
  ) => {
    if (!campaignId) return;
    const nextStatus =
      schedule.status === "paused" ? "scheduled" : "paused";
    const payload: NotificationCampaignScheduleInput = {
      id: schedule.id,
      campaign_id: schedule.campaign_id,
      run_at: schedule.next_run_at,
      repeat_interval_minutes: schedule.repeat_interval_minutes ?? null,
      status: nextStatus,
    };
    try {
      await upsertSchedule.mutateAsync(payload);
      toast.success(
        nextStatus === "paused"
          ? t("admin.notifications.toast.schedulePaused")
          : t("admin.notifications.toast.scheduleResumed")
      );
    } catch {
      toast.error(t("admin.notifications.errors.scheduleUpdateFailed"));
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!campaignId) return;
    try {
      await deleteSchedule.mutateAsync({ id, campaignId });
      toast.success(t("admin.notifications.toast.scheduleDeleted"));
    } catch {
      toast.error(t("admin.notifications.errors.scheduleDeleteFailed"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.notifications.schedule.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="schedule-run-at">
              {t("admin.notifications.schedule.runAt")}
            </Label>
            <Input
              id="schedule-run-at"
              type="datetime-local"
              value={scheduleForm.run_at}
              onChange={(e) =>
                setScheduleForm((prev) => ({
                  ...prev,
                  run_at: e.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{t("admin.notifications.schedule.repeat")}</Label>
            <Select
              value={scheduleForm.repeat}
              onValueChange={(value) =>
                setScheduleForm((prev) => ({
                  ...prev,
                  repeat: value as ScheduleFormData["repeat"],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">
                  {t("admin.notifications.schedule.repeatOnce")}
                </SelectItem>
                <SelectItem value="daily">
                  {t("admin.notifications.schedule.repeatDaily")}
                </SelectItem>
                <SelectItem value="weekly">
                  {t("admin.notifications.schedule.repeatWeekly")}
                </SelectItem>
                <SelectItem value="monthly">
                  {t("admin.notifications.schedule.repeatMonthly")}
                </SelectItem>
                <SelectItem value="custom">
                  {t("admin.notifications.schedule.repeatCustom")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("admin.notifications.schedule.status")}</Label>
            <Select
              value={scheduleForm.status}
              onValueChange={(value) =>
                setScheduleForm((prev) => ({
                  ...prev,
                  status: value as ScheduleFormData["status"],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">
                  {t("admin.notifications.schedule.statuses.scheduled")}
                </SelectItem>
                <SelectItem value="paused">
                  {t("admin.notifications.schedule.statuses.paused")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scheduleForm.repeat === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="schedule-custom-minutes">
                {t("admin.notifications.schedule.customMinutes")}
              </Label>
              <Input
                id="schedule-custom-minutes"
                type="number"
                min={1}
                value={scheduleForm.custom_minutes}
                onChange={(e) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    custom_minutes: e.target.value,
                  }))
                }
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSaveSchedule} disabled={!campaignId}>
            {editingScheduleId
              ? t("admin.notifications.actions.updateSchedule")
              : t("admin.notifications.actions.addSchedule")}
          </Button>
          {editingScheduleId && (
            <Button variant="ghost" onClick={resetScheduleForm}>
              {t("common.cancel")}
            </Button>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            {t("admin.notifications.schedule.listTitle")}
          </h3>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.notifications.schedule.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`flex flex-col gap-3 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${
                    editingScheduleId === schedule.id
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <div className="space-y-1">
                    <div className="font-medium">
                      {new Date(schedule.next_run_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {getRepeatLabel(schedule.repeat_interval_minutes)}
                    </div>
                    <Badge variant={getStatusVariant(schedule.status)}>
                      {getScheduleStatusLabel(schedule.status)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditSchedule(schedule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {(schedule.status === "scheduled" ||
                      schedule.status === "paused") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleScheduleStatus(schedule)}
                      >
                        {schedule.status === "paused" ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteSchedule(schedule.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Clock, Video, MapPin, Settings2 } from "lucide-react";
import {
  usePartnerAvailabilitySlots,
  usePartnerBookingSettings,
  useUpdatePartnerBookingSettings,
  useAddAvailabilitySlot,
  useDeleteAvailabilitySlot,
  useToggleAvailabilityOnline,
  type NewAvailabilitySlot,
} from "@/hooks/usePartnerAvailabilityManager";

interface PartnerAvailabilityManagerProps {
  partnerId: string;
}

export function PartnerAvailabilityManager({ partnerId }: PartnerAvailabilityManagerProps) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [newSlot, setNewSlot] = useState<NewAvailabilitySlot>({
    day_of_week: 1,
    start_time: "09:00",
    end_time: "17:00",
    is_online: true,
  });

  // Booking settings state
  const [slotDuration, setSlotDuration] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);

  const { data: bookingSettings, isLoading: isLoadingSettings } = usePartnerBookingSettings(partnerId);
  const updateSettingsMutation = useUpdatePartnerBookingSettings(partnerId);

  // Sync local state when data arrives
  useEffect(() => {
    if (bookingSettings) {
      setSlotDuration(bookingSettings.slot_duration_minutes);
      setBufferMinutes(bookingSettings.buffer_minutes);
    }
  }, [bookingSettings]);

  const settingsChanged =
    bookingSettings != null &&
    (slotDuration !== bookingSettings.slot_duration_minutes ||
      bufferMinutes !== bookingSettings.buffer_minutes);

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(
      { buffer_minutes: bufferMinutes, slot_duration_minutes: slotDuration },
      {
        onSuccess: () => toast.success(t("partnerDashboard.availability.bookingSettings.saved")),
        onError: () =>
          toast.error(t("partnerDashboard.availability.bookingSettings.errors.saveFailed")),
      }
    );
  };

  const daysOfWeek = [
    { value: 0, label: t("common.days.sunday") },
    { value: 1, label: t("common.days.monday") },
    { value: 2, label: t("common.days.tuesday") },
    { value: 3, label: t("common.days.wednesday") },
    { value: 4, label: t("common.days.thursday") },
    { value: 5, label: t("common.days.friday") },
    { value: 6, label: t("common.days.saturday") },
  ];

  const { data: availability, isLoading } = usePartnerAvailabilitySlots(partnerId);
  const addMutation = useAddAvailabilitySlot(partnerId);
  const deleteMutation = useDeleteAvailabilitySlot(partnerId);
  const toggleOnlineMutation = useToggleAvailabilityOnline(partnerId);

  const handleAdd = () => {
    addMutation.mutate(newSlot, {
      onSuccess: () => {
        toast.success(t("partnerDashboard.availability.added"));
        setIsAdding(false);
        setNewSlot({ day_of_week: 1, start_time: "09:00", end_time: "17:00", is_online: true });
      },
      onError: () => toast.error(t("partnerDashboard.availability.errors.addFailed")),
    });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success(t("partnerDashboard.availability.removed")),
      onError: () => toast.error(t("partnerDashboard.availability.errors.removeFailed")),
    });
  };

  const handleToggleOnline = (slotId: string, isOnline: boolean) => {
    toggleOnlineMutation.mutate(
      { slotId, isOnline },
      {
        onError: () => toast.error(t("partnerDashboard.availability.errors.updateFailed")),
      }
    );
  };

  const groupedAvailability = daysOfWeek.map((day) => ({
    ...day,
    slots: availability?.filter((a) => a.day_of_week === day.value) || [],
  }));

  if (isLoading && isLoadingSettings) {
    return <div className="p-4 text-center text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              {t("partnerDashboard.availability.title")}
            </CardTitle>
            <CardDescription>{t("partnerDashboard.availability.description")}</CardDescription>
          </div>
          <Button onClick={() => setIsAdding(true)} disabled={isAdding}>
            <Plus className="w-4 h-4 mr-2" />
            {t("partnerDashboard.availability.addSlot")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Booking Settings (slot duration + buffer) ──────── */}
        <div className="p-4 border rounded-lg space-y-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <h4 className="font-medium">
              {t("partnerDashboard.availability.bookingSettings.title")}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("partnerDashboard.availability.bookingSettings.description")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="slot-duration">
                {t("partnerDashboard.availability.bookingSettings.slotDuration")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="slot-duration"
                  type="number"
                  min={10}
                  max={240}
                  step={5}
                  value={slotDuration}
                  onChange={(e) => setSlotDuration(Number(e.target.value))}
                  className="w-24"
                  disabled={isLoadingSettings}
                />
                <span className="text-sm text-muted-foreground">
                  {t("partnerDashboard.availability.bookingSettings.minutes")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("partnerDashboard.availability.bookingSettings.slotDurationDescription")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="buffer-time">
                {t("partnerDashboard.availability.bookingSettings.bufferTime")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="buffer-time"
                  type="number"
                  min={0}
                  max={60}
                  step={5}
                  value={bufferMinutes}
                  onChange={(e) => setBufferMinutes(Number(e.target.value))}
                  className="w-24"
                  disabled={isLoadingSettings}
                />
                <span className="text-sm text-muted-foreground">
                  {t("partnerDashboard.availability.bookingSettings.minutes")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("partnerDashboard.availability.bookingSettings.bufferTimeDescription")}
              </p>
            </div>
          </div>

          {settingsChanged && (
            <Button
              onClick={handleSaveSettings}
              disabled={updateSettingsMutation.isPending}
              size="sm"
            >
              {t("common.save")}
            </Button>
          )}
        </div>

        {isAdding && (
          <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
            <h4 className="font-medium">{t("partnerDashboard.availability.newSlot")}</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>{t("partnerDashboard.availability.day")}</Label>
                <Select
                  value={newSlot.day_of_week.toString()}
                  onValueChange={(v) => setNewSlot({ ...newSlot, day_of_week: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {daysOfWeek.map((day) => (
                      <SelectItem key={day.value} value={day.value.toString()}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("partnerDashboard.availability.startTime")}</Label>
                <Input
                  type="time"
                  value={newSlot.start_time}
                  onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("partnerDashboard.availability.endTime")}</Label>
                <Input
                  type="time"
                  value={newSlot.end_time}
                  onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("partnerDashboard.availability.type")}</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    checked={newSlot.is_online}
                    onCheckedChange={(checked) => setNewSlot({ ...newSlot, is_online: checked })}
                  />
                  <span className="text-sm">
                    {newSlot.is_online ? (
                      <span className="flex items-center gap-1">
                        <Video className="w-4 h-4" /> {t("partnerDashboard.availability.online")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" /> {t("partnerDashboard.availability.inPerson")}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={addMutation.isPending}>
                {t("common.save")}
              </Button>
              <Button variant="outline" onClick={() => setIsAdding(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {groupedAvailability.map((day) => (
            <div key={day.value} className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">{day.label}</h4>
              {day.slots.length === 0 ? (
                <p className="text-sm text-muted-foreground/60 italic">
                  {t("partnerDashboard.availability.noSlots")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {day.slots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center gap-2 p-2 border rounded-lg bg-background"
                    >
                      <Badge variant={slot.is_online ? "default" : "secondary"}>
                        {slot.is_online ? <Video className="w-3 h-3 mr-1" /> : <MapPin className="w-3 h-3 mr-1" />}
                        {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                      </Badge>
                      <Switch
                        checked={slot.is_online}
                        onCheckedChange={(checked) => handleToggleOnline(slot.id, checked)}
                        className="scale-75"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => handleDelete(slot.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

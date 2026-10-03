import { useState, useEffect, useMemo, useRef } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { format, isBefore, isToday } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useSecureMode } from "@/hooks/useSecureMode";
import {
  useCreateAppointment,
  usePartnerFreeSlots,
  PartnerProfile,
  PartnerFreeSlot,
} from "@/hooks/usePartners";
import { Calendar as CalendarIcon, Clock, Video, MapPin, CheckCircle2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { fetchPhiProfilePrefill } from "@/lib/security/secureProfilePrefill";
import { useIsMountedRef } from "@/hooks/useIsMountedRef";

interface PartnerBookingDialogProps {
  partner: PartnerProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PartnerBookingDialog({ partner, open, onOpenChange }: PartnerBookingDialogProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, isEnabling, enableWithPassword, secureClient } = useSecureMode();

  const isMountedRef = useIsMountedRef();
  const closeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [step, setStep] = useState<"date" | "time" | "details" | "confirm">("date");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedEndTime, setSelectedEndTime] = useState<string>("");
  const [appointmentType, setAppointmentType] = useState<"online" | "in_person">("online");
  const [selectedService, setSelectedService] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  
  // Tracking data sharing state
  const [shareTrackingData, setShareTrackingData] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  
  const canUsePassword = useMemo(() => Boolean(user?.email), [user?.email]);
  
  // Use sensitive data client for appointments if sharing health data, otherwise use regular client
  const createAppointment = useCreateAppointment({
    client: (shareTrackingData && isPhiEnabled && secureClient) ? secureClient : undefined
  });

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;

  // Single RPC: free slots computed server-side (availability - booked)
  const freeSlotsQuery = usePartnerFreeSlots(partner.id, dateStr, {
    enabled: open && !!dateStr,
  });

  const freeSlots = freeSlotsQuery.data;

  const isTimesLoading =
    step === "time" && freeSlotsQuery.isLoading && !freeSlots;

  const locale = getDateFnsLocale(i18n.language);

  useEffect(() => {
    return () => {
      if (closeResetTimerRef.current) {
        clearTimeout(closeResetTimerRef.current);
        closeResetTimerRef.current = null;
      }
    };
  }, []);

  // Pre-fill notes with user's health context if available and secure mode is enabled
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user || notes) return;

      // Only prefill sensitive data into notes if user chose to share health data AND secure mode is enabled
      if (!shareTrackingData || !isPhiEnabled || !secureClient) return;
      
      const profile = await fetchPhiProfilePrefill({ client: secureClient });

      if (profile) {
        const contextParts: string[] = [];
        if (profile.primary_diagnosis) {
          contextParts.push(`${t("profile.trackingInfo.primaryDiagnosis")}: ${profile.primary_diagnosis}`);
        }
        if (profile.current_medications) {
          contextParts.push(`${t("profile.trackingInfo.currentMedications")}: ${profile.current_medications}`);
        }
        if (profile.allergies) {
          contextParts.push(`${t("profile.trackingInfo.allergies")}: ${profile.allergies}`);
        }
        
        if (contextParts.length > 0) {
          if (isMountedRef.current) {
            setNotes(contextParts.join("\n"));
          }
        }
      }
    };

    if (open && step === "details" && shareTrackingData && isPhiEnabled) {
      fetchProfile();
    }
  }, [user, open, step, t, notes, isPhiEnabled, secureClient, shareTrackingData, isMountedRef]);

  // Handle inline password submission
  const handleUnlockPhi = async () => {
    if (isMountedRef.current) {
      setPasswordError(null);
    }

    const result = await enableWithPassword(password);
    if (result.ok === false) {
      if (isMountedRef.current) {
        setPasswordError(result.message);
      }
      return;
    }

    if (isMountedRef.current) {
      setPassword("");
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedTime("");
    setSelectedEndTime("");
    if (date) {
      setStep("time");
    }
  };

  const handleTimeSelect = (slot: PartnerFreeSlot) => {
    setSelectedTime(slot.start_time);
    setSelectedEndTime(slot.end_time);
    setStep("details");
  };

  const handleSubmit = async () => {
    if (!user || !selectedDate || !selectedTime) return;

    // If user wants to share health data, secure mode must be enabled
    if (shareTrackingData && (!isPhiEnabled || !secureClient)) {
      toast(t("phiMode.title"), {
        description: t("partners.booking.unlockPhiFirst"),
      });
      return;
    }

    if (isMountedRef.current) {
      setIsSubmitting(true);
    }
    try {
      await createAppointment.mutateAsync({
        partner_id: partner.id,
        member_id: user.id,
        appointment_date: format(selectedDate, "yyyy-MM-dd"),
        start_time: selectedTime,
        end_time: selectedEndTime,
        appointment_type: appointmentType,
        notes: notes || undefined,
        service: selectedService || undefined,
      });

      if (isMountedRef.current) {
        setBookingComplete(true);
        setStep("confirm");
      }

      toast.success(t("partners.booking.success"), {
        description: t("partners.booking.successDesc"),
      });
    } catch (error) {
      toast.error(t("common.error"), {
        description: t("partners.booking.error"),
      });
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after close animation
    if (closeResetTimerRef.current) {
      clearTimeout(closeResetTimerRef.current);
      closeResetTimerRef.current = null;
    }

    closeResetTimerRef.current = setTimeout(() => {
      closeResetTimerRef.current = null;
      if (!isMountedRef.current) return;

      setStep("date");
      setSelectedDate(undefined);
      setSelectedTime("");
      setSelectedEndTime("");
      setAppointmentType("online");
      setSelectedService("");
      setNotes("");
      setBookingComplete(false);
      setShareTrackingData(false);
      setPassword("");
      setPasswordError(null);
    }, 300);
  };

  // Determine if we need to show password form inline
  const needsPasswordForTrackingData = shareTrackingData && !isPhiEnabled && canUsePassword;

  const disabledDays = (date: Date) => {
    return isBefore(date, new Date()) && !isToday(date);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {bookingComplete
              ? t("partners.booking.confirmed")
              : t("partners.booking.title", { name: partner.display_name })}
          </DialogTitle>
          {!bookingComplete && (
            <DialogDescription>
              {step === "date" && t("partners.booking.selectDate")}
              {step === "time" && t("partners.booking.selectTime")}
              {step === "details" && t("partners.booking.enterDetails")}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Booking Complete */}
        {bookingComplete && (
          <div className="text-center py-6">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("partners.booking.thankYou")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("partners.booking.confirmationSent")}
            </p>
            <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CalendarIcon className="h-4 w-4" />
                <span>{selectedDate && format(selectedDate, "PPP", { locale })}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" />
                <span>{selectedTime} – {selectedEndTime}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {appointmentType === "online" ? (
                  <Video className="h-4 w-4" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                <span>
                  {appointmentType === "online"
                    ? t("partners.online")
                    : t("partners.inPerson")}
                </span>
              </div>
            </div>
            <Button onClick={handleClose} className="mt-6">
              {t("common.back")}
            </Button>
          </div>
        )}

        {/* Step: Date Selection */}
        {step === "date" && !bookingComplete && (
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={disabledDays}
              locale={locale}
              className="p-3 pointer-events-auto"
            />
          </div>
        )}

        {/* Step: Time Selection */}
        {step === "time" && !bookingComplete && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              <span>{selectedDate && format(selectedDate, "PPP", { locale })}</span>
              <Button variant="link" size="sm" onClick={() => setStep("date")}>
                {t("common.cancel")}
              </Button>
            </div>

            {isTimesLoading ? (
              <p className="text-center text-muted-foreground py-4">{t("common.loading")}</p>
            ) : (freeSlots ?? []).length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {(freeSlots ?? []).map((slot) => (
                  <Button
                    key={slot.start_time}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTimeSelect(slot)}
                    className={cn(
                      selectedTime === slot.start_time && "ring-2 ring-primary"
                    )}
                  >
                    {slot.start_time}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                {t("partners.booking.noTimes")}
              </p>
            )}
          </div>
        )}

        {/* Step: Details */}
        {step === "details" && !bookingComplete && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                <span>{selectedDate && format(selectedDate, "PPP", { locale })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{selectedTime} – {selectedEndTime}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label>{t("partners.booking.appointmentType")}</Label>
              <RadioGroup
                value={appointmentType}
                onValueChange={(v) => setAppointmentType(v as "online" | "in_person")}
                className="flex gap-4"
              >
                {partner.accepts_online_appointments && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="online" id="online" />
                    <label htmlFor="online" className="flex items-center gap-1 cursor-pointer">
                      <Video className="h-4 w-4" />
                      {t("partners.online")}
                    </label>
                  </div>
                )}
                {partner.accepts_in_person_appointments && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="in_person" id="in_person" />
                    <label htmlFor="in_person" className="flex items-center gap-1 cursor-pointer">
                      <MapPin className="h-4 w-4" />
                      {t("partners.inPerson")}
                    </label>
                  </div>
                )}
              </RadioGroup>
            </div>

            {partner.services.length > 0 && (
              <div className="space-y-2">
                <Label>{t("partners.booking.service")}</Label>
                <Select value={selectedService} onValueChange={setSelectedService}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("partners.booking.selectService")} />
                  </SelectTrigger>
                  <SelectContent>
                    {partner.services.map((service) => (
                      <SelectItem key={service} value={service}>
                        {t(`partnerCertification.services.${service}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Tracking data sharing checkbox and inline password form */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="shareTrackingData"
                  checked={shareTrackingData}
                  onCheckedChange={(checked) => setShareTrackingData(checked === true)}
                />
                <div className="space-y-1">
                  <label
                    htmlFor="shareTrackingData"
                    className="text-sm font-medium cursor-pointer"
                  >
                    {t("partners.booking.shareTrackingData")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("partners.booking.shareTrackingDataDesc")}
                  </p>
                </div>
              </div>

              {/* Inline password form when health data sharing is requested but sensitive data not enabled */}
              {needsPasswordForTrackingData && (
                <div className="ml-6 p-3 bg-muted/50 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Lock className="h-4 w-4" />
                    {t("partners.booking.confirmPassword")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("partners.booking.confirmPasswordDesc")}
                  </p>
                  <div className="space-y-2">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("phiMode.passwordPlaceholder")}
                      autoComplete="current-password"
                    />
                    {passwordError && (
                      <Alert variant="destructive" className="py-2">
                        <AlertDescription className="text-xs">{passwordError}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleUnlockPhi}
                      disabled={!password || isEnabling}
                      className="w-full"
                    >
                      {isEnabling ? t("common.processing") : t("partners.booking.unlockTrackingData")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Show success message when secure mode is enabled after password entry */}
              {shareTrackingData && isPhiEnabled && (
                <div className="ml-6 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("partners.booking.healthDataUnlocked")}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("partners.booking.notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("partners.booking.notesPlaceholder")}
                rows={3}
              />
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep("time")}>
                {t("common.back")}
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={isSubmitting || (shareTrackingData && !isPhiEnabled)}
              >
                {isSubmitting ? t("common.saving") : t("partners.booking.confirm")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Consultation booking dialog — book a specialist via marketplace.
 *
 * @module components/marketplace/BookingDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateBooking } from "@/hooks/useConsultationBooking";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { Loader2, Calendar, Clock, Zap } from "lucide-react";

interface BookingDialogProps {
  specialistId: string;
  specialistName: string;
  hourlyRate: number | null;
  minBlockHours: number | null;
  instantBooking: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog for creating a consultation booking.
 *
 * @example
 * <BookingDialog
 *   specialistId={member.id}
 *   specialistName={member.display_name}
 *   hourlyRate={3250}
 *   minBlockHours={4}
 *   instantBooking={true}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 * />
 */
export function BookingDialog({
  specialistId,
  specialistName,
  hourlyRate,
  minBlockHours,
  instantBooking,
  open,
  onOpenChange,
}: BookingDialogProps) {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const createBooking = useCreateBooking();

  const effectiveMinBlock = minBlockHours ?? 1;
  const [durationHours, setDurationHours] = useState(effectiveMinBlock);
  const [description, setDescription] = useState("");
  const [communicationPreference, setCommunicationPreference] = useState("video");
  const [urgency, setUrgency] = useState("normal");

  const estimatedPrice = hourlyRate != null ? durationHours * hourlyRate : null;

  const handleSubmit = () => {
    if (durationHours < effectiveMinBlock) {
      toast.error(
        t("guild.booking.minBlockError", { hours: effectiveMinBlock })
      );
      return;
    }

    if (!description.trim()) {
      toast.error(t("guild.booking.descriptionRequired"));
      return;
    }

    createBooking.mutate(
      {
        specialistId: specialistId,
        durationHours: durationHours,
        description: description.trim(),
        preferredCommunication: communicationPreference,
        urgency: urgency,
      },
      {
        onSuccess: () => {
          toast.success(t("guild.booking.success"));
          onOpenChange(false);
          resetForm();
        },
        onError: (error) => {
          safeError("BookingDialog.createBooking", error);
          toast.error(t("guild.booking.error"));
        },
      }
    );
  };

  const resetForm = () => {
    setDurationHours(effectiveMinBlock);
    setDescription("");
    setCommunicationPreference("video");
    setUrgency("normal");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t("guild.booking.title")}
          </DialogTitle>
          <DialogDescription>
            {t("guild.booking.subtitle", { name: specialistName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="duration" className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {t("guild.booking.duration")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="duration"
                type="number"
                min={effectiveMinBlock}
                max={160}
                step={1}
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">h</span>
              {effectiveMinBlock > 1 && (
                <span className="text-xs text-muted-foreground ml-2">
                  (min. {effectiveMinBlock}h)
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">
              {t("guild.booking.description")}
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("guild.booking.descriptionPlaceholder")}
              rows={4}
            />
          </div>

          {/* Communication Preference */}
          <div className="space-y-2">
            <Label>{t("guild.booking.communication")}</Label>
            <Select
              value={communicationPreference}
              onValueChange={setCommunicationPreference}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">
                  {t("guild.booking.commVideo")}
                </SelectItem>
                <SelectItem value="in_person">
                  {t("guild.booking.commInPerson")}
                </SelectItem>
                <SelectItem value="phone">
                  {t("guild.booking.commPhone")}
                </SelectItem>
                <SelectItem value="chat">
                  {t("guild.booking.commChat")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Urgency */}
          <div className="space-y-2">
            <Label>{t("guild.booking.urgency")}</Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">
                  {t("guild.booking.urgencyLow")}
                </SelectItem>
                <SelectItem value="normal">
                  {t("guild.booking.urgencyNormal")}
                </SelectItem>
                <SelectItem value="high">
                  {t("guild.booking.urgencyHigh")}
                </SelectItem>
                <SelectItem value="critical">
                  {t("guild.booking.urgencyCritical")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Price Estimate */}
          <div className="rounded-lg bg-muted p-4 space-y-1">
            {hourlyRate != null && estimatedPrice != null ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("guild.booking.rate")}
                  </span>
                  <span>{formatPrice(hourlyRate)}/h</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("guild.booking.duration")}
                  </span>
                  <span>{durationHours}h</span>
                </div>
                <div className="flex items-center justify-between font-semibold pt-2 border-t">
                  <span>{t("guild.booking.estimatedPrice")}</span>
                  <span>{formatPrice(estimatedPrice)}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t("guild.marketplace.card.priceOnRequest")}
              </p>
            )}
            {instantBooking && (
              <p className="text-xs text-yellow-600 flex items-center gap-1 mt-2">
                <Zap className="h-3 w-3" />
                {t("guild.booking.instantNote")}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createBooking.isPending || !description.trim()}
              className="flex-1"
            >
              {createBooking.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {t("guild.booking.confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rating dialog — client rates a specialist after consultation.
 *
 * @module components/marketplace/RatingDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRateSpecialist } from "@/hooks/useSpecialistRatings";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { Star, Loader2 } from "lucide-react";

interface RatingDialogProps {
  bookingId: string;
  specialistId: string;
  specialistName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Interactive star selector with hover state */
function StarRating({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(star)}
            className="p-0.5 focus:outline-none focus:ring-1 focus:ring-primary rounded"
            aria-label={`${star} star`}
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                star <= (hovered || value)
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Dialog for rating a specialist after a completed booking.
 *
 * @example
 * <RatingDialog
 *   bookingId={booking.id}
 *   specialistId={booking.specialist_id}
 *   specialistName="Jan Novák"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 * />
 */
export function RatingDialog({
  bookingId,
  specialistId,
  specialistName,
  open,
  onOpenChange,
}: RatingDialogProps) {
  const { t } = useTranslation();
  const rateSpecialist = useRateSpecialist();

  const [overallRating, setOverallRating] = useState(0);
  const [communicationRating, setCommunicationRating] = useState(0);
  const [expertiseRating, setExpertiseRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [comment, setComment] = useState("");

  const isValid = overallRating > 0;

  const handleSubmit = () => {
    if (!isValid) return;

    rateSpecialist.mutate(
      {
        bookingId: bookingId,
        ratingOverall: overallRating,
        ratingCommunication: communicationRating || undefined,
        ratingExpertise: expertiseRating || undefined,
        ratingDelivery: deliveryRating || undefined,
        comment: comment.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t("guild.rating.success"));
          onOpenChange(false);
          resetForm();
        },
        onError: (error) => {
          safeError("RatingDialog.rateSpecialist", error);
          toast.error(t("guild.rating.error"));
        },
      }
    );
  };

  const resetForm = () => {
    setOverallRating(0);
    setCommunicationRating(0);
    setExpertiseRating(0);
    setDeliveryRating(0);
    setComment("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5" />
            {t("guild.rating.title")}
          </DialogTitle>
          <DialogDescription>
            {t("guild.rating.subtitle", { name: specialistName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Overall Rating (required) */}
          <StarRating
            value={overallRating}
            onChange={setOverallRating}
            label={t("guild.rating.overall")}
          />

          {/* Sub-ratings (optional) */}
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {t("guild.rating.optionalSubratings")}
            </p>
            <StarRating
              value={communicationRating}
              onChange={setCommunicationRating}
              label={t("guild.rating.communication")}
            />
            <StarRating
              value={expertiseRating}
              onChange={setExpertiseRating}
              label={t("guild.rating.expertise")}
            />
            <StarRating
              value={deliveryRating}
              onChange={setDeliveryRating}
              label={t("guild.rating.delivery")}
            />
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="rating-comment">
              {t("guild.rating.comment")}
            </Label>
            <Textarea
              id="rating-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("guild.rating.commentPlaceholder")}
              rows={3}
            />
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
              disabled={!isValid || rateSpecialist.isPending}
              className="flex-1"
            >
              {rateSpecialist.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {t("guild.rating.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

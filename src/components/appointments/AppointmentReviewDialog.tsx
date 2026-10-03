import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCreateAppointmentReview, useUpdateAppointmentReview, useAppointmentReview } from "@/hooks/usePartnerReviews";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AppointmentReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  partnerId: string;
  partnerName: string;
}

export function AppointmentReviewDialog({
  open,
  onOpenChange,
  appointmentId,
  partnerId,
  partnerName,
}: AppointmentReviewDialogProps) {
  const { t } = useTranslation();
  const { data: existingReview } = useAppointmentReview(appointmentId);
  const createReview = useCreateAppointmentReview();
  const updateReview = useUpdateAppointmentReview();

  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment || "");

  // Update state when existing review loads
  useState(() => {
    if (existingReview) {
      setRating(existingReview.rating);
      setComment(existingReview.comment || "");
    }
  });

  const handleSubmit = async () => {
    if (rating === 0) return;

    try {
      if (existingReview) {
        await updateReview.mutateAsync({
          id: existingReview.id,
          rating,
          comment,
        });
      } else {
        await createReview.mutateAsync({
          appointmentId,
          partnerId,
          rating,
          comment,
        });
      }
      toast.success(t("appointmentReview.success"));
      onOpenChange(false);
    } catch (error) {
      toast.error(t("common.error"));
    }
  };

  const isLoading = createReview.isPending || updateReview.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("appointmentReview.title")}</DialogTitle>
          <DialogDescription>
            {t("appointmentReview.description")} - {partnerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Star Rating */}
          <div className="space-y-2">
            <Label>{t("orderReview.rating")}</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      "h-8 w-8 transition-colors",
                      (hoveredRating || rating) >= star
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="comment">{t("orderReview.comment")}</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("orderReview.commentPlaceholder")}
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={rating === 0 || isLoading}>
            {isLoading ? t("common.saving") : t("common.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
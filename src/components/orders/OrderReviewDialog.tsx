import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useOrderReviews, OrderReview } from '@/hooks/useOrderReviews';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OrderReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  existingReview?: OrderReview | null;
  onSuccess?: () => void;
}

export const OrderReviewDialog = ({
  open,
  onOpenChange,
  orderId,
  existingReview,
  onSuccess,
}: OrderReviewDialogProps) => {
  const { t } = useTranslation();
  const { createReview, updateReview, loading } = useOrderReviews();
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment || '');

  useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating);
      setComment(existingReview.comment || '');
    } else {
      setRating(0);
      setComment('');
    }
  }, [existingReview, open]);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error(t('orderReview.ratingRequired'));
      return;
    }

    let result;
    if (existingReview) {
      result = await updateReview(existingReview.id, rating, comment);
    } else {
      result = await createReview(orderId, rating, comment);
    }

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(
        existingReview
          ? t('orderReview.updateSuccess')
          : t('orderReview.createSuccess')
      );
      onOpenChange(false);
      onSuccess?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existingReview
              ? t('orderReview.editTitle')
              : t('orderReview.title')}
          </DialogTitle>
          <DialogDescription>
            {t('orderReview.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('orderReview.rating')}</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className="p-1 transition-transform hover:scale-110"
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  onClick={() => setRating(star)}
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      (hoveredRating || rating) >= star
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground/30'
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment">{t('orderReview.comment')}</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('orderReview.commentPlaceholder')}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || rating === 0}>
            {loading
              ? t('common.saving')
              : existingReview
              ? t('common.update')
              : t('common.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

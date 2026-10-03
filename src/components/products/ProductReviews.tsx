import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductReviews, ProductReview } from "@/hooks/useProductReviews";
import { cn } from "@/lib/utils";

interface ProductReviewsProps {
  productSlug: string;
}

function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  const iconSize = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            iconSize,
            star <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          )}
        />
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: ProductReview }) {
  const displayName = review.profile?.display_name || "Anonymous";
  const initials = displayName.charAt(0).toUpperCase();
  
  return (
    <div className="p-4 bg-muted/30 rounded-xl space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-medium text-primary">{initials}</span>
          </div>
          <div>
            <p className="font-medium text-sm">{displayName}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(review.created_at).toLocaleDateString("cs-CZ", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
        <StarRating rating={review.rating} />
      </div>
      {review.comment && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {review.comment}
        </p>
      )}
    </div>
  );
}

export function ProductReviews({ productSlug }: ProductReviewsProps) {
  const { t } = useTranslation();
  const { reviews, stats, loading } = useProductReviews(productSlug);

  if (loading) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <Skeleton className="h-8 w-48 mx-auto mb-8" />
            <div className="space-y-4">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (stats.totalReviews === 0) {
    return null; // Don't show section if no reviews
  }

  return (
    <section className="py-16 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-serif font-semibold text-foreground text-center mb-8">
            {t("productReviews.title")}
          </h2>

          {/* Stats Overview */}
          <Card className="mb-8">
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Average Rating */}
                <div className="text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                    <span className="text-4xl font-bold">{stats.averageRating.toFixed(1)}</span>
                    <div>
                      <StarRating rating={Math.round(stats.averageRating)} size="lg" />
                      <p className="text-sm text-muted-foreground mt-1">
                        {t("productReviews.basedOn", { count: stats.totalReviews })}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rating Distribution */}
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((rating) => {
                    const count = stats.ratingDistribution[rating] || 0;
                    const percentage = stats.totalReviews > 0 
                      ? (count / stats.totalReviews) * 100 
                      : 0;
                    
                    return (
                      <div key={rating} className="flex items-center gap-2">
                        <span className="text-sm w-3">{rating}</span>
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <Progress value={percentage} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-8">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reviews List */}
          <div className="space-y-4">
            {reviews.slice(0, 5).map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>

          {reviews.length > 5 && (
            <p className="text-center text-sm text-muted-foreground mt-6">
              {t("productReviews.showingLatest", { shown: 5, total: reviews.length })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

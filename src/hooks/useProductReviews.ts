import { useState, useEffect } from 'react';
import { aisha } from '@/integrations/db/client';
import { safeError } from "@/lib/security/safeLogger";
import { useIsMountedRef } from './useIsMountedRef';

const isRpcNotFoundOrPermissionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; status?: number };
  // PostgREST / Supabase commonly uses:
  // - PGRST202 for missing function
  // - 42883 for undefined function
  // - 42501 for permission denied
  return (
    maybeError.code === "PGRST202" ||
    maybeError.code === "42883" ||
    maybeError.code === "42501" ||
    maybeError.status === 401 ||
    maybeError.status === 403 ||
    maybeError.status === 404
  );
};

/**
 * Represents a user review for a product.
 */
export interface ProductReview {
  /** Unique identifier for the review */
  id: string;
  /** Rating given (1-5) */
  rating: number;
  /** Optional text comment */
  comment: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Profile of the reviewer */
  profile: {
    /** Display name of the reviewer */
    display_name: string | null;
  } | null;
}

/**
 * Aggregated statistics for product reviews.
 */
export interface ProductReviewStats {
  /** Average rating (1-5) */
  averageRating: number;
  /** Total number of reviews */
  totalReviews: number;
  /** Distribution of ratings (count per star level) */
  ratingDistribution: Record<number, number>;
}

/**
 * Hook to fetch reviews and statistics for a specific product.
 * 
 * @param productSlug - The slug of the product to fetch reviews for.
 * @returns Object containing reviews, statistics, and loading state.
 */
export const useProductReviews = (productSlug: string) => {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [stats, setStats] = useState<ProductReviewStats>({
    averageRating: 0,
    totalReviews: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
  const [loading, setLoading] = useState(true);
  const isMountedRef = useIsMountedRef();

  useEffect(() => {
    const fetchReviews = async () => {
      if (isMountedRef.current) {
        setLoading(true);
      }
      try {
        // Get reviews via RPC-only
        const { data: reviewsData, error } = await aisha.rpc("get_product_reviews_with_stats", {
          p_product_slug: productSlug,
        });

        if (error) {
          // If the RPC isn't deployed yet or isn't accessible, fail closed to empty state.
          if (isRpcNotFoundOrPermissionError(error)) {
            if (isMountedRef.current) {
              setReviews([]);
              setStats({
                averageRating: 0,
                totalReviews: 0,
                ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
              });
            }
            return;
          }
          throw new Error(error.message);
        }

        if (reviewsData && reviewsData.length > 0) {
          const reviewsWithProfiles: ProductReview[] = (reviewsData as {
            review_id: string;
            rating: number;
            comment: string | null;
            created_at: string;
            display_name: string;
          }[]).map((r) => ({
            id: r.review_id,
            rating: r.rating,
            comment: r.comment,
            created_at: r.created_at,
            profile: { display_name: r.display_name },
          }));

          if (isMountedRef.current) {
            setReviews(reviewsWithProfiles);
          }

          // Calculate stats
          const totalReviews = reviewsWithProfiles.length;
          const totalRating = reviewsWithProfiles.reduce((sum, r) => sum + r.rating, 0);
          const averageRating = totalReviews > 0 ? totalRating / totalReviews : 0;

          const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          reviewsWithProfiles.forEach((r) => {
            distribution[r.rating] = (distribution[r.rating] || 0) + 1;
          });

          if (isMountedRef.current) {
            setStats({
              averageRating,
              totalReviews,
              ratingDistribution: distribution,
            });
          }
        } else {
          if (isMountedRef.current) {
            setReviews([]);
            setStats({
              averageRating: 0,
              totalReviews: 0,
              ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            });
          }
        }
      } catch (error) {
        safeError("useProductReviews.fetch", error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    if (productSlug) {
      fetchReviews();
    }
  }, [productSlug, isMountedRef]);

  return { reviews, stats, loading };
};

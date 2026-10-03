import { useState } from 'react';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from "@/lib/security/safeLogger";
import { useIsMountedRef } from './useIsMountedRef';
import { parseArrayResponseSafe } from '@/lib/schemas/hookSchemas';
import { 
  orderReviewArraySchema, 
  type OrderReviewRpc 
} from '@/lib/schemas/orderReviewSchemas';

export type OrderReview = OrderReviewRpc;

/**
 * Hook for managing order reviews.
 * Allows fetching, creating, and updating reviews for orders.
 *
 * @returns Object containing loading state and review management functions.
 */
export const useOrderReviews = () => {
  const { user } = useSession();
  const [loading, setLoading] = useState(false);
  const isMountedRef = useIsMountedRef();

  const getReviewForOrder = async (orderId: string): Promise<OrderReview | null> => {
    if (!user) return null;

    // RPC-only: use get_order_review_by_order function
    const { data, error } = await aisha.rpc("get_order_review_by_order", {
      p_order_id: orderId,
    });

    if (error) {
      if (error.code !== 'PGRST116') { // No rows found
        safeError('Error fetching review', error);
      }
      return null;
    }

    // Validate with Zod and get first element
    const reviews = parseArrayResponseSafe(
      orderReviewArraySchema,
      data,
      "get_order_review_by_order"
    );
    return reviews.length > 0 ? reviews[0] : null;
  };

  const createReview = async (
    orderId: string,
    rating: number,
    comment?: string
  ): Promise<{ data: OrderReview | null; error: string | null }> => {
    if (!user) return { data: null, error: 'User not authenticated' };

    if (isMountedRef.current) {
      setLoading(true);
    }
    try {
      // RPC-only: use create_order_review_full function
      const { data, error } = await aisha.rpc("create_order_review_full", {
        p_comment: comment ?? undefined
,
        p_order_id: orderId,
        p_rating: rating
    });

      if (error) throw new Error(error.message);

      // Validate with Zod
      const reviews = parseArrayResponseSafe(
        orderReviewArraySchema,
        data,
        "create_order_review_full"
      );
      return { data: reviews.length > 0 ? reviews[0] : null, error: null };
    } catch (error) {
      safeError('Error creating review', error);
      return { data: null, error: 'review_creation_failed' };
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const updateReview = async (
    reviewId: string,
    rating: number,
    comment?: string
  ): Promise<{ data: OrderReview | null; error: string | null }> => {
    if (!user) return { data: null, error: 'User not authenticated' };

    if (isMountedRef.current) {
      setLoading(true);
    }
    try {
      // RPC-only: use update_order_review function
      const { data, error } = await aisha.rpc("update_order_review", {
        p_comment: comment ?? undefined
,
        p_rating: rating,
        p_review_id: reviewId
    });

      if (error) throw new Error(error.message);

      // Validate with Zod
      const reviews = parseArrayResponseSafe(
        orderReviewArraySchema,
        data,
        "update_order_review"
      );
      return { data: reviews.length > 0 ? reviews[0] : null, error: null };
    } catch (error) {
      safeError('Error updating review', error);
      return { data: null, error: 'review_update_failed' };
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const canReviewOrder = (deliveredAt: string | null): boolean => {
    if (!deliveredAt) return false;
    const deliveryDate = new Date(deliveredAt);
    const now = new Date();
    const daysSinceDelivery = (now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceDelivery >= 30;
  };

  const daysUntilReviewable = (deliveredAt: string | null): number => {
    if (!deliveredAt) return 30;
    const deliveryDate = new Date(deliveredAt);
    const now = new Date();
    const daysSinceDelivery = (now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(30 - daysSinceDelivery));
  };

  return {
    loading,
    getReviewForOrder,
    createReview,
    updateReview,
    canReviewOrder,
    daysUntilReviewable,
  };
};

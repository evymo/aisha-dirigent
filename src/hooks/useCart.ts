import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import {
  cartItemArraySchema,
  parseArrayResponseSafe,
  type CartItemRpc,
} from "@/lib/schemas/hookSchemas";

/**
 * Represents an item in the shopping cart.
 */
export interface CartItem {
  /** Unique identifier for the cart item */
  id: string;
  /** ID of the product */
  product_id: string;
  /** Quantity of the product */
  quantity: number;
  /** Product details */
  product: {
    /** Unique identifier for the product */
    id: string;
    /** Name of the product */
    name: string;
    /** Price of the product */
    price: number;
    /** URL of the product image */
    image_url: string | null;
    /** Slug for the product URL */
    slug: string;
  };
}

/**
 * Query key for cart data - exported for external invalidation
 */
export const cartKeys = {
  all: ["cart"] as const,
  items: (userId: string | undefined) => [...cartKeys.all, "items", userId] as const,
};

/**
 * Hook to manage the shopping cart.
 * Uses React Query for automatic synchronization across components.
 * Provides methods to fetch, add, update, and remove items from the cart.
 *
 * @returns Object containing cart state and methods.
 */
export function useCart() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const isAuthenticated = !!user;
  const { t } = useTranslation();

  // Fetch cart items using React Query
  const {
    data: items = [],
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: cartKeys.items(user?.id),
    queryFn: async (): Promise<CartItem[]> => {
      if (!user) return [];

      const { data, error } = await aisha.rpc("get_my_cart");
      if (error) throw new Error(error.message);

      const validated = parseArrayResponseSafe(
        cartItemArraySchema,
        data,
        "get_my_cart"
      );

      return validated.map((item: CartItemRpc) => ({
        id: item.id,
        product_id: item.product_id,
        quantity: item.quantity,
        product: {
          id: item.product_id,
          name: item.product_name,
          price: item.product_price,
          image_url: item.product_image_url,
          slug: item.product_slug,
        },
      }));
    },
    enabled: !!user,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Invalidate cart queries helper
  const invalidateCart = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: cartKeys.all });
  }, [queryClient]);

  // Add to cart mutation
  const addMutation = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const { error } = await aisha.rpc("add_to_cart", {
        p_product_id: productId,
        p_quantity: quantity,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateCart();
      toast.success(t("cart.added"), { description: t("cart.addedDescription") });
    },
    onError: (error) => {
      safeError("Error adding to cart", error);
      toast.error(t("common.error"), { description: getUserFacingDataErrorMessage(error) });
    },
  });

  // Update quantity mutation
  const updateMutation = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      const { error } = await aisha.rpc("update_cart_quantity", {
        p_item_id: itemId,
        p_quantity: quantity,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateCart();
    },
    onError: (error) => {
      safeError("Error updating quantity", error);
      toast.error(t("common.error"), { description: getUserFacingDataErrorMessage(error) });
    },
  });

  // Remove from cart mutation
  const removeMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await aisha.rpc("remove_from_cart", {
        p_item_id: itemId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateCart();
      toast.success(t("cart.removed"), { description: t("cart.removedDescription") });
    },
    onError: (error) => {
      safeError("Error removing from cart", error);
      toast.error(t("common.error"), { description: getUserFacingDataErrorMessage(error) });
    },
  });

  // Clear cart mutation
  const clearMutation = useMutation({
    mutationFn: async () => {
      const { error } = await aisha.rpc("clear_my_cart");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateCart();
    },
    onError: (error) => {
      safeError("Error clearing cart", error);
    },
  });

  const total = items.reduce(
    (sum, item) => sum + (item.product?.price || 0) * item.quantity,
    0
  );

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  /**
   * Adds a product to the cart.
   *
   * @param productId - ID of the product to add.
   * @param quantity - Quantity to add (default: 1).
   * @returns Promise resolving to true if successful, false otherwise.
   */
  const addToCart = async (productId: string, quantity: number = 1): Promise<boolean> => {
    if (!isAuthenticated) {
      toast.error(t("common.signInRequired"), { description: t("common.signInToAddToCart") });
      return false;
    }

    try {
      await addMutation.mutateAsync({ productId, quantity });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Updates the quantity of a cart item.
   *
   * @param itemId - ID of the cart item.
   * @param quantity - New quantity.
   */
  const updateQuantity = async (itemId: string, quantity: number): Promise<void> => {
    await updateMutation.mutateAsync({ itemId, quantity });
  };

  /**
   * Removes an item from the cart.
   *
   * @param itemId - ID of the cart item to remove.
   */
  const removeFromCart = async (itemId: string): Promise<void> => {
    await removeMutation.mutateAsync(itemId);
  };

  /**
   * Clears all items from the cart.
   */
  const clearCart = async (): Promise<void> => {
    if (!user) return;
    await clearMutation.mutateAsync();
  };

  return {
    items,
    loading,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    total,
    itemCount,
    refetch,
    // Expose mutations for pending states
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
    isRemoving: removeMutation.isPending,
  };
}

import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { getUser as getKcUser } from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Defines the level of access a user has to a product.
 * - `view`: Can only view details, cannot purchase.
 * - `preorder`: Can pre-order the product.
 * - `order`: Can order the product normally.
 * - `auto_approve`: Can order and the order is automatically approved.
 */
export type ProductAccessType = "view" | "preorder" | "order" | "auto_approve";

/**
 * Configuration values for the system.
 */
interface SystemConfig {
  secure_session_timeout_minutes: number;
  session_timeout_minutes: number;
  min_certification_level_for_partner: number;
  qualification_test_pass_rate: number;
  partner_certification_pass_rate: number;
}

const DEFAULT_CONFIG: SystemConfig = {
  secure_session_timeout_minutes: 15,
  session_timeout_minutes: 30,
  min_certification_level_for_partner: 1,
  qualification_test_pass_rate: 0.75,
  partner_certification_pass_rate: 0.80,
};

/**
 * Hook to fetch system configuration values from database.
 * Falls back to sensible defaults if DB is unavailable.
 *
 * @returns Query result containing the system configuration.
 */
export function useSystemConfig() {
  return useQuery({
    queryKey: ["system-config"],
    queryFn: async (): Promise<SystemConfig> => {
      try {
        // RPC-only: use get_system_config function (if exists) or return defaults
        const { data, error } = await aisha.rpc("get_system_config", {
          p_key: undefined,
        });

        if (error) {
          // RPC might not exist yet - return defaults
          return DEFAULT_CONFIG;
        }

        const config = { ...DEFAULT_CONFIG };
        
        if (data && typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            if (key in config && typeof value === 'number') {
              (config as Record<string, unknown>)[key] = value;
            }
          }
        }

        return config;
      } catch (err) {
        safeError("useSystemConfig.fetch", err);
        return DEFAULT_CONFIG;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - config rarely changes
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Hook to check user's access level for a specific product.
 * Uses RPC function to evaluate all access rules server-side.
 *
 * @param productId - The ID of the product to check access for.
 * @returns Query result containing the access type (view, preorder, order, auto_approve).
 */
export function useProductAccess(productId: string | undefined) {
  const query = useQuery({
    queryKey: ["product-access", productId],
    queryFn: async (): Promise<ProductAccessType | null> => {
      if (!productId) return null;

      try {
        const user = await getKcUser();
        if (!user) return "view"; // Anonymous users can only view

        // Try the existing RPC first (get_product_access_type exists in DB)
        const { data, error } = await aisha.rpc("get_product_access_type", {
          p_product_id: productId,
        });

        if (error) {
          // RPC doesn't exist or other error - fallback to basic access
          safeError("useProductAccess.check", error);
          return "view";
        }

        // Map the result to our access type
        if (typeof data === "string") {
          const mapped = data.toLowerCase();
          if (mapped === "auto_approve" || mapped === "order" || mapped === "preorder" || mapped === "view") {
            return mapped as ProductAccessType;
          }
        }

        return "view";
      } catch (err) {
        safeError("useProductAccess.check", err);
        return "view";
      }
    },
    enabled: Boolean(productId),
    staleTime: 60 * 1000, // 1 minute
  });

  return {
    accessType: query.data ?? "view",
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Hook to check if an order should be auto-approved.
 *
 * @param orderValue - The total value of the order.
 * @returns Query result indicating if the order should be auto-approved.
 */
export function useShouldAutoApprove(orderValue: number) {
  const query = useQuery({
    queryKey: ["order-auto-approve", orderValue],
    queryFn: async (): Promise<boolean> => {
      try {
        const user = await getKcUser();
        if (!user) return false;

        // RPC-only: use get_my_membership function
        const { data: membershipData, error } = await aisha.rpc("get_my_membership");

        if (error) {
          safeError("useShouldAutoApprove.check", error);
          return false;
        }

        // RPC returns array, get first item
        const membership = Array.isArray(membershipData) ? membershipData[0] : membershipData;

        // VIP/premium members get auto-approve - check tier as string
        const tier = String(membership?.tier ?? "");
        if (tier === "premium" || tier === "vip" || tier === "upgraded") {
          return true;
        }

        return false;
      } catch (err) {
        safeError("useShouldAutoApprove.check", err);
        return false;
      }
    },
    enabled: orderValue > 0,
    staleTime: 60 * 1000,
  });

  return {
    shouldAutoApprove: query.data ?? false,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Get user-friendly label for product access type.
 *
 * @param accessType - The access type to get the label for.
 * @returns A human-readable label string.
 */
export function getAccessTypeLabel(accessType: ProductAccessType | null): string {
  switch (accessType) {
    case "auto_approve":
      return "Available";
    case "order":
      return "Order Now";
    case "preorder":
      return "Pre-order";
    case "view":
    default:
      return "View Only";
  }
}

/**
 * Check if access type allows adding to cart.
 *
 * @param accessType - The access type to check.
 * @returns True if the user can add the product to the cart.
 */
export function canAddToCart(accessType: ProductAccessType | null): boolean {
  return accessType === "order" || accessType === "auto_approve" || accessType === "preorder";
}

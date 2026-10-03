import { aisha } from "@/integrations/db/client";
import { getUser as getKcUser } from "@/integrations/auth/oidc-client";
import { safeError } from "@/lib/security/safeLogger";

export type TokenType = "governance" | "impact" | "data" | "aisha";

export interface UserWallet {
  user_id: string;
  aisha_tokens: number;
  governance_tokens: number;
  impact_tokens: number;
  data_tokens: number;
  updated_at: string;
}

export interface TokenTransaction {
  id: string;
  user_id: string;
  amount: number;
  token_type: string;
  transaction_type: string;
  description: string;
  reference_id: string | null;
  reference_type: string | null;
  balance_after: number | null;
  created_at: string;
}

export interface ProductVoucher {
  id: string;
  code: string;
  product_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  status: "active" | "used" | "expired";
  points_cost: number | null;
  metadata: unknown;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
}

/**
 * All wallet/voucher operations are RPC-only.
 * No direct `.from()` queries on financial tables.
 */
export const VoucherService = {
  /**
   * Get the current user's wallet balance via RPC.
   */
  async getWallet(): Promise<UserWallet | null> {
    const { data, error } = await aisha.rpc("get_my_wallet_balance");

    if (error) {
      safeError("VoucherService.getWallet", error);
      throw error;
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return null;

    return rows[0] as UserWallet;
  },

  /**
   * Get transaction history for the user via RPC.
   */
  async getTransactions(limit = 50): Promise<TokenTransaction[]> {
    const { data, error } = await aisha.rpc("get_my_token_transactions", {
      p_limit: limit,
    });

    if (error) {
      safeError("VoucherService.getTransactions", error);
      throw error;
    }

    return (data ?? []) as TokenTransaction[];
  },

  /**
   * Get user's vouchers via RPC.
   */
  async getMyVouchers(): Promise<ProductVoucher[]> {
    const { data, error } = await aisha.rpc("get_my_vouchers");

    if (error) {
      safeError("VoucherService.getMyVouchers", error);
      throw error;
    }

    return (data ?? []) as ProductVoucher[];
  },

  /**
   * Calculate max daily distribution for a product (High Distribution Rule).
   */
  async getMaxDailyDistribution(productId: string): Promise<number> {
    const user = await getKcUser();
    const userId = user?.id;
    if (!userId) return 0;

    const { data, error } = await aisha.rpc(
      "calculate_user_product_max_daily_distribution",
      {
        p_product_id: productId,
        p_user_id: userId,
      },
    );

    if (error) {
      safeError("VoucherService.getMaxDailyDistribution", error);
      return 0;
    }

    return (data as number) ?? 0;
  },

  /**
   * Purchase a voucher with points via RPC.
   */
  async purchaseVoucher(
    productId: string,
    cost: number,
    tokenType: TokenType,
  ): Promise<string> {
    const { data, error } = await aisha.rpc("purchase_product_voucher", {
      p_point_cost: cost,
      p_product_id: productId,
      p_token_type: tokenType,
    });

    if (error) {
      safeError("VoucherService.purchaseVoucher", error);
      throw error;
    }

    return data as string;
  },

  /**
   * Validate a voucher code via RPC without redeeming it.
   */
  async validateVoucher(code: string): Promise<ProductVoucher> {
    const { data, error } = await aisha.rpc("validate_voucher_code", {
      p_code: code,
    });

    if (error) {
      safeError("VoucherService.validateVoucher", error);
      throw new Error("Invalid or inactive voucher code");
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) {
      throw new Error("Invalid or inactive voucher code");
    }

    return rows[0] as ProductVoucher;
  },

  /**
   * Redeem a voucher for an order via RPC.
   */
  async redeemVoucher(code: string, orderId: string): Promise<boolean> {
    const { data, error } = await aisha.rpc("redeem_product_voucher", {
      p_code: code,
      p_order_id: orderId,
    });

    if (error) {
      safeError("VoucherService.redeemVoucher", error);
      throw error;
    }

    return data as boolean;
  },
};

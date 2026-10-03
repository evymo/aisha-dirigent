import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/hooks/useSession";
import {
  VoucherService,
  type TokenType,
  type UserWallet,
  type TokenTransaction,
  type ProductVoucher,
} from "@/services/voucherService";

// Re-export types for consumers
export type { TokenType, UserWallet, TokenTransaction, ProductVoucher };

/** Query key constants for cache invalidation. */
const WALLET_KEY = "user-wallet" as const;
const TRANSACTIONS_KEY = "token-transactions" as const;
const VOUCHERS_KEY = "my-vouchers" as const;

/**
 * Fetches the current user's token wallet balance.
 */
export function useUserWallet() {
  const { user } = useSession();

  return useQuery({
    queryKey: [WALLET_KEY, user?.id],
    queryFn: () => VoucherService.getWallet(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

/**
 * Fetches the current user's token transaction history.
 */
export function useTokenTransactions() {
  const { user } = useSession();

  return useQuery({
    queryKey: [TRANSACTIONS_KEY, user?.id],
    queryFn: () => VoucherService.getTransactions(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

/**
 * Fetches the current user's product vouchers.
 */
export function useMyVouchers() {
  const { user } = useSession();

  return useQuery({
    queryKey: [VOUCHERS_KEY, user?.id],
    queryFn: () => VoucherService.getMyVouchers(),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

/**
 * Mutation to purchase a product voucher with tokens.
 * Automatically invalidates wallet, transactions, and vouchers caches on success.
 */
export function usePurchaseVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      cost,
      tokenType,
    }: {
      productId: string;
      cost: number;
      tokenType: TokenType;
    }) => {
      return VoucherService.purchaseVoucher(productId, cost, tokenType);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WALLET_KEY] });
      queryClient.invalidateQueries({ queryKey: [TRANSACTIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: [VOUCHERS_KEY] });
    },
  });
}

/**
 * Mutation to validate a voucher code (without redeeming it).
 */
export function useValidateVoucher() {
  return useMutation({
    mutationFn: (code: string) => VoucherService.validateVoucher(code),
  });
}

/**
 * Mutation to redeem a voucher for a specific order.
 * Invalidates vouchers cache on success.
 */
export function useRedeemVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      code,
      orderId,
    }: {
      code: string;
      orderId: string;
    }) => {
      return VoucherService.redeemVoucher(code, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [VOUCHERS_KEY] });
    },
  });
}

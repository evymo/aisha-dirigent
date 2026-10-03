/**
 * Register Cosmos Address Hook — links CosmosWallet address to Supabase profile.
 * Combines local wallet state (useCosmosWallet) with backend registration
 * (update_my_cosmos_address RPC). Validates bech32 format client-side.
 * Calls: update_my_cosmos_address(p_cosmos_address)
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";

/** Zod schema for Cosmos address validation (cosmos bech32 format — the deployed
 *  stock-simapp node's prefix; see svc-blockchain config.cosmosAddressPrefix). */
const cosmosAddressSchema = z
  .string()
  .regex(/^cosmos1[a-z0-9]+$/, "Must start with cosmos1 followed by lowercase alphanumeric")
  .min(39)
  .max(59);

/** Parameters for registering a Cosmos address. Pass null to unlink. */
export interface RegisterCosmosAddressParams {
  /** Cosmos bech32 address (cosmos1...) or null to clear. */
  cosmosAddress: string | null;
}

/**
 * Mutation hook for registering or clearing a user's Cosmos wallet address
 * on the backend. Call with the address from useCosmosWallet().address.
 * Invalidates profile queries on success.
 */
export function useRegisterCosmosAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cosmosAddress }: RegisterCosmosAddressParams) => {
      if (cosmosAddress !== null) {
        cosmosAddressSchema.parse(cosmosAddress);
      }

      // p_cosmos_address is typed `string` (the SQL param has no DEFAULT, so
      // gen-types marks it required) but the RPC accepts NULL at runtime to
      // CLEAR a stored address — hence the cast over the null "clear" path.
      const { error } = await api.rpc("update_my_cosmos_address", {
        p_cosmos_address: cosmosAddress as string,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-completeness"] });
    },
    onError: (err) => {
      safeError("cosmos.address.register.failed", err);
    },
  });
}

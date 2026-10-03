/**
 * @module useRegisterCosmosAddress
 * @description Mutation hook for registering or updating a user's Cosmos wallet address.
 * Validates bech32 format (cosmos1...) before sending to RPC.
 * Calls: update_my_cosmos_address(p_cosmos_address)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

/** Zod schema for Cosmos address validation (cosmos bech32 format — the deployed
 *  stock-simapp node's prefix; see svc-blockchain config.cosmosAddressPrefix). */
const cosmosAddressSchema = z
  .string()
  .regex(/^cosmos1[a-z0-9]+$/, "Must start with cosmos1 followed by lowercase alphanumeric")
  .min(39)
  .max(59);

/** Parameters for registering a Cosmos address. Pass null to unset. */
export interface RegisterCosmosAddressParams {
  /** Cosmos bech32 address (cosmos1...) or null to clear. */
  cosmosAddress: string | null;
}

/**
 * Hook for registering or clearing a user's Cosmos wallet address.
 * Validates bech32 format client-side before RPC call.
 * Invalidates profile and wallet queries on success.
 */
export function useRegisterCosmosAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cosmosAddress }: RegisterCosmosAddressParams) => {
      if (cosmosAddress !== null) {
        cosmosAddressSchema.parse(cosmosAddress);
      }

      const { error } = await aisha.rpc("update_my_cosmos_address", {
        p_cosmos_address: cosmosAddress as string,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["cosmos-wallet"] });
    },
    onError: (err) => {
      safeError("cosmos.address.register.failed", err);
    },
  });
}

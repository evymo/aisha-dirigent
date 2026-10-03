/**
 * Ensure the local Cosmos wallet address is registered on the backend profile.
 *
 * `useCosmosWallet` only manages the address locally (BIP39 key in the device
 * keychain). The backend needs it — via `update_my_cosmos_address` — to deliver
 * on-chain rewards to the right address and to show the linked wallet. This
 * side-effect hook pushes the address to the backend once it exists.
 *
 * Idempotent: the RPC is an upsert, and a module-level guard skips re-pushing the
 * same address across screen re-mounts within a session. Pass the wallet state
 * (so it reuses the caller's `useCosmosWallet`, no extra keychain read) and call
 * it from any screen that holds the wallet — e.g. the Wallet tab.
 */
import { useEffect } from "react";
import { useRegisterCosmosAddress } from "./useRegisterCosmosAddress";

// Addresses already pushed this session — avoids redundant RPCs on re-mount.
const registeredThisSession = new Set<string>();

/** Test-only: reset the session guard so each test starts clean. */
export function __resetCosmosRegistrationGuard(): void {
  registeredThisSession.clear();
}

export function useEnsureCosmosAddressRegistered(
  address: string | null,
  isInitialized: boolean,
): void {
  // `mutate` is referentially stable across renders (react-query), so the effect
  // only re-runs when the address actually changes.
  const { mutate } = useRegisterCosmosAddress();

  useEffect(() => {
    if (!isInitialized || !address) return;
    if (registeredThisSession.has(address)) return;
    registeredThisSession.add(address);
    mutate({ cosmosAddress: address });
  }, [address, isInitialized, mutate]);
}

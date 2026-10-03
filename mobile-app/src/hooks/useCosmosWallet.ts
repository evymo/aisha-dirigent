/**
 * Cosmos Wallet Hook — BIP39 key management + transaction signing.
 *
 * Security model:
 * - Mnemonic stored in expo-secure-store (hardware-backed keychain)
 * - Every signing op requires biometric authentication
 * - Key NEVER leaves the device; only signed TxRaw bytes go out
 *
 * Uses CosmJS (stargate + proto-signing + crypto + amino).
 */
import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { authenticate } from "@/services/biometric";
import { BRAND_SHORT } from "@/config/brand";
import {
  Bip39,
  EnglishMnemonic,
  Random,
  Slip10,
  Slip10Curve,
  stringToPath,
} from "@cosmjs/crypto";
import {
  DirectSecp256k1Wallet,
} from "@cosmjs/proto-signing";
import {
  SigningStargateClient,
  GasPrice,
} from "@cosmjs/stargate";

// ── Constants ────────────────────────────────────────────────
const MNEMONIC_KEY = "aisha_cosmos_mnemonic";
const COSMOS_HD_PATH = "m/44'/118'/0'/0/0"; // Cosmos standard derivation
// Bech32 prefix of the deployed chain. The node is stock ghcr.io/cosmos/simapp
// (Dockerfile.cosmos), compiled with the default Cosmos SDK prefix 'cosmos', so a
// locally generated wallet MUST use 'cosmos' to produce an address that exists on
// that chain (an 'aisha1…' wallet can never be funded / receive a reward).
const BECH32_PREFIX = "cosmos"; // deployed stock-simapp chain address prefix
const DEFAULT_GAS_PRICE = "0.025uash"; // native denom

export interface CosmosWalletState {
  /** Bech32 address (cosmos1...) */
  address: string | null;
  /** Whether the wallet is initialized (mnemonic exists) */
  isInitialized: boolean;
  /** Loading state while checking/creating wallet */
  isLoading: boolean;
}

// ── Derivation helpers (pure, no side effects) ──────────────
async function mnemonicToKeypair(mnemonic: string) {
  const mnemonicChecked = new EnglishMnemonic(mnemonic);
  const seed = await Bip39.mnemonicToSeed(mnemonicChecked);
  const { privkey } = Slip10.derivePath(
    Slip10Curve.Secp256k1,
    seed,
    stringToPath(COSMOS_HD_PATH),
  );
  return privkey;
}

async function privkeyToAddress(privkey: Uint8Array): Promise<string> {
  const wallet = await DirectSecp256k1Wallet.fromKey(privkey, BECH32_PREFIX);
  const [account] = await wallet.getAccounts();
  return account.address;
}

// ── Hook ─────────────────────────────────────────────────────
export function useCosmosWallet() {
  const [state, setState] = useState<CosmosWalletState>({
    address: null,
    isInitialized: false,
    isLoading: true,
  });

  // Check if wallet already exists on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(MNEMONIC_KEY);
        if (stored) {
          const privkey = await mnemonicToKeypair(stored);
          const address = await privkeyToAddress(privkey);
          setState({ address, isInitialized: true, isLoading: false });
        } else {
          setState({ address: null, isInitialized: false, isLoading: false });
        }
      } catch {
        setState({ address: null, isInitialized: false, isLoading: false });
      }
    })();
  }, []);

  /**
   * Create a new wallet (generates BIP39 mnemonic, stores in SecureStore).
   * Returns the mnemonic for one-time backup display.
   */
  const createWallet = useCallback(async (): Promise<string> => {
    const entropy = await Random.getBytes(32); // 256-bit → 24-word mnemonic
    const mnemonic = Bip39.encode(entropy).toString();

    await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, {
      requireAuthentication: true,
      authenticationPrompt: `Authenticate to create your ${BRAND_SHORT} wallet`,
    });

    const privkey = await mnemonicToKeypair(mnemonic);
    const address = await privkeyToAddress(privkey);
    setState({ address, isInitialized: true, isLoading: false });

    return mnemonic;
  }, []);

  /**
   * Import an existing wallet from a BIP39 mnemonic.
   */
  const importWallet = useCallback(async (mnemonic: string): Promise<void> => {
    // Validate mnemonic format (throws on invalid)
    new EnglishMnemonic(mnemonic.trim());

    await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic.trim(), {
      requireAuthentication: true,
      authenticationPrompt: `Authenticate to import your ${BRAND_SHORT} wallet`,
    });

    const privkey = await mnemonicToKeypair(mnemonic.trim());
    const address = await privkeyToAddress(privkey);
    setState({ address, isInitialized: true, isLoading: false });
  }, []);

  /**
   * Sign and broadcast an arbitrary transaction.
   * Requires biometric authentication before accessing the key.
   */
  const signAndBroadcast = useCallback(
    async (
      rpcEndpoint: string,
      messages: readonly { typeUrl: string; value: unknown }[],
      memo?: string,
    ) => {
      // Step 1: biometric gate
      const bioResult = await authenticate(
        "Authenticate to sign transaction",
      );
      if (!bioResult) {
        throw new Error("Biometric authentication required to sign transactions");
      }

      // Step 2: retrieve mnemonic from SecureStore
      const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY);
      if (!mnemonic) throw new Error("Wallet not initialized");

      // Step 3: derive signing wallet
      const privkey = await mnemonicToKeypair(mnemonic);
      const wallet = await DirectSecp256k1Wallet.fromKey(privkey, BECH32_PREFIX);

      // Step 4: connect + sign + broadcast
      const client = await SigningStargateClient.connectWithSigner(
        rpcEndpoint,
        wallet,
        { gasPrice: GasPrice.fromString(DEFAULT_GAS_PRICE) },
      );

      const [account] = await wallet.getAccounts();
      const result = await client.signAndBroadcast(
        account.address,
        messages as readonly { typeUrl: string; value: Uint8Array }[],
        "auto",
        memo,
      );

      client.disconnect();
      return result;
    },
    [],
  );

  /**
   * Delete the wallet (irreversible — user must have backup).
   */
  const deleteWallet = useCallback(async (): Promise<void> => {
    const bioResult = await authenticate(
      "Authenticate to delete wallet",
    );
    if (!bioResult) {
      throw new Error("Biometric authentication required");
    }

    await SecureStore.deleteItemAsync(MNEMONIC_KEY);
    setState({ address: null, isInitialized: false, isLoading: false });
  }, []);

  return {
    ...state,
    createWallet,
    importWallet,
    signAndBroadcast,
    deleteWallet,
  };
}

export { BECH32_PREFIX, DEFAULT_GAS_PRICE, COSMOS_HD_PATH };

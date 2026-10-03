/**
 * App integrity hook — Play Integrity (Android) + App Attest (iOS).
 * Verifies app authenticity via verify-app-integrity edge function.
 */
import { useCallback, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/config/api";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

const IOS_KEY_STORAGE = "app_integrity_ios_key_id";
const TOKEN_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes

interface IntegrityResult {
  generatedAt: number;
  platform: "ios" | "android";
  token: string;
  tokenType: "app_attest" | "play_integrity";
}

interface IntegrityState {
  error: string | null;
  isVerified: boolean;
  isVerifying: boolean;
  lastVerifiedAt: number | null;
}

/**
 * Request an integrity token from the platform.
 * iOS: App Attest key generation + attestation.
 * Android: Play Integrity API standard request.
 */
async function requestPlatformToken(challenge: string): Promise<IntegrityResult> {
  if (Platform.OS === "ios") {
    return requestIosToken(challenge);
  }
  if (Platform.OS === "android") {
    return requestAndroidToken(challenge);
  }
  throw new Error(`Unsupported platform: ${Platform.OS}`);
}

async function requestIosToken(challenge: string): Promise<IntegrityResult> {
  // Dynamic import to avoid crash on Android
  const AppIntegrity = await import("@expo/app-integrity");

  let keyId = await AsyncStorage.getItem(IOS_KEY_STORAGE);

  if (!keyId) {
    keyId = await AppIntegrity.generateKeyAsync();
    await AsyncStorage.setItem(IOS_KEY_STORAGE, keyId);
    safeInfo("appIntegrity.ios.keyGenerated");
  }

  try {
    const attestation = await AppIntegrity.attestKeyAsync(keyId, challenge);
    return {
      generatedAt: Date.now(),
      platform: "ios",
      token: attestation,
      tokenType: "app_attest",
    };
  } catch (error) {
    // Reset key on attestation failure (key may be invalidated)
    await AsyncStorage.removeItem(IOS_KEY_STORAGE);
    safeError("appIntegrity.ios.attestFailed.resetKey", error);
    throw error;
  }
}

async function requestAndroidToken(challenge: string): Promise<IntegrityResult> {
  const AppIntegrity = await import("@expo/app-integrity");

  const token = await AppIntegrity.requestIntegrityCheckAsync(challenge);
  return {
    generatedAt: Date.now(),
    platform: "android",
    token,
    tokenType: "play_integrity",
  };
}

export function useAppIntegrity() {
  const [state, setState] = useState<IntegrityState>({
    error: null,
    isVerified: false,
    isVerifying: false,
    lastVerifiedAt: null,
  });

  const verify = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, error: null, isVerifying: true }));

    try {
      // Check token freshness
      if (
        state.lastVerifiedAt &&
        Date.now() - state.lastVerifiedAt < TOKEN_FRESHNESS_MS
      ) {
        setState((prev) => ({ ...prev, isVerifying: false }));
        return true;
      }

      // Get challenge from backend
      const { data: challengeData, error: challengeError } = await api.invoke<{ challenge: string }>(
        "verify-app-integrity",
        { method: "GET" }
      );

      if (challengeError || !challengeData?.challenge) {
        throw new Error("Failed to get integrity challenge");
      }

      // Request platform token
      const result = await requestPlatformToken(challengeData.challenge);

      // Verify token with backend
      const { data: verifyData, error: verifyError } = await api.invoke<{ verified: boolean; reason?: string }>(
        "verify-app-integrity",
        {
          body: {
            platform: result.platform,
            token: result.token,
            token_type: result.tokenType,
          },
          method: "POST",
        }
      );

      if (verifyError || !verifyData?.verified) {
        throw new Error(verifyData?.reason ?? "Integrity verification failed");
      }

      setState({
        error: null,
        isVerified: true,
        isVerifying: false,
        lastVerifiedAt: Date.now(),
      });

      safeInfo("appIntegrity.verified", { platform: result.platform });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setState({
        error: message,
        isVerified: false,
        isVerifying: false,
        lastVerifiedAt: null,
      });
      safeError("appIntegrity.verify.failed", error);
      return false;
    }
  }, [state.lastVerifiedAt]);

  const reset = useCallback(async () => {
    if (Platform.OS === "ios") {
      await AsyncStorage.removeItem(IOS_KEY_STORAGE);
    }
    setState({
      error: null,
      isVerified: false,
      isVerifying: false,
      lastVerifiedAt: null,
    });
    safeInfo("appIntegrity.reset");
  }, []);

  return {
    ...state,
    reset,
    verify,
  };
}

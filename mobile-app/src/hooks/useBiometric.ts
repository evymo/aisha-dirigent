/**
 * Biometric authentication hook.
 * Wraps BiometricService with React state management.
 * Registers audit journal RPC for biometric event logging.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  authenticate,
  clearAuthSecret,
  clearSession,
  disableBiometric,
  enableBiometric,
  getBiometricStatus,
  isSessionValid,
  registerAuditRpc,
  retrieveAuthSecret,
  storeAuthSecret,
  type BiometricStatus,
} from "@/services/biometric";
import { api } from "@/config/api";
import { useTranslation } from "./useTranslation";

const BIOMETRIC_NAMES: Record<BiometricStatus["biometricType"], Record<string, string>> = {
  face: { cs: "Face ID", en: "Face ID" },
  fingerprint: { cs: "Otisk prstu", en: "Fingerprint" },
  iris: { cs: "Iris", en: "Iris" },
  none: { cs: "Nedostupné", en: "Unavailable" },
};

export function useBiometric() {
  const { locale } = useTranslation();
  const [status, setStatus] = useState<BiometricStatus>({
    biometricType: "none",
    isAvailable: false,
    isEnabled: false,
    isEnrolled: false,
  });

  // Register audit RPC on mount (fire-once via service singleton pattern)
  useEffect(() => {
    registerAuditRpc(async (fn, params) => {
      // Dynamic audit dispatch: the fn name is resolved at runtime by the audit
      // service, so this one wrapper bypasses the literal-fn-name typing of the
      // shared rpc client. Every other call site stays fully typed.
      const rpcDynamic = api.rpc as (fn: string, params?: unknown) => Promise<{ error: unknown }>;
      const result = await rpcDynamic(fn, params);
      return { error: result.error };
    });
  }, []);

  const refresh = useCallback(async () => {
    const s = await getBiometricStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleEnable = useCallback(async (): Promise<boolean> => {
    const result = await enableBiometric();
    await refresh();
    return result;
  }, [refresh]);

  const handleDisable = useCallback(async () => {
    await disableBiometric();
    await refresh();
  }, [refresh]);

  const handleAuthenticate = useCallback(
    async (promptMessage?: string): Promise<boolean> => {
      return authenticate(promptMessage);
    },
    []
  );

  // Locale-keyed lookup over whatever languages the name map carries, with 'en'
  // as the terminal failover — not a cs/en binary that collapses other locales.
  const names = BIOMETRIC_NAMES[status.biometricType];
  const biometricName =
    names?.[locale] ??
    names?.en ??
    (Platform.OS === "ios" ? "Face ID" : "Fingerprint");

  return {
    ...status,
    authenticate: handleAuthenticate,
    biometricName,
    clearAuthSecret,
    clearSession,
    disable: handleDisable,
    enable: handleEnable,
    isSessionValid,
    refresh,
    retrieveAuthSecret,
    storeAuthSecret,
  };
}

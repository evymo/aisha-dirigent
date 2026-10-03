/**
 * Biometric authentication service.
 * Uses expo-local-authentication for Face ID / Touch ID / Fingerprint.
 * Session validity: 5 minutes (stored in SecureStore).
 *
 * Security:
 * - Auth session secret (PKCE refresh token) stored in SecureStore
 *   with biometric-gated access via requireAuthentication option.
 * - All biometric events logged to audit_journal via RPC.
 * - No PII in audit metadata — only user ID, action, biometric type.
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

const BIOMETRIC_ENABLED_KEY = "biometric_enabled";
const BIOMETRIC_SESSION_KEY = "biometric_session_ts";
const AUTH_SECRET_KEY = "biometric_auth_secret";
const SESSION_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Keychain options for the biometric-gated session secret.
 *
 * `requireAuthentication` is stronger than its name suggests: expo-secure-store
 * builds the access control with `.biometryCurrentSet`, which means (a) there is
 * NO passcode fallback — knowing the device PIN does not reveal the item — and
 * (b) enrolling a new face or finger DESTROYS it. A stolen phone therefore
 * cannot yield the token: the thief can add their own biometrics, but doing so
 * invalidates the very item they wanted.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` rather than `AFTER_FIRST_UNLOCK`: this secret
 * is an OFFLINE refresh token that outlives the SSO session, so it deserves the
 * narrowest window we can give it. Nothing here runs in the background, so
 * background readability buys us nothing, and `THIS_DEVICE_ONLY` keeps the item
 * out of backups — a restore onto another handset must not carry a live session
 * with it. Neither property is load-bearing on its own; both are cheap.
 */
const BIOMETRIC_SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: "Authenticate to access session",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface BiometricStatus {
  biometricType: "face" | "fingerprint" | "iris" | "none";
  isAvailable: boolean;
  isEnabled: boolean;
  isEnrolled: boolean;
}

/** RPC caller is registered lazily to avoid circular deps. */
let _auditRpc: ((fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>) | null = null;

/**
 * Register the gateway RPC caller. Called once from useBiometric hook init.
 * Avoids circular import between services/biometric and config/api.
 */
export function registerAuditRpc(
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>
): void {
  _auditRpc = rpc;
}

/**
 * Log biometric event to audit_journal via RPC.
 * Fire-and-forget — never blocks biometric flow on network.
 * No PII in metadata, only IDs and action context.
 */
async function logAuditEvent(
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!_auditRpc) return;
  try {
    await _auditRpc("insert_audit_journal_entry", {
      p_action: action,
      p_metadata: { ...metadata, area: "biometric", severity: "info" },
    });
  } catch (error) {
    // Audit logging failure must never break biometric flow
    safeError("biometric.audit.failed", error);
  }
}

async function getHardwareStatus(): Promise<{
  isAvailable: boolean;
  isEnrolled: boolean;
  biometricType: BiometricStatus["biometricType"];
}> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) {
      return { isAvailable: false, isEnrolled: false, biometricType: "none" };
    }

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    let biometricType: BiometricStatus["biometricType"] = "none";
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = "face";
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = "fingerprint";
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      biometricType = "iris";
    }

    return { isAvailable: true, isEnrolled: enrolled, biometricType };
  } catch (error) {
    safeError("biometric.getHardwareStatus", error);
    return { isAvailable: false, isEnrolled: false, biometricType: "none" };
  }
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  const hardware = await getHardwareStatus();
  const enabledStr = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  const isEnabled = enabledStr === "true";

  return { ...hardware, isEnabled };
}

export async function enableBiometric(): Promise<boolean> {
  const { isAvailable, isEnrolled, biometricType } = await getHardwareStatus();
  if (!isAvailable || !isEnrolled) return false;

  const result = await authenticate("Enable biometric authentication");
  if (result) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
    safeInfo("biometric.enabled");
    logAuditEvent("BIOMETRIC_ENABLED", { biometric_type: biometricType });
    return true;
  }
  return false;
}

export async function disableBiometric(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
  await SecureStore.deleteItemAsync(BIOMETRIC_SESSION_KEY);
  // Clear protected auth secret
  try {
    await SecureStore.deleteItemAsync(AUTH_SECRET_KEY);
  } catch {
    // may fail if never set — ignore
  }
  safeInfo("biometric.disabled");
  logAuditEvent("BIOMETRIC_DISABLED", {});
}

export async function authenticate(promptMessage?: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage ?? "Authenticate",
      fallbackLabel: "Use PIN",
      disableDeviceFallback: false,
    });

    if (result.success) {
      await SecureStore.setItemAsync(
        BIOMETRIC_SESSION_KEY,
        Date.now().toString()
      );
      safeInfo("biometric.authenticate.success");
      logAuditEvent("BIOMETRIC_AUTH_SUCCESS", {});
      return true;
    }

    safeInfo("biometric.authenticate.cancelled");
    logAuditEvent("BIOMETRIC_AUTH_CANCELLED", {});
    return false;
  } catch (error) {
    safeError("biometric.authenticate.failed", error);
    logAuditEvent("BIOMETRIC_AUTH_FAILED", { error_type: "exception" });
    return false;
  }
}

export async function isSessionValid(): Promise<boolean> {
  try {
    const tsStr = await SecureStore.getItemAsync(BIOMETRIC_SESSION_KEY);
    if (!tsStr) return false;

    const ts = parseInt(tsStr, 10);
    return Date.now() - ts < SESSION_VALIDITY_MS;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_SESSION_KEY);
}

// ── Auth secret management (biometric-gated) ──────────────────────────

/**
 * Store auth session secret (e.g. PKCE refresh token) in biometric-protected
 * SecureStore. The value is only retrievable after successful device owner
 * authentication (Face ID / Touch ID / device passcode).
 */
export async function storeAuthSecret(secret: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUTH_SECRET_KEY, secret, BIOMETRIC_SECURE_OPTIONS);
    safeInfo("biometric.authSecret.stored");
  } catch (error) {
    safeError("biometric.authSecret.store.failed", error);
    // Fallback: store without biometric protection (better than losing session)
    await SecureStore.setItemAsync(AUTH_SECRET_KEY, secret);
  }
}

/**
 * Retrieve auth session secret. Requires biometric authentication
 * if stored with requireAuthentication option.
 * Returns null if not found or authentication is cancelled.
 */
export async function retrieveAuthSecret(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AUTH_SECRET_KEY, BIOMETRIC_SECURE_OPTIONS);
  } catch (error) {
    safeError("biometric.authSecret.retrieve.failed", error);
    // Try without biometric options (legacy / fallback stored value)
    try {
      return await SecureStore.getItemAsync(AUTH_SECRET_KEY);
    } catch {
      return null;
    }
  }
}

/**
 * Clear stored auth secret.
 */
export async function clearAuthSecret(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_SECRET_KEY);
  } catch {
    // ignore
  }
}

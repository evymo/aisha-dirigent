/**
 * Gateway API client configuration for AISHA Dirigent Mobile.
 *
 * Uses the shared `@aisha/api-core` package, backed by the AISHA gateway,
 * PostgreSQL RPC endpoints, and Keycloak OIDC access tokens.
 *
 * Features:
 * - Runtime-switchable backend (Local Dev / Cloud / Custom)
 * - `api` / `realtime` singletons that respect the active environment
 * - Persisted environment choice via SecureStore
 * - Keycloak OIDC access token injected via `getAccessToken`
 *
 * @module
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import {
  createApiCore,
  createRealtimeClient,
  type ApiClient,
  type RealtimeClient,
} from "@aisha/api-core";

import { getAccessToken } from "@/config/oidc";
import { tokenZarizeni } from "@/lib/identitaZarizeni";
import { safeError, safeInfo, safeWarn } from "@/lib/security/safeLogger";
import type { Database } from "@/types/database";

/** RPC contract generated from the AISHA DB (one `db:types:gen` step, shared with web). */
type DbFunctions = Database["public"]["Functions"];

// ── Storage keys ─────────────────────────────────────────────────────────────

const BACKEND_URL_KEY = "aisha_dirigent_backend_url";
const BACKEND_ANON_KEY_KEY = "aisha_dirigent_anon_key";
const ACTIVE_ENV_KEY = "aisha_dirigent_active_env";

// ── Env resolution ───────────────────────────────────────────────────────────

function getExpoEnv(key: string): string | undefined {
  const extraValue = Constants.expoConfig?.extra?.[key];
  if (typeof extraValue === "string" && extraValue.length > 0) return extraValue;
  const envValue = process.env[key];
  if (typeof envValue === "string" && envValue.length > 0) return envValue;
  return undefined;
}

/**
 * Dedicated company build: the gateway baked at build time is fixed. The Settings
 * switcher is hidden and any stored override is ignored, so the app can only ever
 * talk to its own backend. Umbrella build (default) → false → user may switch.
 * Set via version.json `brand.gatewayPinned` → app.config `extra.AISHA_GATEWAY_PINNED`.
 */
export function isGatewayPinned(): boolean {
  return Constants.expoConfig?.extra?.AISHA_GATEWAY_PINNED === true;
}

/**
 * LiveKit media-server URL for consultation calls. Fail LOUD when unconfigured
 * — a call must never silently connect to a guessed/default server.
 */
export function getLivekitServerUrl(): string {
  const url = getExpoEnv("EXPO_PUBLIC_LIVEKIT_URL");
  if (!url) {
    throw new Error(
      "EXPO_PUBLIC_LIVEKIT_URL is not configured — cannot join the call room",
    );
  }
  return url;
}

const isDev = typeof __DEV__ !== "undefined" && __DEV__ === true;
const configurationIssues: string[] = [];
const UNSAFE_URL_CHARS = new Set(['"', "'", "<", ">", "`", "\\"]);

function hasUnsafeUrlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    if (charCode <= 0x1f || charCode === 0x7f || UNSAFE_URL_CHARS.has(value[i])) {
      return true;
    }
  }
  return false;
}

export function normalizeBackendUrl(input: string): string {
  const value = input.trim();
  if (!value || hasUnsafeUrlChars(value)) {
    throw new Error("Backend URL must be a valid http(s) URL");
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Backend URL must use http or https");
    }
    if (url.username || url.password) {
      throw new Error("Backend URL must not include credentials");
    }
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Backend URL")) {
      throw error;
    }
    throw new Error("Backend URL must be a valid http(s) URL");
  }
}

function tryNormalizeBackendUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    return normalizeBackendUrl(input);
  } catch (error) {
    configurationIssues.push("Invalid backend URL.");
    safeError("ApiConfig.invalid_backend_url", error);
    return undefined;
  }
}

/**
 * Standard local anon key (same across all local installations).
 * Public demo key — not a secret. The `role: anon` JWT is meant to be
 * shipped to client mobile apps; RLS enforces actual access control
 * server-side. See .well-known/app-config.json for the canonical
 * production version.
 */
const LOCAL_ANON_KEY =
  getExpoEnv("EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY") ??
  getExpoEnv("EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY") ??
  "";

/** Production anon key (public — same as .well-known/app-config.json). */
const CLOUD_ANON_KEY =
  getExpoEnv("EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY") ??
  getExpoEnv("EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY") ??
  "";

// ── Environment Presets ──────────────────────────────────────────────────────

export type EnvironmentId = "local" | "cloud" | "custom";

export interface EnvironmentPreset {
  id: EnvironmentId;
  label: string;
  url: string;
  anonKey: string;
}

export const ENV_PRESETS: Record<Exclude<EnvironmentId, "custom">, EnvironmentPreset> = {
  local: {
    id: "local",
    label: "Local Dev",
    url: "http://127.0.0.1:3001",
    anonKey: LOCAL_ANON_KEY,
  },
  cloud: {
    id: "cloud",
    label: "Cloud (Dirigent)",
    url: getExpoEnv("EXPO_PUBLIC_AISHA_GATEWAY_URL") ?? "",
    anonKey: CLOUD_ANON_KEY,
  },
};

const defaultUrl =
  getExpoEnv("EXPO_PUBLIC_AISHA_GATEWAY_URL") ??
  getExpoEnv("EXPO_PUBLIC_AISHA_POSTGREST_URL") ??
  (isDev ? "http://127.0.0.1:3001" : undefined);
const defaultAnonKey =
  getExpoEnv("EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY") ??
  getExpoEnv("EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY") ??
  (isDev ? LOCAL_ANON_KEY : undefined);

if (isDev) {
  safeInfo("ApiConfig.env_sources", {
    isDev,
    hasExtraUrl: !!(
      Constants.expoConfig?.extra?.EXPO_PUBLIC_AISHA_GATEWAY_URL ??
      Constants.expoConfig?.extra?.EXPO_PUBLIC_AISHA_POSTGREST_URL
    ),
    hasEnvUrl: !!(
      process.env.EXPO_PUBLIC_AISHA_GATEWAY_URL ??
      process.env.EXPO_PUBLIC_AISHA_POSTGREST_URL
    ),
  });
}

// ── URL / anon key persistence ───────────────────────────────────────────────

export async function getBackendUrl(): Promise<string> {
  // Pinned (dedicated build): never consult the stored override — the baked gateway wins.
  if (!isGatewayPinned()) {
    try {
      const stored = await SecureStore.getItemAsync(BACKEND_URL_KEY);
      if (stored && stored.length > 0) return normalizeBackendUrl(stored);
    } catch {
      // fall through
    }
  }
  if (!defaultUrl) {
    throw new Error(
      "Missing backend URL. Set EXPO_PUBLIC_AISHA_GATEWAY_URL or configure via Settings."
    );
  }
  return normalizeBackendUrl(defaultUrl);
}

export async function getAnonKey(): Promise<string> {
  if (!isGatewayPinned()) {
    try {
      const stored = await SecureStore.getItemAsync(BACKEND_ANON_KEY_KEY);
      if (stored && stored.length > 0) return stored;
    } catch {
      // fall through
    }
  }
  if (!defaultAnonKey) {
    throw new Error(
      "Missing gateway anon key. Set EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY or configure via Settings."
    );
  }
  return defaultAnonKey;
}

export async function setBackendUrl(url: string, anonKey: string): Promise<void> {
  const normalizedUrl = normalizeBackendUrl(url);
  await SecureStore.setItemAsync(BACKEND_URL_KEY, normalizedUrl);
  await SecureStore.setItemAsync(BACKEND_ANON_KEY_KEY, anonKey);
  safeInfo("ApiConfig.backend_url_updated");
}

export async function clearBackendUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(BACKEND_URL_KEY);
  await SecureStore.deleteItemAsync(BACKEND_ANON_KEY_KEY);
  safeInfo("ApiConfig.backend_url_cleared");
}

export async function checkBackendHealth(url: string): Promise<boolean> {
  try {
    const normalizedUrl = normalizeBackendUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${normalizedUrl}/rest/v1/`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 401; // 401 = auth required but server is alive
  } catch {
    return false;
  }
}

// ── Bootstrap fetch (anon-key discovery from public endpoint) ────────────────
//
// Resolved from build-time Expo extra config (EXPO_PUBLIC_BOOTSTRAP_URL) so the
// committed source has no deployment-specific URL. Operators set it in
// app.config.* via env (matches the topology resolver + render-app-config).
const BOOTSTRAP_URL =
  getExpoEnv("EXPO_PUBLIC_BOOTSTRAP_URL") ??
  (() => {
    const webOrigin = getExpoEnv("EXPO_PUBLIC_APP_URL") ?? getExpoEnv("EXPO_PUBLIC_WEB_URL");
    return webOrigin ? `${webOrigin.replace(/\/$/, "")}/.well-known/app-config.json` : "";
  })();

interface AppBootstrapConfig {
  aisha_url: string;
  anon_key: string;
  keycloak_url?: string;
  redirect_url?: string;
}

export async function fetchBootstrapConfig(): Promise<AppBootstrapConfig | null> {
  // Dedicated build: the gateway is fixed, so never fetch-and-persist a different one.
  if (isGatewayPinned()) return null;
  if (!BOOTSTRAP_URL) {
    safeWarn(
      "Bootstrap URL not configured (set EXPO_PUBLIC_BOOTSTRAP_URL or EXPO_PUBLIC_APP_URL in app.config)",
    );
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(BOOTSTRAP_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (
      data != null &&
      typeof data === "object" &&
      "aisha_url" in data &&
      "anon_key" in data &&
      typeof (data as AppBootstrapConfig).aisha_url === "string" &&
      typeof (data as AppBootstrapConfig).anon_key === "string"
    ) {
      const config = data as AppBootstrapConfig;
      const normalizedUrl = normalizeBackendUrl(config.aisha_url);
      await setBackendUrl(normalizedUrl, config.anon_key);
      safeInfo("ApiConfig.bootstrap_fetched", { url: normalizedUrl });
      return { ...config, aisha_url: normalizedUrl };
    }
    return null;
  } catch {
    safeWarn("ApiConfig.bootstrap_fetch_failed");
    return null;
  }
}

// ── Config validation (production) ───────────────────────────────────────────

if (defaultUrl && (defaultUrl.includes("127.0.0.1") || defaultUrl.includes("localhost"))) {
  if (!isDev) {
    configurationIssues.push("Backend URL points to localhost in production build.");
    safeError(
      "ApiConfig.invalid_localhost_production",
      new Error(
        "Backend URL is localhost in production build. Ensure EXPO_PUBLIC_AISHA_GATEWAY_URL is set before expo prebuild."
      )
    );
  }
  safeWarn("ApiConfig.localhost_fallback_in_dev");
}

if (!defaultUrl || !defaultAnonKey) {
  if (!isDev) {
    if (!defaultUrl) configurationIssues.push("Missing EXPO_PUBLIC_AISHA_GATEWAY_URL.");
    if (!defaultAnonKey) configurationIssues.push("Missing EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY.");
    safeError(
      "ApiConfig.missing_production_config",
      new Error(
        "Missing backend configuration. Set EXPO_PUBLIC_AISHA_GATEWAY_URL and EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY."
      )
    );
  }
}

const effectiveUrl = tryNormalizeBackendUrl(defaultUrl) ?? (isDev ? "http://127.0.0.1:3001" : undefined);
const effectiveAnonKey = defaultAnonKey ?? (isDev ? LOCAL_ANON_KEY : undefined);

export function getApiConfigurationIssue(): string | null {
  if (!effectiveUrl) {
    return "Missing EXPO_PUBLIC_AISHA_GATEWAY_URL. Open Settings to configure backend.";
  }
  return configurationIssues[0] ?? null;
}

export function isApiConfigured(): boolean {
  return !!effectiveUrl && !!effectiveAnonKey;
}

// ── Active clients (runtime-switchable) ──────────────────────────────────────

const PLACEHOLDER_URL = "https://not-configured.invalid";

type BuildResult = { api: ApiClient<DbFunctions>; realtime: RealtimeClient };

function wsUrlFor(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws") + "/realtime/v1";
}

function buildClients(url: string): BuildResult {
  return {
    api: createApiCore<DbFunctions>({
      gatewayUrl: url,
      // Přihlášený člověk má přednost (technik na tabletu); bez něj tablet v kiosku mluví
      // za sebe relací svého účtu (F2) — mimo kiosk je tokenZarizeni() vždy null.
      getToken: async () => (await getAccessToken()) ?? (await tokenZarizeni()),
      onWarn: (scope, err) => safeWarn(scope, err),
    }),
    realtime: createRealtimeClient({
      wsUrl: wsUrlFor(url),
      getToken: async () => (await getAccessToken()) ?? (await tokenZarizeni()),
      onError: (scope, err) => safeError(scope, err),
    }),
  };
}

let _clients: BuildResult = buildClients(effectiveUrl ?? PLACEHOLDER_URL);
let _activeEnvId: EnvironmentId = isDev ? "local" : "cloud";

// Proxies keep a stable reference so hooks captured `api` / `realtime` still
// point at the currently-active backend after an environment switch.
function proxyProperty<T extends object, K extends keyof T>(getTarget: () => T, prop: K) {
  return (...args: unknown[]) => {
    const target = getTarget();
    const fn = target[prop] as unknown as (...a: unknown[]) => unknown;
    return fn.apply(target, args);
  };
}

export const api: ApiClient<DbFunctions> = {
  rpc: proxyProperty(() => _clients.api, "rpc") as ApiClient<DbFunctions>["rpc"],
  invoke: proxyProperty(() => _clients.api, "invoke") as ApiClient<DbFunctions>["invoke"],
};

export const realtime: RealtimeClient = {
  channel: proxyProperty(() => _clients.realtime, "channel") as RealtimeClient["channel"],
  removeChannel: proxyProperty(
    () => _clients.realtime,
    "removeChannel",
  ) as RealtimeClient["removeChannel"],
};

export function getActiveEnvironmentId(): EnvironmentId {
  return _activeEnvId;
}

export async function switchEnvironment(
  envId: EnvironmentId,
  customUrl?: string,
  customAnonKey?: string,
): Promise<void> {
  let url: string;
  let anonKey: string;

  if (envId === "custom") {
    if (!customUrl || !customAnonKey) {
      throw new Error("Custom environment requires url and anonKey");
    }
    url = normalizeBackendUrl(customUrl);
    anonKey = customAnonKey;
  } else {
    const preset = ENV_PRESETS[envId];
    url = normalizeBackendUrl(preset.url);
    anonKey = preset.anonKey;
  }

  await SecureStore.setItemAsync(BACKEND_URL_KEY, url);
  await SecureStore.setItemAsync(BACKEND_ANON_KEY_KEY, anonKey);
  await SecureStore.setItemAsync(ACTIVE_ENV_KEY, envId);

  _clients = buildClients(url);
  _activeEnvId = envId;

  safeInfo("ApiConfig.environment_switched", { envId, url });
}

export async function restoreEnvironment(): Promise<void> {
  try {
    const storedEnvId = await SecureStore.getItemAsync(ACTIVE_ENV_KEY);
    const storedUrl = await SecureStore.getItemAsync(BACKEND_URL_KEY);
    const storedAnonKey = await SecureStore.getItemAsync(BACKEND_ANON_KEY_KEY);

    if (storedEnvId && storedUrl && storedAnonKey) {
      const normalizedUrl = normalizeBackendUrl(storedUrl);
      _clients = buildClients(normalizedUrl);
      _activeEnvId = storedEnvId as EnvironmentId;
      safeInfo("ApiConfig.environment_restored", { envId: storedEnvId, url: normalizedUrl });
    }
  } catch {
    safeWarn("ApiConfig.environment_restore_failed");
  }
}

// ── AsyncStorage is retained for future session-cache needs ──────────────────
 
const _keepAsyncStorageReferenceForFutureUse = AsyncStorage;

/**
 * Bootstrap Config — Auto-fetch public app configuration from .well-known endpoint.
 *
 * Solves the chicken-and-egg problem for new projects: before the user can
 * authenticate, the extension needs the `anonKey` (AISHA public API key).
 * This module fetches it from the same `.well-known/app-config.json` endpoint
 * used by the mobile app.
 *
 * Flow:
 * 1. Check if anonKey already exists in config → done (cache hit)
 * 2. Fetch from `BOOTSTRAP_URL` (public, no auth needed)
 * 3. Persist into `.aisha/dirigent.local.json` (git-ignored)
 * 4. Next activation → cache hit, no fetch needed
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { safeError, safeInfo } from "./safe-logger";

/**
 * Well-known bootstrap URL served by the public API facade.
 * No authentication required — anon key is public.
 */
const BOOTSTRAP_URL = "";

/** Timeout for the bootstrap fetch (ms). */
const BOOTSTRAP_TIMEOUT_MS = 8_000;

/** Bootstrap config returned from the well-known endpoint. */
export interface AppBootstrapConfig {
  aisha_url: string;
  anon_key: string;
  keycloak_url?: string;
  redirect_url?: string;
  mcp_url?: string;
  orchestration_url?: string;
  n8n_trigger_url?: string;
  dashboard_url?: string;
  web_url?: string;
  /** Matrix homeserver URL (e.g. https://matrix.${MATRIX_DOMAIN}) */
  matrix_homeserver_url?: string;
  /** svc-matrix token exchange URL (e.g. https://matrix-svc.${PUBLIC_TLD}) */
  matrix_service_url?: string;
}

export interface BootstrapOptions {
  force?: boolean;
  overwriteExisting?: boolean;
}

export function deriveBootstrapUrl(instanceUrl: string): string {
  try {
    const url = new URL(instanceUrl);
    return `${url.origin}/.well-known/app-config.json`;
  } catch {
    return BOOTSTRAP_URL;
  }
}

/**
 * Fetch app configuration from the public bootstrap endpoint.
 *
 * Solves the chicken-and-egg problem — no AISHA client needed.
 * Returns null on any error (timeout, network, invalid JSON).
 */
export async function fetchBootstrapConfig(
  bootstrapUrl?: string,
): Promise<AppBootstrapConfig | null> {
  const url = bootstrapUrl || BOOTSTRAP_URL;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
    });

    if (!response.ok) {
      safeError("Bootstrap", `HTTP ${response.status} from ${url}`);
      return null;
    }

    const data: unknown = await response.json();

    if (!isValidBootstrapConfig(data)) {
      safeError("Bootstrap", "Invalid response shape");
      return null;
    }

    return data;
  } catch (err) {
    safeError("Bootstrap", "Fetch failed", err);
    return null;
  }
}

/**
 * Type guard for AppBootstrapConfig.
 */
function isValidBootstrapConfig(data: unknown): data is AppBootstrapConfig {
  return (
    data != null &&
    typeof data === "object" &&
    "aisha_url" in data &&
    "anon_key" in data &&
    typeof (data as AppBootstrapConfig).aisha_url === "string" &&
    typeof (data as AppBootstrapConfig).anon_key === "string" &&
    (data as AppBootstrapConfig).aisha_url.length > 0 &&
    (data as AppBootstrapConfig).anon_key.length > 0
  );
}

/**
 * Ensure the active profile has an anonKey.
 *
 * If `anonKey` is missing from the current config, fetches it from the
 * bootstrap endpoint and persists it into `.aisha/dirigent.local.json`.
 *
 * Safe to call multiple times — no-ops when anonKey already exists.
 *
 * @param currentAnonKey - The anonKey from the current resolved config (may be empty)
 * @param activeProfile - The active profile name (e.g. "cloud", "local")
 * @param bootstrapUrl - Optional override for the bootstrap URL
 * @returns The anonKey (existing or freshly fetched), or empty string on failure
 */
export async function ensureBootstrapConfig(
  activeProfile: string,
  bootstrapUrl?: string,
  currentAnonKey?: string,
  options: BootstrapOptions = {},
): Promise<{ anonKey: string; aishaUrl: string; bootstrapped: boolean }> {
  // Already have anonKey → nothing to do
  if (!options.force && currentAnonKey && currentAnonKey.length > 0) {
    return { anonKey: currentAnonKey, aishaUrl: "", bootstrapped: false };
  }

  const config = await fetchBootstrapConfig(bootstrapUrl);
  if (!config) {
    return { anonKey: "", aishaUrl: "", bootstrapped: false };
  }

  // Persist to .aisha/dirigent.local.json
  const persisted = persistBootstrapToLocal(activeProfile, config, options.overwriteExisting ?? false);
  if (persisted) {
    void vscode.window.showInformationMessage(
      `AISHA Dirigent: ${vscode.l10n.t("Configuration auto-fetched from cloud.")}`,
    );
  }

  return {
    anonKey: config.anon_key,
    aishaUrl: config.aisha_url,
    bootstrapped: true,
  };
}

/**
 * Write bootstrap config into `.aisha/dirigent.local.json`.
 *
 * Merges with existing content — only fills in missing fields (anonKey, aishaUrl).
 * Does NOT overwrite values that already exist.
 */
function persistBootstrapToLocal(
  activeProfile: string,
  config: AppBootstrapConfig,
  overwriteExisting: boolean,
): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;

  const dirPath = path.join(root, ".aisha");
  const localPath = path.join(dirPath, "dirigent.local.json");

  try {
    // Ensure .aisha/ directory exists
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    // Read existing local config (or empty object)
    let existing: Record<string, unknown> = {};
    if (existsSync(localPath)) {
      try {
        existing = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }

    // Ensure profiles section exists
    const profiles = (existing.profiles ?? {}) as Record<string, Record<string, unknown>>;
    const profileName = activeProfile || "cloud";

    if (!profiles[profileName]) {
      profiles[profileName] = {};
    }

    const shouldWrite = (key: string): boolean => overwriteExisting || !profiles[profileName][key];

    if (shouldWrite("anonKey")) {
      profiles[profileName].anonKey = config.anon_key;
    }
    if (shouldWrite("aishaUrl")) {
      profiles[profileName].aishaUrl = config.aisha_url;
    }
    if (shouldWrite("keycloakUrl") && config.keycloak_url) {
      profiles[profileName].keycloakUrl = config.keycloak_url;
    }
    if (shouldWrite("mcpUrl") && config.mcp_url) {
      profiles[profileName].mcpUrl = config.mcp_url;
    }
    if (shouldWrite("n8nTriggerUrl") && config.n8n_trigger_url) {
      profiles[profileName].n8nTriggerUrl = config.n8n_trigger_url;
    }
    if (shouldWrite("orchestrationUrl") && config.orchestration_url) {
      profiles[profileName].orchestrationUrl = config.orchestration_url;
    }
    if (shouldWrite("dashboardUrl") && config.dashboard_url) {
      profiles[profileName].dashboardUrl = config.dashboard_url;
    }
    if (shouldWrite("webUrl") && config.web_url) {
      profiles[profileName].webUrl = config.web_url;
    }
    if (shouldWrite("matrixUrl") && config.matrix_homeserver_url) {
      profiles[profileName].matrixUrl = config.matrix_homeserver_url;
    }
    if (shouldWrite("matrixServiceUrl") && config.matrix_service_url) {
      profiles[profileName].matrixServiceUrl = config.matrix_service_url;
    }

    existing.profiles = profiles;

    // Set activeProfile if not already set
    if (!existing.activeProfile) {
      existing.activeProfile = profileName;
    }

    writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    return true;
  } catch (err) {
    safeError("Bootstrap", "Failed to persist config", err);
    return false;
  }
}

// ──────────────────────────────────────────
// Post-auth workspace config
// ──────────────────────────────────────────

/** Workspace config returned by the backend after authentication. */
export interface WorkspaceConfig {
  dashboard_url: string;
  org_name?: string;
  features?: string[];
}

/** Timeout for the workspace config fetch (ms). */
const WORKSPACE_CONFIG_TIMEOUT_MS = 10_000;

/**
 * Fetch workspace configuration from the backend after authentication.
 *
 * Tries the RPC endpoint first (`rpc/get_workspace_config`).
 * Falls back to deriving dashboard URL from the AISHA URL pattern.
 *
 * @param aishaUrl - The active backend's AISHA URL
 * @param accessToken - The authenticated user's JWT
 * @param anonKey - The AISHA public API key
 * @returns WorkspaceConfig or null on failure
 */
export async function fetchWorkspaceConfig(
  aishaUrl: string,
  accessToken: string,
  anonKey: string,
): Promise<WorkspaceConfig | null> {
  if (!aishaUrl || !accessToken) return null;

  const url = `${aishaUrl.replace(/\/+$/, "")}/rest/v1/rpc/get_workspace_config`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: "{}",
      signal: AbortSignal.timeout(WORKSPACE_CONFIG_TIMEOUT_MS),
    });

    if (response.ok) {
      const data: unknown = await response.json();

      if (isValidWorkspaceConfig(data)) {
        return data;
      }
    }

    // RPC doesn't exist yet or returned non-200 — fallback to derived URL
    safeInfo("Bootstrap", "get_workspace_config not available, using derived dashboard URL");
  } catch {
    // Network error or timeout — fallback
    safeInfo("Bootstrap", "Workspace config fetch failed, using derived URL");
  }

  // Derive dashboard URL from AISHA URL pattern
  const derived = deriveDashboardUrl(aishaUrl);
  if (derived) {
    return { dashboard_url: derived };
  }

  return null;
}

/**
 * Type guard for WorkspaceConfig.
 */
function isValidWorkspaceConfig(data: unknown): data is WorkspaceConfig {
  return (
    data != null &&
    typeof data === "object" &&
    "dashboard_url" in data &&
    typeof (data as WorkspaceConfig).dashboard_url === "string" &&
    (data as WorkspaceConfig).dashboard_url.length > 0
  );
}

/**
 * Derive a dashboard URL from the AISHA URL pattern.
 *
 * Cloud: api.{server}.{internalTLD} → appsmith.{server}.{internalTLD}
 * Local: localhost:54321 → localhost:8090
 */
function deriveDashboardUrl(aishaUrl: string): string | null {
  try {
    const url = new URL(aishaUrl);

    // Local dev — Appsmith on :8090
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "http://localhost:8090";
    }

    const domainParts = url.hostname.split(".");
    if (domainParts.length >= 2) {
      domainParts[0] = "appsmith";
      return `${url.protocol}//${domainParts.join(".")}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Persist workspace config into the active profile in `.aisha/dirigent.local.json`.
 */
export function persistWorkspaceConfig(
  activeProfile: string,
  config: WorkspaceConfig,
): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;

  const dirPath = path.join(root, ".aisha");
  const localPath = path.join(dirPath, "dirigent.local.json");

  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (existsSync(localPath)) {
      try {
        existing = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }

    const profiles = (existing.profiles ?? {}) as Record<string, Record<string, unknown>>;
    const profileName = activeProfile || "cloud";

    if (!profiles[profileName]) {
      profiles[profileName] = {};
    }

    profiles[profileName].dashboardUrl = config.dashboard_url;
    if (config.org_name) {
      profiles[profileName].orgName = config.org_name;
    }
    if (config.features) {
      profiles[profileName].features = config.features;
    }

    existing.profiles = profiles;
    writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    return true;
  } catch (err) {
    safeError("Bootstrap", "Failed to persist workspace config", err);
    return false;
  }
}

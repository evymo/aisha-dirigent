/**
 * Shared Dirigent configuration loader for the AISHA Dirigent VS Code extension.
 *
 * Resolution order:
 * 1. VS Code settings (`aisha.dirigent.*`) as legacy fallback
 * 2. Workspace `.aisha/dirigent.json` (with optional profiles)
 * 3. Workspace `.aisha/dirigent.local.json`
 * 4. Process environment (`AISHA_*`)
 * 5. Bootstrap endpoint (`.well-known/app-config.json`) — async, on-demand
 *
 * Connection Profiles:
 * Config supports an optional `profiles` section in dirigent.json for
 * switching between backends (local dev, AISHA Cloud, custom).
 * `activeProfile` in .aisha/dirigent.local.json selects which profile to use.
 *
 * @module
 */

import { existsSync, readFileSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** Connection profile — per-backend configuration. */
export interface ConnectionProfile {
  aishaUrl?: string;
  anonKey?: string;
  mcpUrl?: string;
  n8nTriggerUrl?: string;
  /** Dashboard URL for this backend (Appsmith embed). Fetched post-auth. */
  dashboardUrl?: string;
  /** Human-facing orchestration endpoint (n8n/MCP OAuth facade). */
  orchestrationUrl?: string;
  /** Well-known endpoint used to self-describe this instance. */
  bootstrapUrl?: string;
  /** Web frontend URL for this backend. */
  webUrl?: string;
  /** Organization name returned by backend after auth. */
  orgName?: string;
  /** Feature flags returned by backend after auth. */
  features?: string[];
  /** Keycloak realm URL for AISHA ID (OIDC device code flow). */
  keycloakUrl?: string;
  /** Matrix homeserver URL (e.g. https://matrix.${MATRIX_DOMAIN}). */
  matrixUrl?: string;
  /** svc-matrix token exchange service URL (e.g. https://matrix-svc.${PUBLIC_TLD}). */
  matrixServiceUrl?: string;
}

/** LLM provider preset for local/remote model routing. */
export interface LlmProviderPreset {
  provider: "docker-desktop" | "ollama" | "vllm" | "openai" | "anthropic" | "google" | "custom";
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

/** LLM configuration section. */
export interface LlmConfig {
  activePreset: string;
  presets: Record<string, LlmProviderPreset>;
  preferLocalForEval: boolean;
}

/** Default LLM presets (hardcoded, overridable via config). */
const DEFAULT_LLM_PRESETS: Record<string, LlmProviderPreset> = {
  "docker-desktop": { provider: "docker-desktop", baseUrl: "http://localhost:12434/v1", enabled: true },
  "ollama": { provider: "ollama", baseUrl: "http://localhost:11434/v1", enabled: true },
  "vllm": { provider: "vllm", baseUrl: "http://localhost:8100/v1", enabled: true },
};

export interface DirigentConfig {
  mcpUrl: string;
  n8nTriggerUrl: string;
  aishaUrl: string;
  anonKey: string;
  storyId: string;
  expertiseLevel: string;
  /** Explicit label override for the connection (shown in status bar). */
  instanceLabel: string;
  /** Active profile name (from profiles section). */
  activeProfile: string;
  /** Available connection profiles. */
  profiles: Record<string, ConnectionProfile>;
  /** Dashboard embed URL (Appsmith StoryLoop). */
  dashboardUrl: string;
  /** Human-facing orchestration endpoint (n8n/MCP OAuth facade). */
  orchestrationUrl: string;
  /** Well-known endpoint used to self-describe this instance. */
  bootstrapUrl: string;
  /** Web frontend URL for this backend. */
  webUrl: string;
  /** Keycloak realm URL for AISHA ID (OIDC device code flow). */
  keycloakUrl: string;
  /** Matrix homeserver URL (e.g. https://matrix.${MATRIX_DOMAIN}). */
  matrixUrl: string;
  /** svc-matrix token exchange service URL (e.g. https://matrix-svc.${PUBLIC_TLD}). */
  matrixServiceUrl: string;
  /** LLM provider configuration (local/remote model routing). */
  llm: LlmConfig;
}

/** Config change event emitter — modules can react to profile switches. */
const configChangeEmitter = new vscode.EventEmitter<DirigentConfig>();
export const onConfigChanged = configChangeEmitter.event;

/**
 * Backend used when nothing is configured (no settings, profile, env or MCP
 * URL): the gateway of the local stack started by `scripts/local-warmup.sh`.
 * Anyone who clones the repo connects to THEIR OWN AISHA — a deployed instance
 * is configured via settings, `.aisha/dirigent.local.json` or AISHA_* env.
 * No hosted instance is ever assumed.
 */
export const DEFAULT_LOCAL_AISHA_URL = "http://localhost:3001";

/**
 * Keycloak of the local stack (`scripts/local-warmup.sh` publishes it on 8180).
 */
const LOCAL_KEYCLOAK_ORIGIN = "http://localhost:8180";

/** True when `hostname` is `tld` itself or any subdomain of it. */
function hostnameUnder(hostname: string, tld: string): boolean {
  const h = hostname.toLowerCase();
  const t = tld.toLowerCase();
  return h === t || h.endsWith(`.${t}`);
}

/**
 * Resolve a human-friendly label for the current backend connection.
 * Used in the status bar to show where AISHA is connected.
 */
export function resolveConnectionLabel(aishaUrl: string, instanceLabel?: string): string {
  if (instanceLabel) return instanceLabel;
  if (!aishaUrl) return "Not Connected";
  try {
    const url = new URL(aishaUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "Local Dev";
    // A deployment is labelled "AISHA Cloud" only by the operator's own TLD
    // pair (aisha.dirigent.cloudTLD / internalTLD) — never by a built-in domain.
    const { cloudTLD, internalTLD } = getTLDs();
    if (
      (cloudTLD && hostnameUnder(url.hostname, cloudTLD)) ||
      (internalTLD && hostnameUnder(url.hostname, internalTLD))
    ) {
      return "AISHA Cloud";
    }
    return url.hostname;
  } catch {
    return "Unknown";
  }
}

/**
 * Get the appropriate status bar icon for the connection type.
 */
export function getConnectionIcon(label: string): string {
  if (label === "Local Dev") return "$(server)";
  if (label === "AISHA Cloud") return "$(cloud)";
  if (label === "Not Connected") return "$(debug-disconnect)";
  return "$(globe)";
}

/**
 * Get connection label for the current config.
 */
export function getConnectionLabel(): string {
  const config = getDirigentConfig();
  return resolveConnectionLabel(config.aishaUrl, config.instanceLabel);
}

function readJsonIfExists(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readDotEnvIfExists(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const entries: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }

    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    entries[key] = stripWrappingQuotes(rawValue.trim());
  }

  return entries;
}

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function settingsFallback(): DirigentConfig {
  const settings = vscode.workspace.getConfiguration("aisha.dirigent");
  return {
    mcpUrl: settings.get<string>("mcpUrl") ?? "",
    n8nTriggerUrl: settings.get<string>("n8nTriggerUrl") ?? "",
    // `supabaseUrl` is the declared (legacy-named) setting in package.json;
    // `aishaUrl` the current key. Either one configures the backend.
    aishaUrl: settings.get<string>("aishaUrl") || settings.get<string>("supabaseUrl") || "",
    anonKey: settings.get<string>("anonKey") ?? "",
    storyId: settings.get<string>("storyId") ?? "",
    expertiseLevel: settings.get<string>("expertiseLevel") ?? "intermediate",
    instanceLabel: "",
    activeProfile: "",
    profiles: {},
    dashboardUrl: settings.get<string>("dashboardUrl") ?? "http://localhost:8090",
    orchestrationUrl: settings.get<string>("orchestrationUrl") ?? "",
    bootstrapUrl: settings.get<string>("bootstrapUrl") ?? "",
    webUrl: settings.get<string>("webUrl") ?? "",
    keycloakUrl: settings.get<string>("keycloakUrl") ?? "",
    matrixUrl: "",
    matrixServiceUrl: "",
    llm: {
      activePreset: "",
      presets: { ...DEFAULT_LLM_PRESETS },
      preferLocalForEval: true,
    },
  };
}

function pickEnvValue(source: Record<string, string | undefined>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function normalizeLegacyAishaUrl(value: string): string {
  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function envOverride() {
  const root = workspaceRoot();
  const dotEnv = root ? readDotEnvIfExists(path.join(root, ".env")) : {};
  const envSource: Record<string, string | undefined> = {
    ...dotEnv,
    ...process.env,
  };

  const raw = {
    mcpUrl: pickEnvValue(envSource, "AISHA_MCP_URL"),
    n8nTriggerUrl: pickEnvValue(envSource, "AISHA_N8N_TRIGGER_URL"),
    aishaUrl: normalizeLegacyAishaUrl(
      pickEnvValue(envSource, "AISHA_POSTGREST_URL", "AISHA_POSTGREST_URL", "VITE_AISHA_POSTGREST_URL", "API_DOMAIN"),
    ),
    anonKey: pickEnvValue(
      envSource,
      "AISHA_POSTGREST_ANON_KEY",
      "VITE_AISHA_POSTGREST_ANON_KEY",
      "VITE_AISHA_POSTGREST_PUBLISHABLE_KEY",
    ),
    storyId: pickEnvValue(envSource, "AISHA_STORY_ID"),
    expertiseLevel: pickEnvValue(envSource, "AISHA_EXPERTISE_LEVEL"),
    keycloakUrl: pickEnvValue(envSource, "AISHA_KEYCLOAK_URL"),
    bootstrapUrl: pickEnvValue(envSource, "AISHA_BOOTSTRAP_URL"),
    webUrl: pickEnvValue(envSource, "AISHA_WEB_URL"),
    orchestrationUrl: pickEnvValue(envSource, "AISHA_ORCHESTRATION_URL"),
  };

  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );
}

/**
 * Restricted env override — only reads AISHA_*-prefixed env vars.
 * Used when an explicit profile is active so generic AISHA_POSTGREST_URL etc.
 * (shared with the React/Vite app) don't clobber the profile connection.
 */
function aishaEnvOverrideOnly() {
  const root = workspaceRoot();
  const dotEnv = root ? readDotEnvIfExists(path.join(root, ".env")) : {};
  const envSource: Record<string, string | undefined> = {
    ...dotEnv,
    ...process.env,
  };

  const raw = {
    mcpUrl: pickEnvValue(envSource, "AISHA_MCP_URL"),
    n8nTriggerUrl: pickEnvValue(envSource, "AISHA_N8N_TRIGGER_URL"),
    aishaUrl: normalizeLegacyAishaUrl(
      pickEnvValue(envSource, "AISHA_POSTGREST_URL"),
    ),
    anonKey: pickEnvValue(envSource, "AISHA_POSTGREST_ANON_KEY"),
    storyId: pickEnvValue(envSource, "AISHA_STORY_ID"),
    expertiseLevel: pickEnvValue(envSource, "AISHA_EXPERTISE_LEVEL"),
    keycloakUrl: pickEnvValue(envSource, "AISHA_KEYCLOAK_URL"),
    bootstrapUrl: pickEnvValue(envSource, "AISHA_BOOTSTRAP_URL"),
    webUrl: pickEnvValue(envSource, "AISHA_WEB_URL"),
    orchestrationUrl: pickEnvValue(envSource, "AISHA_ORCHESTRATION_URL"),
  };

  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );
}

function normalizeAishaUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveAishaUrlFromMcp(mcpUrl: string): string {
  const normalized = mcpUrl
    .replace(/\/functions\/v1\/mcp-knowledge-server\/?$/i, "")
    .replace(/\/+$/, "");

  return normalized;
}

function deriveMcpUrlFromLegacyBackend(aishaUrl: string): string {
  return `${aishaUrl}/functions/v1/mcp-knowledge-server`;
}

function deriveN8nTriggerUrlFromLegacyBackend(aishaUrl: string): string {
  return `${aishaUrl}/admin/n8n-trigger`;
}

function normalizeN8nTriggerUrl(value: string): string {
  return value.replace(/\/functions\/v1\/n8n-trigger\/?$/i, "/admin/n8n-trigger");
}

function deriveBootstrapUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    return `${url.origin}/.well-known/app-config.json`;
  } catch {
    return "";
  }
}

function getTLDs(): { cloudTLD: string; internalTLD: string } {
  const s = vscode.workspace.getConfiguration("aisha.dirigent");
  return {
    cloudTLD: s.get<string>("cloudTLD") ?? "",
    internalTLD: s.get<string>("internalTLD") ?? "",
  };
}

function deriveWebUrl(apiUrl: string): string {
  const { cloudTLD } = getTLDs();
  try {
    const url = new URL(apiUrl);
    if (cloudTLD && url.hostname.endsWith(`.${cloudTLD}`)) {
      return `https://web.${cloudTLD}`;
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "http://localhost:5173";
    }
    if (/^api\./i.test(url.hostname)) {
      url.hostname = url.hostname.replace(/^api\./i, "web.");
      return url.origin;
    }
  } catch {
    return "";
  }
  return "";
}

function deriveOrchestrationUrl(apiUrl: string): string {
  const { cloudTLD, internalTLD } = getTLDs();
  try {
    const url = new URL(apiUrl);
    if (cloudTLD && url.hostname.endsWith(`.${cloudTLD}`)) {
      return `https://dirigent.${cloudTLD}`;
    }
    if (internalTLD && cloudTLD && url.hostname.endsWith(`.${internalTLD}`)) {
      return `https://dirigent.${cloudTLD}`;
    }
    // Generic dynamic composition: api.<domain> → dirigent.<domain>.
    // No TLD settings needed — the suffix carries the deployment domain.
    if (/^api\./i.test(url.hostname)) {
      url.hostname = url.hostname.replace(/^api\./i, "dirigent.");
      return url.origin;
    }
  } catch {
    return "";
  }
  return "";
}

/**
 * Derive Keycloak realm URL from aishaUrl.
 * Cloud tier: hostname ending in cloudTLD → auth.${cloudTLD}/realms/${realm}
 * Internal tier: hostname ending in internalTLD → auth.{server}.${internalTLD}/realms/${realm}
 * Local dev: localhost → localhost:8180/realms/${realm} (local stack Keycloak)
 */
function deriveKeycloakUrl(aishaUrl: string): string {
  const realm = process.env.KEYCLOAK_REALM ?? "aisha";
  const { cloudTLD, internalTLD } = getTLDs();
  try {
    const url = new URL(aishaUrl);
    if (cloudTLD && url.hostname.endsWith(`.${cloudTLD}`)) {
      return `https://auth.${cloudTLD}/realms/${realm}`;
    }
    if (internalTLD && url.hostname.endsWith(`.${internalTLD}`)) {
      const authHostname = url.hostname.replace(/^[^.]+/, "auth");
      return `${url.protocol}//${authHostname}/realms/${realm}`;
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return `${LOCAL_KEYCLOAK_ORIGIN}/realms/${realm}`;
    }
    // Generic dynamic composition: api.<domain> → auth.<domain>/realms/<realm>.
    // Works for both planes (public api.<domain>, internal api.<server>.<tld>)
    // of any deployment following the subdomain convention — no TLD settings needed.
    if (/^api\./i.test(url.hostname)) {
      const authHostname = url.hostname.replace(/^api\./i, "auth.");
      return `${url.protocol}//${authHostname}/realms/${realm}`;
    }
  } catch {
    // Invalid URL — no derivation
  }
  return "";
}

/**
 * Derive Matrix homeserver URL from aishaUrl.
 * Generic: replaces leading subdomain with "matrix" (api.foo.tld → matrix.foo.tld).
 * Local dev: localhost → localhost:8448
 */
function deriveMatrixUrl(aishaUrl: string): string {
  const { cloudTLD, internalTLD } = getTLDs();
  try {
    const url = new URL(aishaUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "http://localhost:8448";
    }
    // Cross-plane: Matrix (federation/websockets) is NOT proxied through the
    // public plane — it lives on the internal plane, declared by the operator's
    // TLD pair (aisha.dirigent.cloudTLD / internalTLD).
    if (cloudTLD && internalTLD && url.hostname.endsWith(`.${cloudTLD}`)) {
      return `https://matrix.${internalTLD}`;
    }
    const parts = url.hostname.split(".");
    if (parts.length >= 2) {
      parts[0] = "matrix";
      return `${url.protocol}//${parts.join(".")}`;
    }
  } catch {
    // Invalid URL
  }
  return "";
}

/**
 * Derive svc-matrix token exchange URL from aishaUrl.
 * Generic: same API origin handles the /functions/v1/matrix-token-exchange path.
 * Local dev: localhost → localhost:3026
 */
function deriveMatrixServiceUrl(aishaUrl: string): string {
  try {
    const url = new URL(aishaUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "http://localhost:3026";
    }
    return `${url.origin}/functions/v1/matrix-token-exchange`;
  } catch {
    // Invalid URL
  }
  return "";
}

export function getDirigentConfig(): DirigentConfig {
  const root = workspaceRoot();
  const tracked = root
    ? readJsonIfExists(path.join(root, ".aisha", "dirigent.json"))
    : {};
  const local = root
    ? readJsonIfExists(path.join(root, ".aisha", "dirigent.local.json"))
    : {};

  // Deep-merge profiles from both tracked and local (local overrides per-profile)
  const trackedProfiles = (tracked.profiles ?? {}) as Record<string, ConnectionProfile>;
  const localProfiles = (local.profiles ?? {}) as Record<string, ConnectionProfile>;
  const allProfileNames = new Set([
    ...Object.keys(trackedProfiles),
    ...Object.keys(localProfiles),
  ]);
  const profiles: Record<string, ConnectionProfile> = {};
  for (const name of allProfileNames) {
    profiles[name] = { ...(trackedProfiles[name] ?? {}), ...(localProfiles[name] ?? {}) };
  }

  const activeProfile = (local.activeProfile ?? tracked.activeProfile ?? "") as string;
  const profileConfig = activeProfile && profiles[activeProfile] ? profiles[activeProfile] : {};

  // Flat merge — strip profiles/activeProfile/llm to handle them separately
  const { profiles: _tp, activeProfile: _ta, llm: trackedLlm, ...trackedFlat } = tracked;
  const { profiles: _lp, activeProfile: _la, llm: localLlm, ...localFlat } = local;

  // When an explicit profile is active, only AISHA_*-prefixed env vars
  // override profile settings. Generic vars like AISHA_POSTGREST_URL (shared with
  // the React app) must NOT clobber the profile — they serve a different app.
  const env = activeProfile ? aishaEnvOverrideOnly() : envOverride();

  const merged = {
    ...settingsFallback(),
    ...trackedFlat,
    ...profileConfig,
    ...localFlat,
    ...env,
    profiles,
    activeProfile,
  } as DirigentConfig;

  // Deep-merge LLM config: defaults → tracked → local
  const tLlm = (trackedLlm ?? {}) as Partial<LlmConfig>;
  const lLlm = (localLlm ?? {}) as Partial<LlmConfig>;
  merged.llm = {
    activePreset: lLlm.activePreset ?? tLlm.activePreset ?? merged.llm.activePreset,
    preferLocalForEval: lLlm.preferLocalForEval ?? tLlm.preferLocalForEval ?? merged.llm.preferLocalForEval,
    presets: {
      ...DEFAULT_LLM_PRESETS,
      ...(tLlm.presets ?? {}),
      ...(lLlm.presets ?? {}),
    },
  };

  merged.aishaUrl = normalizeAishaUrl(
    merged.aishaUrl ||
      (merged.mcpUrl ? deriveAishaUrlFromMcp(merged.mcpUrl) : "") ||
      DEFAULT_LOCAL_AISHA_URL,
  );
  const backendUrl = merged.aishaUrl;

  if (!merged.mcpUrl && backendUrl) {
    merged.mcpUrl = deriveMcpUrlFromLegacyBackend(backendUrl);
  }

  if (!merged.n8nTriggerUrl && backendUrl) {
    merged.n8nTriggerUrl = deriveN8nTriggerUrlFromLegacyBackend(backendUrl);
  }

  if (!merged.bootstrapUrl && backendUrl) {
    merged.bootstrapUrl = deriveBootstrapUrl(backendUrl);
  }

  if (!merged.webUrl && backendUrl) {
    merged.webUrl = deriveWebUrl(backendUrl);
  }

  if (!merged.orchestrationUrl && backendUrl) {
    merged.orchestrationUrl = deriveOrchestrationUrl(backendUrl);
  }

  merged.mcpUrl = merged.mcpUrl.replace(/\/+$/, "");
  merged.n8nTriggerUrl = normalizeN8nTriggerUrl(merged.n8nTriggerUrl).replace(/\/+$/, "");
  merged.orchestrationUrl = merged.orchestrationUrl.replace(/\/+$/, "");

  // Derive keycloakUrl if not explicitly set
  if (!merged.keycloakUrl && backendUrl) {
    merged.keycloakUrl = deriveKeycloakUrl(backendUrl);
  }

  // Derive Matrix URLs if not explicitly set
  if (!merged.matrixUrl && backendUrl) {
    merged.matrixUrl = deriveMatrixUrl(backendUrl);
  }
  if (!merged.matrixServiceUrl && backendUrl) {
    merged.matrixServiceUrl = deriveMatrixServiceUrl(backendUrl);
  }

  return merged;
}

/**
 * Get available profile names from config.
 */
export function getAvailableProfiles(): string[] {
  const config = getDirigentConfig();
  return Object.keys(config.profiles);
}

/**
 * Switch to a different connection profile.
 * Writes activeProfile to .aisha/dirigent.local.json and fires config change event.
 */
export async function switchProfile(profileName: string): Promise<boolean> {
  const root = workspaceRoot();
  if (!root) return false;

  const localPath = path.join(root, ".aisha", "dirigent.local.json");
  const existing = readJsonIfExists(localPath);
  existing.activeProfile = profileName;

  const dirPath = path.join(root, ".aisha");
  if (!existsSync(dirPath)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(dirPath, { recursive: true });
  }

  const { writeFileSync } = await import("fs");
  writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");

  const newConfig = getDirigentConfig();
  configChangeEmitter.fire(newConfig);
  return true;
}

/**
 * Update a key in .aisha/dirigent.local.json and fire config change.
 * Used for user-specific settings like expertiseLevel.
 */
export async function updateLocalConfig(key: string, value: string): Promise<boolean> {
  const root = workspaceRoot();
  if (!root) return false;

  const dirPath = path.join(root, ".aisha");
  if (!existsSync(dirPath)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(dirPath, { recursive: true });
  }

  const localPath = path.join(root, ".aisha", "dirigent.local.json");
  const existing = readJsonIfExists(localPath);
  existing[key] = value;

  const { writeFileSync } = await import("fs");
  writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf8");

  const newConfig = getDirigentConfig();
  configChangeEmitter.fire(newConfig);
  return true;
}

// ──────────────────────────────────────────
// Bootstrap — auto-fetch config from .well-known
// ──────────────────────────────────────────

export { ensureBootstrapConfig } from "./bootstrap.js";

/**
 * Ensure anonKey is available before proceeding with auth or API calls.
 *
 * Reads current config. If anonKey is missing, fetches from the bootstrap
 * endpoint and persists to `.aisha/dirigent.local.json`. Fires config change
 * event if config was updated.
 *
 * @returns The resolved config (with anonKey populated if bootstrap succeeded)
 */
export async function ensureConfigReady(): Promise<DirigentConfig> {
  const config = getDirigentConfig();

  if (config.anonKey) {
    return config;
  }

  // anonKey is missing — try bootstrap
  const { ensureBootstrapConfig: bootstrap } = await import("./bootstrap.js");
  const result = await bootstrap(
    config.activeProfile,
    config.bootstrapUrl || undefined,
    config.anonKey,
  );

  if (result.bootstrapped) {
    // Config file was updated — re-read and notify
    const newConfig = getDirigentConfig();
    configChangeEmitter.fire(newConfig);
    return newConfig;
  }

  return config;
}

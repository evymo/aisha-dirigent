#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "../..");

const TRACKED_CONFIG_PATHS = [
  path.join(ROOT, ".aisha", "dirigent.json"),
  path.join(ROOT, ".evymo", "dirigent.json"),
];
const LOCAL_CONFIG_PATHS = [
  path.join(ROOT, ".aisha", "dirigent.local.json"),
  path.join(ROOT, ".evymo", "dirigent.local.json"),
];
const LEGACY_SETTINGS_PATH = path.join(ROOT, ".vscode", "settings.json");
const DOTENV_PATH = path.join(ROOT, ".env");

function readFirstExistingJson(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate)) {
      return readJsonFile(candidate);
    }
  }

  return {};
}

function firstExistingPath(paths) {
  return paths.find((candidate) => existsSync(candidate)) || paths[0];
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const normalized = raw
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([}\]])/g, "$1");

    return JSON.parse(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON config ${path.relative(ROOT, filePath)}: ${message}`);
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const entries = {};
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

function normalizeSupabaseUrl(value) {
  if (!value) {
    return "";
  }

  return String(value).replace(/\/+$/, "");
}

function deriveSupabaseUrlFromMcp(mcpUrl) {
  if (!mcpUrl) {
    return "";
  }

  return String(mcpUrl)
    .replace(/\/functions\/v1\/mcp-knowledge-server\/?$/i, "")
    .replace(/\/+$/, "");
}

function mapLegacySettings(raw) {
  return {
    mcpUrl: raw["aisha.dirigent.mcpUrl"] ?? raw["aisha.mcpUrl"] ?? "",
    n8nTriggerUrl:
      raw["aisha.dirigent.n8nTriggerUrl"] ?? raw["aisha.n8nTriggerUrl"] ?? "",
    supabaseUrl:
      raw["aisha.dirigent.supabaseUrl"] ?? raw["aisha.supabaseUrl"] ?? "",
    anonKey: raw["aisha.dirigent.anonKey"] ?? raw["aisha.anonKey"] ?? "",
    storyId: raw["aisha.dirigent.storyId"] ?? raw["aisha.storyId"] ?? "",
    expertiseLevel:
      raw["aisha.dirigent.expertiseLevel"] ?? raw["aisha.expertiseLevel"] ?? "",
  };
}

function resolveProfileConfig(trackedConfig, localConfig, activeProfileOverride) {
  const trackedProfiles =
    trackedConfig && typeof trackedConfig.profiles === "object" && trackedConfig.profiles !== null
      ? trackedConfig.profiles
      : {};
  const localProfiles =
    localConfig && typeof localConfig.profiles === "object" && localConfig.profiles !== null
      ? localConfig.profiles
      : {};

  const activeProfile =
    activeProfileOverride ||
    localConfig?.activeProfile ||
    trackedConfig?.activeProfile ||
    Object.keys(localProfiles)[0] ||
    Object.keys(trackedProfiles)[0] ||
    null;

  if (!activeProfile) {
    return {};
  }

  const trackedProfileData = trackedProfiles[activeProfile] || {};
  const localProfileData = localProfiles[activeProfile] || {};

  return {
    ...trackedProfileData,
    ...localProfileData,
  };
}

function getConfigEnv() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { ...process.env };
  }
  return {
    ...readDotEnvFile(DOTENV_PATH),
    ...process.env,
  };
}

function pickEnvValue(source, ...keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function normalizeLegacySupabaseUrl(value) {
  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function mapEnv() {
  const env = getConfigEnv();
  const raw = {
    mcpUrl: pickEnvValue(env, "AISHA_MCP_URL"),
    accessToken: pickEnvValue(env, "AISHA_ACCESS_TOKEN", "AISHA_KEYCLOAK_ACCESS_TOKEN"),
    n8nTriggerUrl: pickEnvValue(env, "AISHA_N8N_TRIGGER_URL"),
    supabaseUrl: normalizeLegacySupabaseUrl(
      pickEnvValue(env, "AISHA_POSTGREST_URL", "AISHA_POSTGREST_URL", "VITE_AISHA_GATEWAY_URL", "API_DOMAIN"),
    ),
    anonKey: pickEnvValue(
      env,
      "AISHA_POSTGREST_ANON_KEY",
      "VITE_AISHA_GATEWAY_KEY",
      "VITE_AISHA_POSTGREST_PUBLISHABLE_KEY",
    ),
    storyId: pickEnvValue(env, "AISHA_STORY_ID"),
    expertiseLevel: pickEnvValue(env, "AISHA_EXPERTISE_LEVEL"),
    contextProfile: pickEnvValue(env, "AISHA_CONTEXT_PROFILE"),
    autonomyMode: pickEnvValue(env, "AISHA_AUTONOMY_MODE"),
    riskLevel: pickEnvValue(env, "AISHA_RISK_LEVEL"),
    deployCommand: pickEnvValue(env, "AISHA_DEPLOY_COMMAND"),
    postDeployVerifyCommand: pickEnvValue(env, "AISHA_POST_DEPLOY_VERIFY_COMMAND"),
    supabaseCliBin: pickEnvValue(env, "SUPABASE_CLI_BIN"),
  };

  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );
}

export function getDirigentConfigPaths() {
  return {
    tracked: firstExistingPath(TRACKED_CONFIG_PATHS),
    local: firstExistingPath(LOCAL_CONFIG_PATHS),
    legacySettings: LEGACY_SETTINGS_PATH,
  };
}

export function resolveDirigentConfig(overrides = {}) {
  const defaults = {
    mcpUrl: "",
    accessToken: "",
    n8nTriggerUrl: "",
    supabaseUrl: "",
    anonKey: "",
    storyId: "",
    expertiseLevel: "expert",
    contextProfile: "repo",
    autonomyMode: "hybrid",
    riskLevel: "smoke",
    deployCommand: "",
    postDeployVerifyCommand: "",
    supabaseCliBin: "",
  };

  const legacySettings = mapLegacySettings(readJsonFile(LEGACY_SETTINGS_PATH));
  const trackedConfig = readFirstExistingJson(TRACKED_CONFIG_PATHS);
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;
  const localConfig = isTest ? {} : readFirstExistingJson(LOCAL_CONFIG_PATHS);
  const profileConfig = resolveProfileConfig(
    trackedConfig,
    localConfig,
    typeof overrides.activeProfile === "string" ? overrides.activeProfile : null,
  );
  const envConfig = mapEnv();

  const cleanOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  );

  const merged = {
    ...defaults,
    ...legacySettings,
    ...trackedConfig,
    ...localConfig,
    ...profileConfig,
    ...envConfig,
    ...cleanOverrides,
  };

  merged.supabaseUrl = normalizeSupabaseUrl(
    merged.supabaseUrl || deriveSupabaseUrlFromMcp(merged.mcpUrl),
  );

  if (!merged.mcpUrl && merged.supabaseUrl) {
    merged.mcpUrl = `${merged.supabaseUrl}/functions/v1/mcp-knowledge-server`;
  }

  if (!merged.n8nTriggerUrl && merged.supabaseUrl) {
    merged.n8nTriggerUrl = `${merged.supabaseUrl}/admin/n8n-trigger`;
  }

  merged.mcpUrl = merged.mcpUrl.replace(/\/+$/, "");
  merged.n8nTriggerUrl = merged.n8nTriggerUrl
    .replace(/\/functions\/v1\/n8n-trigger\/?$/i, "/admin/n8n-trigger")
    .replace(/\/+$/, "");

  return {
    ...merged,
    hasRemoteConfig: Boolean(merged.mcpUrl || merged.n8nTriggerUrl),
  };
}

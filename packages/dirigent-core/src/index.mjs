import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export const AISHA_PROFILES = ["local", "cloud", "staging", "custom"];
export const AISHA_ROUTING_MODES = ["local", "hybrid", "cloud"];

export function findWorkspaceRoot(startDir, env = process.env) {
  if (env.AISHA_WORKSPACE_ROOT) {
    return path.resolve(env.AISHA_WORKSPACE_ROOT);
  }

  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (
      existsSync(path.join(current, ".aisha")) ||
      existsSync(path.join(current, ".git")) ||
      existsSync(path.join(current, "package.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

export function aishaPaths(root) {
  return {
    root,
    trackedPath: path.join(root, ".aisha", "dirigent.json"),
    localPath: path.join(root, ".aisha", "dirigent.local.json"),
    storyPath: path.join(root, ".aisha", "story.json"),
    sessionPath: path.join(root, ".aisha", "session.json"),
    rulesPath: path.join(root, ".rules"),
    briefsDir: path.join(root, ".aisha", "briefs"),
  };
}

export function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON config ${filePath}: ${message}`);
  }
}

export function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

export function pickString(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

export function readStoryFile(root) {
  const { storyPath } = aishaPaths(root);
  const story = readJsonIfExists(storyPath);
  return {
    path: storyPath,
    storyId: pickString(story, "story_id", "storyId"),
    updatedAt: pickString(story, "updated_at", "updatedAt"),
  };
}

export function writeStoryFile(root, storyId, extra = {}) {
  if (typeof storyId !== "string" || storyId.trim().length === 0) {
    throw new Error("story_id is required");
  }

  const { storyPath } = aishaPaths(root);
  const story = {
    ...extra,
    story_id: storyId.trim(),
    updated_at: new Date().toISOString(),
  };
  writeJson(storyPath, story);
  return {
    storyId: story.story_id,
    path: storyPath,
  };
}

export function resolveDirigentConfig(root, env = process.env, overrides = {}) {
  const paths = aishaPaths(root);
  const tracked = readJsonIfExists(paths.trackedPath);
  const local = readJsonIfExists(paths.localPath);

  const activeProfile =
    overrides.activeProfile ||
    env.AISHA_ACTIVE_PROFILE ||
    pickString(local, "activeProfile", "active_profile") ||
    pickString(tracked, "activeProfile", "active_profile") ||
    "local";

  const trackedProfile = tracked.profiles?.[activeProfile] || {};
  const localProfile = local.profiles?.[activeProfile] || {};
  const merged = {
    ...tracked,
    ...trackedProfile,
    ...local,
    ...localProfile,
    ...overrides,
  };

  const story = readStoryFile(root);
  const apiBaseUrl = pickString(
    env,
    "AISHA_API_BASE_URL",
    "AISHA_RUNTIME_API_URL",
    "AISHA_GATEWAY_URL",
  ) || pickString(merged, "apiBaseUrl", "runtimeApiUrl", "gatewayUrl");
  const mcpUrl = pickString(env, "AISHA_MCP_URL") || pickString(merged, "mcpUrl");
  const clientToken = pickString(
    env,
    "AISHA_ACCESS_TOKEN",
    "AISHA_KEYCLOAK_ACCESS_TOKEN",
    "AISHA_CLIENT_TOKEN",
    "VITE_AISHA_GATEWAY_KEY",
  ) || pickString(merged, "clientToken", "accessToken");
  const anonKey = pickString(
    env,
    "AISHA_ANON_KEY",
    "AISHA_POSTGREST_ANON_KEY",
    "VITE_AISHA_GATEWAY_KEY",
    "VITE_AISHA_POSTGREST_ANON_KEY",
  ) || pickString(merged, "anonKey");

  return {
    root,
    ...paths,
    tracked,
    local,
    activeProfile,
    apiBaseUrl,
    mcpUrl,
    clientToken,
    anonKey,
    storyId: env.AISHA_STORY_ID || pickString(merged, "storyId", "story_id") || story.storyId,
    guidanceProfile: pickString(merged, "guidanceProfile", "expertiseLevel") || "expert",
    routingMode: pickString(merged, "routingMode") || "hybrid",
    rulesAutoSync: merged.rules?.autoSync ?? merged.rulesAutoSync ?? true,
    dashboardUrl: pickString(merged, "dashboardUrl", "dashboard_url"),
    healthUrl: pickString(merged, "healthUrl", "health_url"),
  };
}

export function redactDirigentConfig(config) {
  return {
    root: config.root,
    activeProfile: config.activeProfile,
    apiBaseUrl: config.apiBaseUrl || null,
    mcpUrl: config.mcpUrl || null,
    hasClientToken: Boolean(config.clientToken),
    hasAnonKey: Boolean(config.anonKey),
    storyId: config.storyId || null,
    guidanceProfile: config.guidanceProfile,
    routingMode: config.routingMode,
    rulesAutoSync: Boolean(config.rulesAutoSync),
    dashboardUrl: config.dashboardUrl || null,
    healthUrl: config.healthUrl || null,
  };
}

export function updateLocalConfig(root, mutator) {
  const config = resolveDirigentConfig(root);
  const nextLocal = mutator({ ...config.local }, config);
  writeJson(config.localPath, nextLocal);
  return {
    localConfig: path.relative(root, config.localPath),
    config: nextLocal,
  };
}

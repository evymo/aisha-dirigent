#!/usr/bin/env node

/**
 * @module payload
 * Fetches the IDE instruction payload from Supabase RPC or loads from cache file.
 * Uses the dirigent config system for Supabase URL/key resolution.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { resolveDirigentConfig } from "../dirigent/config.mjs";
import { getLocalGatewayUrl } from "../../config/local-presets.mjs";
import { FETCH_TIMEOUT_MS } from "./registry.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CACHE_DIR = ".aisha";
const CACHE_FILE = "instruction-payload.json";

/**
 * Lightweight .env loader — reads .env file and populates process.env for missing keys.
 * No external dependency needed.
 */
function loadEnvFile() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      // Only set if not already in process.env (don't override explicit env vars)
      if (/^[A-Z0-9_]+$/.test(key) && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn(`[payload] .env load failed: ${err?.message || err}`);
  }
}

// Auto-load .env on import
loadEnvFile();

/**
 * Fetch payload from Supabase RPC `get_instruction_payload(p_story_id)`.
 * Without remote config it targets the LOCAL stack front door, derived from
 * the topology SoT (config/local-presets.mjs hostPorts → getLocalGatewayUrl),
 * NOT a hardcoded literal — the local gateway port lives in exactly one place.
 */
/**
 * Resolve the AISHA backend base URL + service key from options, env, and the
 * dirigent config, in that precedence. Shared by every REST/RPC caller here so
 * the resolution lives in one place. Throws when no key is available.
 */
function resolveBackend(options = {}) {
  const config = resolveDirigentConfig();
  const explicitEnvUrl =
    process.env.AISHA_POSTGREST_URL ||
    process.env.VITE_AISHA_GATEWAY_URL ||
    process.env.API_DOMAIN ||
    "";

  // Explicit caller options win first. Explicit URL envs win over profile
  // defaults, so a local `activeProfile` cannot shadow a CI/test backend.
  // Last resort = the local stack front door from the local-presets SoT.
  const baseUrl =
    options.aishaUrl ||
    options.supabaseUrl ||
    normalizeBackendUrl(explicitEnvUrl) ||
    config.aishaUrl ||
    config.supabaseUrl ||
    getLocalGatewayUrl();
  const serviceKey =
    options.serviceKey ||
    process.env.AISHA_POSTGREST_SERVICE_KEY ||
    process.env.VITE_AISHA_GATEWAY_KEY ||
    config.anonKey;

  if (!serviceKey) {
    throw new Error(
      "No AISHA backend key found. Set AISHA_POSTGREST_SERVICE_KEY or VITE_AISHA_GATEWAY_KEY.",
    );
  }

  return { baseUrl, serviceKey };
}

function normalizeBackendUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export async function fetchPayload(storyId, options = {}) {
  const { baseUrl, serviceKey } = resolveBackend(options);

  const url = `${baseUrl}/rest/v1/rpc/get_instruction_payload`;
  const body = storyId ? { p_story_id: storyId } : {};

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase RPC failed (${response.status}): ${text}`);
  }

  const payload = await response.json();

  if (!payload || !payload.rules) {
    throw new Error("Invalid payload structure — missing 'rules' field.");
  }

  return payload;
}

/**
 * Resolve the stack-default story id (partner_stories.is_stack_default = true).
 * Used by the opt-in `--stack-default` flag: on a replica instance the project
 * story adopted via adopt_story_as_stack_default becomes the natural gen:ide
 * context when no .aisha/story.json is present. Returns null when no
 * stack-default story exists.
 */
export async function fetchStackDefaultStoryId(options = {}) {
  const { baseUrl, serviceKey } = resolveBackend(options);

  const url = `${baseUrl}/rest/v1/partner_stories?is_stack_default=eq.true&select=id&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stack-default story lookup failed (${response.status}): ${text}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
}

/**
 * Load payload from a cached JSON file.
 */
export function loadPayloadFromFile(rootDir) {
  const filePath = path.join(rootDir, CACHE_DIR, CACHE_FILE);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * Save payload to cache file for offline generation.
 */
export function savePayloadToFile(payload, rootDir) {
  const dir = path.join(rootDir, CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, CACHE_FILE);
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
  return filePath;
}

/**
 * Read story_id from .aisha/story.json.
 */
export function readStoryId(rootDir) {
  const storyPath = path.join(rootDir, ".aisha", "story.json");
  if (!existsSync(storyPath)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(storyPath, "utf8"));
    return data.story_id || null;
  } catch {
    return null;
  }
}

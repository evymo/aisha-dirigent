/**
 * Compute Tier — Environment detection and task routing.
 *
 * Dynamically detects the deployment environment:
 * - EDGE:        Local machine with Ollama/vLLM (data collection, recap, filtering)
 * - SELF_HOSTED: Full AISHA stack running locally (backend URL = localhost)
 * - CLOUD:       AISHA cloud backend (*.${cloudTLD} or custom hostname)
 *
 * Routes tasks to the appropriate tier based on task kind and opt-in settings.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, resolveConnectionLabel } from "./config";
import { getDiscoveredModels, type DiscoveredModel } from "./llm-discovery";
import { getChipInfo, type ChipInfo } from "./system-info";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** Deployment tier identifier. */
export type Tier = "edge" | "self-hosted" | "cloud";

/** Task kinds that can be routed to a specific tier. */
export type TaskKind =
  | "collect"       // data collection, stats aggregation
  | "recap"         // test error summaries, regression hints
  | "filter"        // context filtering, deduplication
  | "evaluate"      // model evaluation, quality scoring
  | "compliance"    // compliance checks, gate enforcement
  | "orchestrate";  // full orchestration, model routing

/** Information about edge availability. */
export interface EdgeInfo {
  available: boolean;
  models: DiscoveredModel[];
  endpoints: string[];
  chip: ChipInfo;
}

/** Backend environment information. */
export interface BackendInfo {
  type: "self-hosted" | "cloud" | "none";
  url: string;
  label: string;
}

/** Full environment snapshot. */
export interface EnvironmentInfo {
  edge: EdgeInfo;
  backend: BackendInfo;
}

/** Result of tier resolution for a specific task. */
export interface TierResolution {
  tier: Tier;
  endpoint: string;
  model: string | null;
  reason: string;
}

// ──────────────────────────────────────────
// Event Emitter
// ──────────────────────────────────────────

const _onEnvironmentChanged = new vscode.EventEmitter<EnvironmentInfo>();
export const onEnvironmentChanged: vscode.Event<EnvironmentInfo> = _onEnvironmentChanged.event;

let cachedEnv: EnvironmentInfo | null = null;

// ──────────────────────────────────────────
// Detection
// ──────────────────────────────────────────

/** Tasks suitable for edge processing. */
const EDGE_TASKS: Set<TaskKind> = new Set(["collect", "recap", "filter"]);

/**
 * Detect the current environment. Caches result until explicitly refreshed.
 */
export function detectEnvironment(): EnvironmentInfo {
  const config = getDirigentConfig();
  const discovered = getDiscoveredModels();
  const chip = getChipInfo();

  const edgeAvailable = discovered.length > 0;
  const edgeEndpoints = [...new Set(discovered.map(m => getEdgeEndpoint(m)))];

  // Backend type detection from URL
  const aishaUrl = config.aishaUrl;
  let backendType: BackendInfo["type"] = "none";
  let backendLabel = "Not Connected";

  if (aishaUrl) {
    try {
      const url = new URL(aishaUrl);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        backendType = "self-hosted";
      } else {
        backendType = "cloud";
      }
    } catch {
      backendType = "none";
    }
    backendLabel = resolveConnectionLabel(aishaUrl, config.instanceLabel);
  }

  const env: EnvironmentInfo = {
    edge: {
      available: edgeAvailable,
      models: discovered,
      endpoints: edgeEndpoints,
      chip,
    },
    backend: {
      type: backendType,
      url: aishaUrl,
      label: backendLabel,
    },
  };

  const changed = !cachedEnv ||
    cachedEnv.edge.available !== env.edge.available ||
    cachedEnv.edge.models.length !== env.edge.models.length ||
    cachedEnv.backend.type !== env.backend.type ||
    cachedEnv.backend.url !== env.backend.url;

  cachedEnv = env;

  if (changed) {
    _onEnvironmentChanged.fire(env);
  }

  return env;
}

/**
 * Get the cached environment info (or detect fresh if not yet cached).
 */
export function getEnvironment(): EnvironmentInfo {
  return cachedEnv ?? detectEnvironment();
}

// ──────────────────────────────────────────
// Task Routing
// ──────────────────────────────────────────

/**
 * Check if edge-first mode is enabled (opt-in).
 */
export function isEdgeFirstEnabled(): boolean {
  return vscode.workspace.getConfiguration("aisha.dirigent").get<boolean>("edgeFirst", false);
}

/**
 * Pick the best edge model for a task.
 * Prefers smaller models for simple tasks.
 */
function pickEdgeModel(models: DiscoveredModel[]): string | null {
  if (models.length === 0) return null;
  // Just pick the first available — the user controls what's loaded in Ollama
  return models[0].modelId;
}

/**
 * Resolve the local edge execution target (endpoint + model) REGARDLESS of task
 * tiering or the edge-first opt-in.
 *
 * Used by the workbench drainer: the server-side resolver (fn_resolve_runtime)
 * already chose the `workbench` runtime for the enqueued clow, so the request
 * must run on the local model whenever one is discovered — the task-kind gate in
 * {@link resolveTier} does NOT apply here.
 *
 * @returns `{ endpoint, model }` when a local model is available, else `null`.
 */
export function resolveEdgeTarget(): { endpoint: string; model: string } | null {
  const env = getEnvironment();
  if (!env.edge.available || env.edge.models.length === 0) return null;
  const model = pickEdgeModel(env.edge.models);
  if (!model) return null;
  return { endpoint: getEdgeEndpoint(env.edge.models[0]), model };
}

/**
 * Resolve the optimal tier for a given task.
 *
 * Rules:
 * - Edge tasks (collect, recap, filter) use edge if opt-in + available
 * - Backend tasks (evaluate, compliance, orchestrate) always go to backend
 * - Fallback: edge unavailable → backend handles raw data
 */
export function resolveTier(task: TaskKind): TierResolution {
  const env = getEnvironment();
  const config = getDirigentConfig();
  const edgeFirst = isEdgeFirstEnabled();

  // Backend tasks always go to backend
  if (!EDGE_TASKS.has(task)) {
    return {
      tier: env.backend.type === "self-hosted" ? "self-hosted" : "cloud",
      endpoint: config.mcpUrl || config.aishaUrl,
      model: null,
      reason: `Task "${task}" requires backend evaluation`,
    };
  }

  // Edge tasks: use edge if opt-in + available
  if (edgeFirst && env.edge.available) {
    const model = pickEdgeModel(env.edge.models);
    const edgeEndpoint = getEdgeEndpoint(env.edge.models[0]);
    return {
      tier: "edge",
      endpoint: edgeEndpoint,
      model,
      reason: `Edge-first enabled, local model available`,
    };
  }

  // Edge not available or not opted in — fallback to backend
  if (edgeFirst && !env.edge.available) {
    return {
      tier: env.backend.type === "self-hosted" ? "self-hosted" : "cloud",
      endpoint: config.mcpUrl || config.aishaUrl,
      model: null,
      reason: `Edge-first enabled but no local models available — fallback to backend`,
    };
  }

  // Default: backend handles everything
  return {
    tier: env.backend.type === "self-hosted" ? "self-hosted" : "cloud",
    endpoint: config.mcpUrl || config.aishaUrl,
    model: null,
    reason: `Edge-first disabled — using backend`,
  };
}

/**
 * Get the OpenAI-compatible base URL for an edge model.
 */
function getEdgeEndpoint(model: DiscoveredModel): string {
  const config = getDirigentConfig();
  const preset = config.llm.presets[model.presetName];
  if (preset) {
    return preset.baseUrl;
  }
  // Fallback: construct from provider
  switch (model.provider) {
    case "ollama": return "http://localhost:11434/v1";
    case "docker-desktop": return "http://localhost:12434/v1";
    case "vllm": return "http://localhost:8100/v1";
    default: return "http://localhost:11434/v1";
  }
}

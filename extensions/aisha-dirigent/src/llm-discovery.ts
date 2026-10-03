/**
 * LLM auto-discovery module for AISHA Dirigent.
 *
 * Probes known local LLM endpoints (Docker Desktop Model Runner, Ollama, vLLM)
 * and returns discovered models. Uses OpenAI-compatible `/v1/models` endpoint.
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig, type LlmProviderPreset } from "./config";
import { recordApiCall } from "./resource-tracker";
import { callRpc } from "./backend-rpc";

/** Discovery interval in milliseconds (5 minutes). */
const DISCOVERY_INTERVAL_MS = 5 * 60_000;
/** Backoff interval after consecutive failures (30 minutes). */
const DISCOVERY_BACKOFF_MS = 30 * 60_000;
/** Number of consecutive failures before switching to backoff interval. */
const MAX_FAILURES_BEFORE_BACKOFF = 3;

/** HTTP request timeout for probing endpoints (ms). */
const PROBE_TIMEOUT_MS = 3_000;

/** A model discovered from a local LLM provider. */
export interface DiscoveredModel {
  provider: string;
  presetName: string;
  modelId: string;
  ownedBy?: string;
}

/** Result of a single provider probe. */
interface ProbeResult {
  presetName: string;
  provider: string;
  models: DiscoveredModel[];
  online: boolean;
}

/** Event emitter for discovery updates. */
const discoveryEmitter = new vscode.EventEmitter<DiscoveredModel[]>();
export const onModelsDiscovered = discoveryEmitter.event;

let discoveredModels: DiscoveredModel[] = [];
let discoveryTimer: ReturnType<typeof setInterval> | undefined;
let consecutiveEmptyDiscoveries = 0;

/**
 * Get the latest discovered models (cached from last probe).
 */
export function getDiscoveredModels(): DiscoveredModel[] {
  return discoveredModels;
}

/**
 * Probe a single endpoint for available models.
 */
async function probeEndpoint(presetName: string, preset: LlmProviderPreset): Promise<ProbeResult> {
  const result: ProbeResult = {
    presetName,
    provider: preset.provider,
    models: [],
    online: false,
  };

  // Ollama has a native endpoint, but also supports OpenAI compat
  const url = preset.provider === "ollama"
    ? preset.baseUrl.replace(/\/v1\/?$/, "/api/tags")
    : `${preset.baseUrl.replace(/\/+$/, "")}/models`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = performance.now();

  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (preset.apiKey) {
      headers["Authorization"] = `Bearer ${preset.apiKey}`;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      recordApiCall("llm-discovery", performance.now() - t0, 0, true);
      return result;
    }

    const body = await response.json() as Record<string, unknown>;
    recordApiCall("llm-discovery", performance.now() - t0, JSON.stringify(body).length, false);
    result.online = true;

    // OpenAI-compatible format: { data: [{ id: "model-name", owned_by: "..." }] }
    // Ollama /api/tags format: { models: [{ name: "model-name", ... }] }
    const models = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.models)
        ? body.models
        : [];

    for (const m of models) {
      if (m && typeof m === "object") {
        const entry = m as Record<string, unknown>;
        const modelId = typeof entry.id === "string" ? entry.id
          : typeof entry.name === "string" ? entry.name
          : undefined;
        if (modelId) {
          result.models.push({
            provider: preset.provider,
            presetName,
            modelId,
            ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : undefined,
          });
        }
      }
    }
  } catch {
    recordApiCall("llm-discovery", performance.now() - t0, 0, true);
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

/**
 * Run discovery across all enabled LLM presets.
 * Probes endpoints in parallel and updates the cached model list.
 */
/** Models already reported to the registry this session (provider:modelId). */
const reportedModels = new Set<string>();

/**
 * Report discovered local models into the central registry via
 * `upsert_discovered_model` (admin/staff-gated SECURITY DEFINER; the dev user
 * is admin/staff). Each lands as `eval_status='pending'` tagged `source:'workbench'`
 * — surface-agnostic with cloud models, then self-tested before use. Soft per
 * model + deduped via `seen`, so a flapping endpoint is not re-reported every
 * cycle. Returns the count newly reported.
 *
 * @param models - the freshly discovered models
 * @param seen - dedup set (defaults to the module-level session set; injectable for tests)
 */
export async function reportDiscoveredModels(
  models: DiscoveredModel[],
  seen: Set<string> = reportedModels,
): Promise<number> {
  let reported = 0;
  for (const m of models) {
    const key = `${m.provider}:${m.modelId}`;
    if (seen.has(key)) continue;
    try {
      const { data } = await callRpc("upsert_discovered_model", {
        p_model_id: m.modelId,
        p_provider: m.provider,
        p_provider_metadata: { source: "workbench" },
      });
      if (data) {
        seen.add(key);
        reported += 1;
      }
    } catch {
      // Soft — a registry hiccup must never break local discovery.
    }
  }
  return reported;
}

export async function discoverModels(): Promise<DiscoveredModel[]> {
  const config = getDirigentConfig();
  const presets = config.llm.presets;

  const probes = Object.entries(presets)
    .filter(([, preset]) => preset.enabled)
    .map(([name, preset]) => probeEndpoint(name, preset));

  const results = await Promise.allSettled(probes);
  const all: DiscoveredModel[] = [];

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.online) {
      all.push(...r.value.models);
    }
  }

  discoveredModels = all;
  discoveryEmitter.fire(all);

  // Report into the central registry so workbench-discovered local models are
  // surface-agnostic — discovered / self-tested / resolved like any cloud model.
  // Soft + deduped per session; never blocks discovery.
  void reportDiscoveredModels(all).catch(() => undefined);

  // Track consecutive empty discoveries for backoff
  if (all.length === 0) {
    consecutiveEmptyDiscoveries++;
  } else {
    consecutiveEmptyDiscoveries = 0;
  }

  return all;
}

/**
 * Start periodic LLM endpoint discovery.
 * First discovery runs immediately, then every 5 minutes.
 */
export function startDiscovery(context: vscode.ExtensionContext): void {
  // Initial discovery (non-blocking)
  void discoverModels();

  // Dynamic interval: normal 5min, backoff to 30min after consecutive failures
  const scheduleNext = () => {
    const interval = consecutiveEmptyDiscoveries >= MAX_FAILURES_BEFORE_BACKOFF
      ? DISCOVERY_BACKOFF_MS
      : DISCOVERY_INTERVAL_MS;
    discoveryTimer = setTimeout(async () => {
      await discoverModels();
      scheduleNext();
    }, interval);
  };
  scheduleNext();

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (discoveryTimer) {
        clearTimeout(discoveryTimer);
        discoveryTimer = undefined;
      }
    }),
  );
}

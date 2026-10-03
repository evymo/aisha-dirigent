/**
 * Tier Resolver — 3-tier instruction generation orchestrator.
 *
 * Resolves the best available tier for generating IDE instruction files:
 *   Tier 1: Backend (MCP) — fully contextual rules from the platform
 *   Tier 2: Local Intelligence — edgeChat + detected tech stack
 *   Tier 3: Universal Baseline — bundled golden standards
 *
 * Implements tier-locking: once a higher tier was used, the cached payload
 * is preferred over a lower tier during backend outages.
 *
 * @module
 */

import * as vscode from "vscode";
import { callMcpTool, extractJson } from "./mcp-client";
import { edgeChat } from "./local-llm-client";
import { readInstructionCache, writeInstructionCache } from "./instruction-cache";
import { buildBaselinePayload } from "./generators/universal-baseline";
import { generateAll } from "./generators/generate-all";

import type { InstructionPayload } from "./generators/registry";
import type { InstructionTier, InstructionCacheEntry } from "./instruction-cache";
import type { GenerateResult } from "./generators/generate-all";
import type { ChatMessage } from "./local-llm-client";

// ──────────────────────────────────────────
// Tier state observable
// ──────────────────────────────────────────

export interface TierState {
  tier: InstructionTier | null;
  source: TierResult["source"] | null;
  syncing: boolean;
}

const _onTierStateChanged = new vscode.EventEmitter<TierState>();
/** Fires when the active tier changes (after sync completes or starts). */
export const onTierStateChanged = _onTierStateChanged.event;

let _currentTierState: TierState = { tier: null, source: null, syncing: false };
/** Returns the last known tier state. */
export function getCurrentTierState(): TierState {
  return _currentTierState;
}

function setTierState(state: TierState): void {
  _currentTierState = state;
  _onTierStateChanged.fire(state);
}

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface TierResult {
  tier: InstructionTier;
  payload: InstructionPayload;
  source: "backend" | "cache" | "local-llm" | "baseline";
}

export interface InstructionSyncResult {
  tier: InstructionTier;
  source: TierResult["source"];
  generation: GenerateResult;
}

// ──────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────

/** Max cache age before it's considered stale (24 hours). */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** User consent key stored in .aisha/dirigent.local.json. */
const BASELINE_CONSENT_KEY = "baselineConsent";

// ──────────────────────────────────────────
// Tier 1: Backend (MCP)
// ──────────────────────────────────────────

async function tryBackend(storyId?: string): Promise<InstructionPayload | null> {
  try {
    const result = await callMcpTool("get_instruction_payload", {
      ...(storyId ? { story_id: storyId } : {}),
    });

    if (!result) return null;

    const json = extractJson(result);
    if (!json || !json.rules) return null;

    return json as unknown as InstructionPayload;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Tier 2: Local Intelligence
// ──────────────────────────────────────────

async function tryLocalLlm(techStack: string[]): Promise<InstructionPayload | null> {
  if (techStack.length === 0) return null;

  const systemPrompt = [
    "You are a senior software engineering advisor.",
    "Based on the detected technology stack, generate a set of IDE coding guidelines.",
    "Output valid JSON matching this structure:",
    '{ "rules": [{ "slug": "rule-id", "title": "Rule Title", "category": "category_name", "ai_instructions": "Rule description" }] }',
    "",
    "Categories to use: code_quality, testing, security, architecture, git_workflow, coding_standard, performance_optimization",
    "Generate 8-15 rules that are specific to the given tech stack but universally good practices.",
    "Do NOT include any project-specific rules or references to proprietary tools.",
    "Output ONLY the JSON, no markdown fences, no explanation.",
  ].join("\n");

  const userPrompt = `Detected tech stack: ${techStack.join(", ")}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  try {
    const result = await edgeChat(messages, {
      task: "filter",
      maxTokens: 2048,
      temperature: 0.3,
    });

    if (!result) return null;

    // Parse JSON from LLM response
    const jsonStr = result.content.trim();
    const parsed = JSON.parse(jsonStr) as { rules?: unknown[] };

    if (!parsed.rules || !Array.isArray(parsed.rules)) return null;

    return {
      story: null,
      rules: parsed.rules as InstructionPayload["rules"],
      ruleset: null,
      scope: "local-llm",
      payload_version: 1,
      generated_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Tier 3: Universal Baseline
// ──────────────────────────────────────────

async function tryBaseline(rootUri: vscode.Uri): Promise<InstructionPayload | null> {
  // Check if user has previously consented
  const hasConsent = await checkBaselineConsent(rootUri);

  if (!hasConsent) {
    // Ask user for consent
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t("AISHA Dirigent: No backend available. Generate universal coding guidelines?"),
      vscode.l10n.t("Generate"),
      vscode.l10n.t("Skip"),
    );

    if (choice !== vscode.l10n.t("Generate")) {
      return null;
    }

    // Save consent
    await saveBaselineConsent(rootUri, true);
  }

  return buildBaselinePayload();
}

// ──────────────────────────────────────────
// Consent helpers
// ──────────────────────────────────────────

async function checkBaselineConsent(rootUri: vscode.Uri): Promise<boolean> {
  try {
    const configUri = vscode.Uri.joinPath(rootUri, ".aisha", "dirigent.local.json");
    const data = await vscode.workspace.fs.readFile(configUri);
    const config = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    return config[BASELINE_CONSENT_KEY] === true;
  } catch {
    return false;
  }
}

async function saveBaselineConsent(rootUri: vscode.Uri, consent: boolean): Promise<void> {
  const dirUri = vscode.Uri.joinPath(rootUri, ".aisha");
  const configUri = vscode.Uri.joinPath(dirUri, "dirigent.local.json");

  let config: Record<string, unknown> = {};

  try {
    const data = await vscode.workspace.fs.readFile(configUri);
    config = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
  } catch {
    // New file
  }

  config[BASELINE_CONSENT_KEY] = consent;

  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // exists
  }

  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(JSON.stringify(config, null, 2) + "\n"),
  );
}

// ──────────────────────────────────────────
// Main resolver
// ──────────────────────────────────────────

/**
 * Resolve the best available tier and return the instruction payload.
 *
 * Resolution order:
 * 1. Backend (MCP) → Tier 1
 * 2. Check cache (if Tier 1 failed) → cached tier
 * 3. Local LLM (if cache expired/missing) → Tier 2
 * 4. Universal baseline (with consent) → Tier 3
 */
export async function resolveTierPayload(
  rootUri: vscode.Uri,
  options: {
    storyId?: string;
    techStack?: string[];
    forceTier?: InstructionTier;
  } = {},
): Promise<TierResult | null> {
  // Tier 1: Backend
  if (!options.forceTier || options.forceTier === 1) {
    const payload = await tryBackend(options.storyId);
    if (payload) {
      // Cache the result
      await writeInstructionCache(rootUri, {
        tier: 1,
        generatedAt: new Date().toISOString(),
        fingerprint: payload.ruleset?.fingerprint || null,
        payload,
      });
      return { tier: 1, payload, source: "backend" };
    }
  }

  // Check cache (tier-locking: use cached tier content on backend outage)
  const cached = await readInstructionCache(rootUri);
  if (cached && !isCacheExpired(cached)) {
    return { tier: cached.tier, payload: cached.payload, source: "cache" };
  }

  // Tier 2: Local LLM
  if (!options.forceTier || options.forceTier === 2) {
    const techStack = options.techStack || [];
    const payload = await tryLocalLlm(techStack);
    if (payload) {
      await writeInstructionCache(rootUri, {
        tier: 2,
        generatedAt: new Date().toISOString(),
        fingerprint: null,
        payload,
      });
      return { tier: 2, payload, source: "local-llm" };
    }
  }

  // Tier 3: Universal baseline (with user consent)
  if (!options.forceTier || options.forceTier === 3) {
    const payload = await tryBaseline(rootUri);
    if (payload) {
      await writeInstructionCache(rootUri, {
        tier: 3,
        generatedAt: new Date().toISOString(),
        fingerprint: null,
        payload,
      });
      return { tier: 3, payload, source: "baseline" };
    }
  }

  return null;
}

function isCacheExpired(entry: InstructionCacheEntry): boolean {
  const age = Date.now() - new Date(entry.generatedAt).getTime();
  return age > CACHE_MAX_AGE_MS;
}

/**
 * Full instruction sync: resolve tier → generate all files → return result.
 *
 * This is the main entry point that replaces triggerIdeRegeneration().
 */
export async function syncInstructions(
  rootUri: vscode.Uri,
  options: {
    storyId?: string;
    techStack?: string[];
  } = {},
): Promise<InstructionSyncResult | null> {
  setTierState({ tier: null, source: null, syncing: true });

  const tierResult = await resolveTierPayload(rootUri, options);
  if (!tierResult) {
    setTierState({ tier: null, source: null, syncing: false });
    return null;
  }

  const generation = await generateAll(tierResult.payload, rootUri);

  setTierState({ tier: tierResult.tier, source: tierResult.source, syncing: false });

  return {
    tier: tierResult.tier,
    source: tierResult.source,
    generation,
  };
}

/** Tier label for UI display. */
export function tierLabel(tier: InstructionTier): string {
  switch (tier) {
    case 1: return "Backend";
    case 2: return "Local LLM";
    case 3: return "Baseline";
  }
}

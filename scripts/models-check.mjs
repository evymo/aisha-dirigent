#!/usr/bin/env node
/**
 * models-check.mjs — Universal LLM Model Discovery & Report
 *
 * Shows available models, pricing, capabilities, and current tier configuration.
 * Optionally validates API keys by pinging provider endpoints.
 *
 * @example
 *   npm run models:check              # Show catalog + tier config
 *   npm run models:check -- --validate # Also ping each provider API
 *   npm run models:check -- --json     # Machine-readable output
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Colors ──────────────────────────────────────────────────────────────────
const isCI = !!process.env.CI || !!process.env.NO_COLOR;
const c = {
  red: (s) => (isCI ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s) => (isCI ? s : `\x1b[32m${s}\x1b[0m`),
  yellow: (s) => (isCI ? s : `\x1b[33m${s}\x1b[0m`),
  blue: (s) => (isCI ? s : `\x1b[34m${s}\x1b[0m`),
  cyan: (s) => (isCI ? s : `\x1b[36m${s}\x1b[0m`),
  magenta: (s) => (isCI ? s : `\x1b[35m${s}\x1b[0m`),
  dim: (s) => (isCI ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s) => (isCI ? s : `\x1b[1m${s}\x1b[0m`),
};

// ── Known Model Catalog ─────────────────────────────────────────────────────
// Matches ai_model_registry seed data from 20_aisha_backbone.sql
const MODEL_CATALOG = [
  // OpenAI
  {
    provider: "openai",
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
    ctx: "128K",
    caps: ["reasoning"],
    bestFor: "Cheapest smart model — reasoning at lowest cost",
  },
  {
    provider: "openai",
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
    ctx: "128K",
    caps: ["vision"],
    bestFor: "Vision tasks at low cost",
  },
  {
    provider: "openai",
    id: "o4-mini",
    name: "O4 Mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    ctx: "200K",
    caps: ["reasoning", "vision"],
    bestFor: "Advanced reasoning with vision, moderate cost",
  },
  {
    provider: "openai",
    id: "o3-mini",
    name: "O3 Mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    ctx: "200K",
    caps: ["reasoning"],
    bestFor: "Dedicated reasoning specialist",
  },
  {
    provider: "openai",
    id: "gpt-4o",
    name: "GPT-4o",
    inputPrice: 2.5,
    outputPrice: 10.0,
    ctx: "128K",
    caps: ["vision"],
    bestFor: "Flagship OpenAI — strong all-rounder",
  },
  // Google
  {
    provider: "google",
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    inputPrice: 0.1,
    outputPrice: 0.4,
    ctx: "1M",
    caps: ["vision"],
    bestFor: "Absolute cheapest model with 1M context window",
  },
  {
    provider: "google",
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    inputPrice: 0.15,
    outputPrice: 0.6,
    ctx: "1M",
    caps: ["reasoning", "vision"],
    bestFor: "Reasoning + vision + 1M context — best value mid-tier",
  },
  {
    provider: "google",
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    inputPrice: 1.25,
    outputPrice: 10.0,
    ctx: "1M",
    caps: ["reasoning", "vision"],
    bestFor: "Best Google model — deep analysis with 1M context",
  },
  // Anthropic
  {
    provider: "anthropic",
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    inputPrice: 0.8,
    outputPrice: 4.0,
    ctx: "200K",
    caps: [],
    bestFor: "Fast Anthropic model, good at code generation",
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    inputPrice: 3.0,
    outputPrice: 15.0,
    ctx: "200K",
    caps: ["vision"],
    bestFor: "Best coding & deep analysis model — premium tier",
  },
  {
    provider: "anthropic",
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    inputPrice: 3.0,
    outputPrice: 15.0,
    ctx: "200K",
    caps: ["vision"],
    bestFor: "Strong all-rounder, good code + analysis",
  },
  // xAI
  {
    provider: "xai",
    id: "grok-3-mini",
    name: "Grok 3 Mini",
    inputPrice: 0.3,
    outputPrice: 0.5,
    ctx: "131K",
    caps: ["reasoning"],
    bestFor: "Cheap reasoning alternative from xAI",
  },
  {
    provider: "xai",
    id: "grok-3",
    name: "Grok 3",
    inputPrice: 3.0,
    outputPrice: 15.0,
    ctx: "131K",
    caps: ["reasoning"],
    bestFor: "xAI flagship reasoning model",
  },
  // Self-hosted (vLLM)
  {
    provider: "vllm",
    id: "Qwen/Qwen3-30B-A3B",
    name: "Qwen3 30B (self-hosted)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "32K",
    caps: [],
    bestFor: "Free, self-hosted — requires NVIDIA GPU (24GB+ VRAM)",
  },
  // Local — Ollama
  {
    provider: "ollama",
    id: "ollama-mistral-nemo",
    name: "Mistral Nemo (Ollama)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "128K",
    caps: [],
    bestFor: "Free local — 16GB+ RAM, Metal/CUDA via llama.cpp",
  },
  {
    provider: "ollama",
    id: "ollama-phi4",
    name: "Phi 4 (Ollama)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "16K",
    caps: ["reasoning"],
    bestFor: "Free local — 24GB+ RAM, strong reasoning",
  },
  {
    provider: "ollama",
    id: "ollama-qwen2.5-coder:3b",
    name: "Qwen 2.5 Coder 3B (Ollama)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "32K",
    caps: [],
    bestFor: "Free local — 8GB RAM, smallest viable coding model",
  },
  // Local — Docker Model Runner
  {
    provider: "docker",
    id: "docker-ai/mistral-nemo",
    name: "Mistral Nemo (Docker)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "128K",
    caps: [],
    bestFor: "Free local — Docker Desktop, CPU-only (VM)",
  },
  {
    provider: "docker",
    id: "docker-ai/phi4",
    name: "Phi 4 (Docker)",
    inputPrice: 0,
    outputPrice: 0,
    ctx: "16K",
    caps: ["reasoning"],
    bestFor: "Free local — Docker Desktop, CPU-only reasoning",
  },
];

// ── Provider Configuration ──────────────────────────────────────────────────
const PROVIDERS = {
  openai: {
    name: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    validateUrl: "https://api.openai.com/v1/models",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    name: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    validateUrl: "https://api.anthropic.com/v1/messages",
    authHeader: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    validateMethod: "POST",
    validateBody: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  },
  google: {
    name: "Google AI",
    keyEnv: "GOOGLE_AI_API_KEY",
    validateUrl: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    authHeader: () => ({}),
  },
  xai: {
    name: "xAI",
    keyEnv: "XAI_API_KEY",
    validateUrl: "https://api.x.ai/v1/models",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  vllm: {
    name: "vLLM (self-hosted)",
    keyEnv: "VLLM_GENERATION_URL",
    validateUrl: null, // dynamic from env
    authHeader: () => ({}),
  },
  ollama: {
    name: "Ollama (local)",
    keyEnv: "OLLAMA_URL",
    validateUrl: null, // dynamic from env
    authHeader: () => ({}),
  },
  docker: {
    name: "Docker Model Runner",
    keyEnv: "DOCKER_MODEL_RUNNER_URL",
    validateUrl: null, // dynamic from env
    authHeader: () => ({}),
  },
};

// ── Default Tier Presets ────────────────────────────────────────────────────
const TIER_PRESETS = {
  "cost-optimized": {
    name: "Cost-Optimized (recommended)",
    desc: "gpt-5-mini base → gemini mid → sonnet premium",
    tiers: {
      greeting: "gpt-5-mini",
      simple: "gpt-5-mini",
      moderate: "gemini-2.5-flash",
      complex: "claude-sonnet-4-20250514",
      deep_analysis: "claude-sonnet-4-20250514",
    },
  },
  "google-first": {
    name: "Google-First (all Gemini)",
    desc: "Cheapest with 1M context throughout",
    tiers: {
      greeting: "gemini-2.0-flash",
      simple: "gemini-2.0-flash",
      moderate: "gemini-2.5-flash",
      complex: "gemini-2.5-pro",
      deep_analysis: "gemini-2.5-pro",
    },
  },
  "openai-only": {
    name: "OpenAI-Only",
    desc: "All OpenAI, no other providers needed",
    tiers: {
      greeting: "gpt-5-mini",
      simple: "gpt-5-mini",
      moderate: "gpt-4o-mini",
      complex: "gpt-4o",
      deep_analysis: "gpt-4o",
    },
  },
  "self-hosted": {
    name: "Self-Hosted (vLLM)",
    desc: "Zero cost, requires NVIDIA GPU",
    tiers: {
      greeting: "Qwen/Qwen3-30B-A3B",
      simple: "Qwen/Qwen3-30B-A3B",
      moderate: "Qwen/Qwen3-30B-A3B",
      complex: "Qwen/Qwen3-30B-A3B",
      deep_analysis: "Qwen/Qwen3-30B-A3B",
    },
  },
  "balanced-multi": {
    name: "Balanced Multi-Provider",
    desc: "Best model per tier across all providers",
    tiers: {
      greeting: "gpt-5-mini",
      simple: "gemini-2.5-flash",
      moderate: "gemini-2.5-flash",
      complex: "claude-sonnet-4-20250514",
      deep_analysis: "claude-sonnet-4-20250514",
    },
  },
  "local-ollama": {
    name: "Local Ollama (zero cost)",
    desc: "All local via Ollama — Metal/CUDA, no API keys needed",
    tiers: {
      greeting: "ollama-mistral-nemo",
      simple: "ollama-mistral-nemo",
      moderate: "ollama-mistral-nemo",
      complex: "ollama-phi4",
      deep_analysis: "ollama-phi4",
    },
  },
  "local-docker": {
    name: "Local Docker (zero cost)",
    desc: "All local via Docker Model Runner — no GPU required",
    tiers: {
      greeting: "docker-ai/mistral-nemo",
      simple: "docker-ai/mistral-nemo",
      moderate: "docker-ai/mistral-nemo",
      complex: "docker-ai/phi4",
      deep_analysis: "docker-ai/phi4",
    },
  },
};

// ── Load .env ───────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  // Load .env (API keys for cloud providers)
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  // Load .env.local (local backend URLs)
  const envLocalPath = resolve(PROJECT_ROOT, ".env.local");
  if (existsSync(envLocalPath)) {
    for (const line of readFileSync(envLocalPath, "utf-8").split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

// ── Current Tier Config (from env) ──────────────────────────────────────────
function getCurrentTiers(env) {
  return {
    greeting: env.MODEL_TIER_GREETING || "gpt-5-mini",
    simple: env.MODEL_TIER_SIMPLE || "gpt-5-mini",
    moderate: env.MODEL_TIER_MODERATE || "gemini-2.5-flash",
    complex: env.MODEL_TIER_COMPLEX || "claude-sonnet-4-20250514",
    deep_analysis: env.MODEL_TIER_DEEP || "claude-sonnet-4-20250514",
  };
}

// ── API Key Validation ──────────────────────────────────────────────────────
async function validateProvider(providerId, key) {
  const provider = PROVIDERS[providerId];
  if (!provider) return { ok: false, error: "Unknown provider" };

  try {
    if (providerId === "vllm" || providerId === "ollama" || providerId === "docker") {
      const url = `${key}/models`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { ok: resp.ok, status: resp.status };
    }

    const url =
      typeof provider.validateUrl === "function"
        ? provider.validateUrl(key)
        : provider.validateUrl;
    const headers = {
      "Content-Type": "application/json",
      ...provider.authHeader(key),
    };
    const resp = await fetch(url, {
      method: provider.validateMethod || "GET",
      headers,
      body: provider.validateBody || undefined,
      signal: AbortSignal.timeout(10000),
    });

    // Anthropic returns 400 for minimal request but key is valid (401 = invalid)
    if (providerId === "anthropic") {
      return { ok: resp.status !== 401, status: resp.status };
    }
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Report Formatting ───────────────────────────────────────────────────────
function formatPrice(price) {
  if (price === 0) return c.green("$0.00");
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

function formatCaps(caps) {
  if (caps.length === 0) return c.dim("—");
  return caps
    .map((cap) => {
      if (cap === "reasoning") return c.cyan("reasoning");
      if (cap === "vision") return c.magenta("vision");
      return cap;
    })
    .join("+");
}

function printSeparator(char = "─", len = 100) {
  console.log(c.dim(char.repeat(len)));
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const validate = args.includes("--validate");
  const jsonOutput = args.includes("--json");

  const env = loadEnv();

  // ── JSON output mode ──
  if (jsonOutput) {
    const result = {
      providers: {},
      models: MODEL_CATALOG,
      currentTiers: getCurrentTiers(env),
      presets: TIER_PRESETS,
    };
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const key = env[provider.keyEnv];
      result.providers[id] = {
        name: provider.name,
        configured: !!key,
        keyEnv: provider.keyEnv,
      };
      if (validate && key) {
        const check = await validateProvider(id, key);
        result.providers[id].valid = check.ok;
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // ── Banner ──
  console.log("");
  console.log(
    c.cyan(c.bold("╔══════════════════════════════════════════════════════╗"))
  );
  console.log(
    c.cyan(c.bold("║  Evymo — LLM Model Report                          ║"))
  );
  console.log(
    c.cyan(c.bold("╚══════════════════════════════════════════════════════╝"))
  );
  console.log("");

  // ── Provider Status ──
  console.log(c.bold("  Configured Providers:"));
  console.log("");
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const key = env[provider.keyEnv];
    const configured = !!key;
    const icon = configured ? c.green("✓") : c.red("✗");
    let status = configured ? c.green("configured") : c.red("not set");

    if (validate && configured) {
      const check = await validateProvider(id, key);
      status = check.ok
        ? c.green("valid ✓")
        : c.red(`invalid (${check.error || check.status})`);
    }

    const envHint = configured ? "" : c.dim(`  (set ${provider.keyEnv})`);
    console.log(`    ${icon} ${c.bold(provider.name.padEnd(20))} ${status}${envHint}`);
  }
  console.log("");

  // ── Model Catalog ──
  console.log(c.bold("  Available Models (sorted by input price):"));
  console.log("");

  const sorted = [...MODEL_CATALOG].sort(
    (a, b) => a.inputPrice - b.inputPrice || a.outputPrice - b.outputPrice
  );

  // Header
  console.log(
    c.dim(
      "    Model                  Provider     Input $/M  Output $/M  Context  Capabilities"
    )
  );
  printSeparator("─", 100);

  for (const m of sorted) {
    const providerKey = env[PROVIDERS[m.provider]?.keyEnv];
    const available = m.provider === "vllm" ? !!providerKey : !!providerKey;
    const icon = available ? " " : c.dim("○");

    const name = (available ? m.name : c.dim(m.name)).padEnd(available ? 24 : 33);
    const prov = c.dim(m.provider.padEnd(12));
    const inP = formatPrice(m.inputPrice).padStart(9);
    const outP = formatPrice(m.outputPrice).padStart(10);
    const ctx = m.ctx.padStart(7);
    const caps = formatCaps(m.caps);

    console.log(`    ${icon} ${name} ${prov} ${inP}  ${outP}  ${ctx}  ${caps}`);
  }
  console.log("");

  // Best for descriptions
  console.log(c.bold("  Model Descriptions:"));
  console.log("");
  for (const m of sorted) {
    console.log(`    ${c.bold(m.name.padEnd(24))} ${c.dim(m.bestFor)}`);
  }
  console.log("");

  // ── Current Tier Config ──
  const tiers = getCurrentTiers(env);
  console.log(c.bold("  Current Model Tier Configuration:"));
  console.log("");
  const complexityDescriptions = {
    greeting: "Pozdravy, jednoduché odpovědi",
    simple: "Krátké dotazy, FAQ",
    moderate: "Technické dotazy, kód, analýza",
    complex: "Deep analysis, debugging, multi-step",
    deep_analysis: "Architektura, rozsáhlá analýza, compliance",
  };
  for (const [complexity, model] of Object.entries(tiers)) {
    const modelInfo = MODEL_CATALOG.find((m) => m.id === model);
    const price = modelInfo
      ? `${formatPrice(modelInfo.inputPrice)}/${formatPrice(modelInfo.outputPrice)}`
      : c.dim("unknown");
    const desc = c.dim(complexityDescriptions[complexity]);
    console.log(
      `    ${complexity.padEnd(16)} → ${c.bold(model.padEnd(30))} ${price}  ${desc}`
    );
  }
  console.log("");

  // ── Tier Presets ──
  console.log(c.bold("  Available Tier Presets:"));
  console.log("");
  let presetIdx = 1;
  for (const [key, preset] of Object.entries(TIER_PRESETS)) {
    console.log(`    ${c.bold(`${presetIdx}.`)} ${c.bold(preset.name)}`);
    console.log(`       ${c.dim(preset.desc)}`);
    presetIdx++;
  }
  console.log("");

  // ── Estimated Costs ──
  console.log(c.bold("  Estimated Monthly Cost (1000 requests/day, avg 500 tokens):"));
  console.log("");
  for (const [key, preset] of Object.entries(TIER_PRESETS)) {
    // Rough estimate: 60% simple, 25% moderate, 10% complex, 5% deep
    const weights = { greeting: 0.1, simple: 0.5, moderate: 0.25, complex: 0.1, deep_analysis: 0.05 };
    let totalInput = 0;
    let totalOutput = 0;
    for (const [complexity, model] of Object.entries(preset.tiers)) {
      const info = MODEL_CATALOG.find((m) => m.id === model);
      if (!info) continue;
      const share = weights[complexity] || 0;
      // 500 input + 500 output tokens per request, 1000 requests/day, 30 days
      totalInput += (share * 1000 * 30 * 500 * info.inputPrice) / 1_000_000;
      totalOutput += (share * 1000 * 30 * 500 * info.outputPrice) / 1_000_000;
    }
    const total = totalInput + totalOutput;
    const bar = total === 0 ? c.green("FREE") : `~$${total.toFixed(2)}/month`;
    console.log(`    ${preset.name.padEnd(35)} ${bar}`);
  }
  console.log("");

  // ── Tips ──
  console.log(c.dim("  Tips:"));
  console.log(c.dim("    npm run models:check -- --validate   Validate API keys"));
  console.log(c.dim("    npm run models:wizard                Interactive model setup"));
  console.log(c.dim("    npm run models:check -- --json       Machine-readable output"));
  console.log("");
}

main().catch((err) => {
  console.error(c.red(`Error: ${err.message}`));
  process.exit(1);
});

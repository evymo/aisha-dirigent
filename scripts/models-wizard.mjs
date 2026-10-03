#!/usr/bin/env node
/**
 * models-wizard.mjs — Interactive LLM Model Configuration Wizard
 *
 * Guides users through API key setup, model discovery, and tier configuration.
 * Saves configuration to .env + .env.local for local model backends.
 *
 * @example
 *   npm run models:wizard                        # Interactive mode
 *   npm run models:wizard -- --preset cost-optimized  # Apply preset non-interactively
 *   npm run models:wizard -- --show              # Show current config only
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env");
const ENV_LOCAL_PATH = resolve(PROJECT_ROOT, ".env.local");

// ── Colors ──────────────────────────────────────────────────────────────────
const isCI = !!process.env.CI || !!process.env.NO_COLOR;
const c = {
  red: (s) => (isCI ? s : `\x1b[31m${s}\x1b[0m`),
  green: (s) => (isCI ? s : `\x1b[32m${s}\x1b[0m`),
  yellow: (s) => (isCI ? s : `\x1b[33m${s}\x1b[0m`),
  blue: (s) => (isCI ? s : `\x1b[34m${s}\x1b[0m`),
  cyan: (s) => (isCI ? s : `\x1b[36m${s}\x1b[0m`),
  dim: (s) => (isCI ? s : `\x1b[2m${s}\x1b[0m`),
  bold: (s) => (isCI ? s : `\x1b[1m${s}\x1b[0m`),
};

// ── Provider Definitions ────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    validateUrl: "https://api.openai.com/v1/models",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    models: ["gpt-5-mini", "gpt-4o-mini", "gpt-4o", "o4-mini", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    validateUrl: "https://api.anthropic.com/v1/messages",
    authHeader: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    validateMethod: "POST",
    validateBody: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    models: [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
  },
  {
    id: "google",
    name: "Google AI (Gemini)",
    keyEnv: "GOOGLE_AI_API_KEY",
    keyPrefix: "AI",
    validateUrl: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    authHeader: () => ({}),
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    keyEnv: "XAI_API_KEY",
    keyPrefix: "xai-",
    validateUrl: "https://api.x.ai/v1/models",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    models: ["grok-3", "grok-3-mini"],
  },
];

// ── Tier Presets ────────────────────────────────────────────────────────────
const TIER_PRESETS = {
  "cost-optimized": {
    name: "Cost-Optimized (recommended)",
    desc: "gpt-5-mini → gemini-2.5-flash → claude-sonnet-4",
    requires: ["openai", "google", "anthropic"],
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
    desc: "Only Google API key needed, 1M context",
    requires: ["google"],
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
    desc: "Only OpenAI API key needed",
    requires: ["openai"],
    tiers: {
      greeting: "gpt-5-mini",
      simple: "gpt-5-mini",
      moderate: "gpt-4o-mini",
      complex: "gpt-4o",
      deep_analysis: "gpt-4o",
    },
  },
  "anthropic-focused": {
    name: "Anthropic-Focused",
    desc: "Claude for everything, best coding quality",
    requires: ["anthropic"],
    tiers: {
      greeting: "claude-3-5-haiku-20241022",
      simple: "claude-3-5-haiku-20241022",
      moderate: "claude-3-5-haiku-20241022",
      complex: "claude-sonnet-4-20250514",
      deep_analysis: "claude-sonnet-4-20250514",
    },
  },
  "self-hosted": {
    name: "Self-Hosted (vLLM)",
    desc: "Zero cost, requires NVIDIA GPU with 24GB+ VRAM",
    requires: [],
    tiers: {
      greeting: "Qwen/Qwen3-30B-A3B",
      simple: "Qwen/Qwen3-30B-A3B",
      moderate: "Qwen/Qwen3-30B-A3B",
      complex: "Qwen/Qwen3-30B-A3B",
      deep_analysis: "Qwen/Qwen3-30B-A3B",
    },
  },
};

// ── ENV helpers ─────────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function updateEnvFile(path, updates) {
  if (!existsSync(path)) return false;
  let content = readFileSync(path, "utf-8");
  let changed = false;

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^(${key})=(.*)$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `$1=${value}`);
      changed = true;
    } else {
      // Append before last empty line or at end
      content = content.trimEnd() + `\n${key}=${value}\n`;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(path, content);
  }
  return changed;
}

// ── API Key Validation ──────────────────────────────────────────────────────
async function validateKey(provider, key) {
  try {
    const url =
      typeof provider.validateUrl === "function"
        ? provider.validateUrl(key)
        : provider.validateUrl;
    const resp = await fetch(url, {
      method: provider.validateMethod || "GET",
      headers: {
        "Content-Type": "application/json",
        ...provider.authHeader(key),
      },
      body: provider.validateBody || undefined,
      signal: AbortSignal.timeout(10000),
    });
    // Anthropic: 400 means key works (minimal request), only 401 = bad key
    if (provider.id === "anthropic") return resp.status !== 401;
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Main Wizard ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const presetArg = args.find((a) => a.startsWith("--preset"));
  const presetValue = presetArg
    ? args[args.indexOf(presetArg) + 1] || presetArg.split("=")[1]
    : null;
  const showOnly = args.includes("--show");

  const env = loadEnvFile(ENV_PATH);

  // ── Show current config mode ──
  if (showOnly) {
    console.log(c.bold("\n  Current LLM Configuration:\n"));
    for (const p of PROVIDERS) {
      const key = env[p.keyEnv];
      const icon = key ? c.green("✓") : c.red("✗");
      console.log(`    ${icon} ${p.name.padEnd(22)} ${key ? c.green("configured") : c.red("not set")}`);
    }
    console.log("");
    const tiers = {
      greeting: env.MODEL_TIER_GREETING || "gpt-5-mini",
      simple: env.MODEL_TIER_SIMPLE || "gpt-5-mini",
      moderate: env.MODEL_TIER_MODERATE || "gemini-2.5-flash",
      complex: env.MODEL_TIER_COMPLEX || "claude-sonnet-4-20250514",
      deep_analysis: env.MODEL_TIER_DEEP || "claude-sonnet-4-20250514",
    };
    console.log(c.bold("  Model Tiers:"));
    for (const [k, v] of Object.entries(tiers)) {
      console.log(`    ${k.padEnd(16)} → ${c.bold(v)}`);
    }
    console.log("");
    return;
  }

  // ── Non-interactive preset mode ──
  if (presetValue) {
    const preset = TIER_PRESETS[presetValue];
    if (!preset) {
      console.error(c.red(`Unknown preset: ${presetValue}`));
      console.error(`Available: ${Object.keys(TIER_PRESETS).join(", ")}`);
      process.exit(1);
    }
    applyPreset(preset, env);
    return;
  }

  // ── Interactive mode ──
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log(
    c.cyan(c.bold("╔══════════════════════════════════════════════════════╗"))
  );
  console.log(
    c.cyan(c.bold("║  Evymo — LLM Model Configuration Wizard             ║"))
  );
  console.log(
    c.cyan(c.bold("╚══════════════════════════════════════════════════════╝"))
  );
  console.log("");
  console.log(
    c.dim("  This wizard helps you configure which LLM models AISHA uses.")
  );
  console.log(
    c.dim("  You can re-run it anytime: npm run models:wizard")
  );
  console.log("");

  // ── Step 1: Check API Keys ──
  console.log(c.bold("  Step 1: API Keys\n"));

  const configuredProviders = [];
  for (const provider of PROVIDERS) {
    const currentKey = env[provider.keyEnv];
    if (currentKey) {
      process.stdout.write(
        `    ${c.green("✓")} ${provider.name.padEnd(22)} configured — validating... `
      );
      const valid = await validateKey(provider, currentKey);
      if (valid) {
        console.log(c.green("valid ✓"));
        configuredProviders.push(provider.id);
      } else {
        console.log(c.red("invalid ✗"));
        const answer = await rl.question(
          `      Enter new ${provider.keyEnv} (or press Enter to skip): `
        );
        if (answer.trim()) {
          env[provider.keyEnv] = answer.trim();
          const recheck = await validateKey(provider, answer.trim());
          if (recheck) {
            console.log(`      ${c.green("✓")} Key validated`);
            configuredProviders.push(provider.id);
          } else {
            console.log(`      ${c.yellow("⚠")} Key validation failed — saving anyway`);
            configuredProviders.push(provider.id);
          }
        }
      }
    } else {
      console.log(
        `    ${c.red("✗")} ${provider.name.padEnd(22)} ${c.dim("not set")}`
      );
      const answer = await rl.question(
        `      Enter ${provider.keyEnv} (or press Enter to skip): `
      );
      if (answer.trim()) {
        env[provider.keyEnv] = answer.trim();
        process.stdout.write(`      Validating... `);
        const valid = await validateKey(provider, answer.trim());
        console.log(valid ? c.green("valid ✓") : c.yellow("⚠ could not validate"));
        configuredProviders.push(provider.id);
      }
    }
  }

  console.log("");
  if (configuredProviders.length === 0) {
    console.log(
      c.yellow("  ⚠ No providers configured. AISHA will use self-hosted vLLM or cached responses.")
    );
    console.log(
      c.dim("    You can add API keys later in .env and re-run this wizard.\n")
    );
  } else {
    console.log(
      `  ${c.green("✓")} Configured providers: ${configuredProviders.map((p) => c.bold(p)).join(", ")}\n`
    );
  }

  // ── Step 2: Choose Tier Strategy ──
  console.log(c.bold("  Step 2: Model Tier Strategy\n"));
  console.log(c.dim("  AISHA selects the cheapest sufficient model for each query complexity:"));
  console.log(c.dim("    greeting/simple → cheapest (basic Q&A)"));
  console.log(c.dim("    moderate → mid-tier (code, technical)"));
  console.log(c.dim("    complex/deep → premium (architecture, deep analysis)\n"));

  // Filter presets to those the user can actually use
  const availablePresets = Object.entries(TIER_PRESETS).filter(([, preset]) =>
    preset.requires.every((r) => configuredProviders.includes(r))
  );

  if (availablePresets.length === 0) {
    console.log(c.yellow("  No presets available for your configured providers."));
    console.log(c.dim("  Using self-hosted preset.\n"));
    applyPreset(TIER_PRESETS["self-hosted"], env);
    rl.close();
    return;
  }

  console.log(c.bold("  Choose a strategy:\n"));
  availablePresets.forEach(([key, preset], idx) => {
    console.log(`    ${c.bold(`${idx + 1}.`)} ${preset.name}`);
    console.log(`       ${c.dim(preset.desc)}`);
    const tierSummary = Object.entries(preset.tiers)
      .filter(([k]) => ["simple", "moderate", "complex"].includes(k))
      .map(([k, v]) => `${k}→${v}`)
      .join(", ");
    console.log(`       ${c.dim(tierSummary)}`);
    console.log("");
  });

  const defaultChoice = configuredProviders.includes("openai") &&
    configuredProviders.includes("google") &&
    configuredProviders.includes("anthropic")
    ? "1"
    : "1";

  const choice = await rl.question(
    `  Choose [1-${availablePresets.length}] (default: ${defaultChoice}): `
  );

  const choiceIdx = parseInt(choice || defaultChoice, 10) - 1;
  if (choiceIdx < 0 || choiceIdx >= availablePresets.length) {
    console.log(c.yellow("  Invalid choice, using default."));
  }
  const selectedPreset =
    availablePresets[Math.max(0, Math.min(choiceIdx, availablePresets.length - 1))];

  console.log(
    `\n  ${c.green("✓")} Selected: ${c.bold(selectedPreset[1].name)}\n`
  );

  // ── Step 3: Apply & Save ──
  applyPreset(selectedPreset[1], env);

  rl.close();
}

// ── Apply Preset & Save ─────────────────────────────────────────────────────
function applyPreset(preset, env) {
  const tierEnvMap = {
    greeting: "MODEL_TIER_GREETING",
    simple: "MODEL_TIER_SIMPLE",
    moderate: "MODEL_TIER_MODERATE",
    complex: "MODEL_TIER_COMPLEX",
    deep_analysis: "MODEL_TIER_DEEP",
  };

  const updates = {};

  // API keys
  for (const p of PROVIDERS) {
    if (env[p.keyEnv] && env[p.keyEnv] !== loadEnvFile(ENV_PATH)[p.keyEnv]) {
      updates[p.keyEnv] = env[p.keyEnv];
    }
  }

  // Model tiers
  for (const [complexity, envKey] of Object.entries(tierEnvMap)) {
    updates[envKey] = preset.tiers[complexity];
  }

  // Save to .env
  if (existsSync(ENV_PATH)) {
    updateEnvFile(ENV_PATH, updates);
    console.log(`  ${c.green("✓")} Updated ${c.dim(".env")}`);
  }

  // Save to .env.local (tier vars + API keys)
  if (existsSync(ENV_LOCAL_PATH)) {
    const localUpdates = { ...updates };
    // Remove non-LLM keys from local updates
    for (const key of Object.keys(localUpdates)) {
      if (
        !key.startsWith("MODEL_TIER_") &&
        !["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"].includes(key)
      ) {
        delete localUpdates[key];
      }
    }
    updateEnvFile(ENV_LOCAL_PATH, localUpdates);
    console.log(`  ${c.green("✓")} Updated ${c.dim(".env.local")}`);
  }

  // Print summary
  console.log("");
  console.log(c.bold("  Applied Configuration:"));
  console.log("");
  for (const [complexity, model] of Object.entries(preset.tiers)) {
    console.log(`    ${complexity.padEnd(16)} → ${c.bold(model)}`);
  }
  console.log("");
  console.log(c.dim("  Models are selected per-message by selectOptimalModel()."));
  console.log(c.dim("  ai_model_registry (DB) takes priority over these defaults."));
  console.log(c.dim("  Restart edge functions to apply: npx supabase functions serve"));
  console.log("");
}

main().catch((err) => {
  console.error(c.red(`Error: ${err.message}`));
  process.exit(1);
});

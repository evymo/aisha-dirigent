#!/usr/bin/env node
/**
 * AISHA Interactive Chat — Debug & Observability Console
 *
 * Interaktivní terminálová konzole pro komunikaci s AISHA chat edge function.
 * Posílá zprávy s `debug: true` a vizualizuje rozhodovací proces:
 *
 *   - Routing (classify → specialist → main_agent → simplicity)
 *   - Model selection (complexity analysis, tier, reason)
 *   - Agent pipeline (workflow nodes executed)
 *   - AISHA orchestration (route plan, context enrichment, escalation)
 *   - Tool usage (iterations, specs available)
 *   - Token usage & timing
 *   - Debug events (full pipeline trace)
 *
 * Usage:
 *   npm run aisha:chat:interactive                    # Lokální Supabase
 *   npm run aisha:chat:interactive -- --prod          # Produkce
 *   npm run aisha:chat:interactive -- --raw           # Raw JSON response
 *   npm run aisha:chat:interactive -- --lang en       # English messages
 *   npm run aisha:chat:interactive -- --no-color      # Bez ANSI barev
 *
 * Commands v konzoli:
 *   /new        — Nová konverzace (nové conversation_id)
 *   /history    — Zobrazí historii aktuální konverzace
 *   /last       — Zobrazí poslední raw response
 *   /debug      — Toggle debug mode on/off
 *   /raw        — Toggle raw JSON output
 *   /quit       — Ukončí program
 *
 * @module
 */

import { createClient } from "./lib/aisha-chat-client.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { SUPABASE_LOCAL_URL } from './lib/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── CLI flags ───────────────────────────────────────────────────────────

const IS_PROD = process.argv.includes("--prod");
const NO_COLOR = process.argv.includes("--no-color");
let SHOW_RAW = process.argv.includes("--raw");
let DEBUG_MODE = true;
const LANG = (() => {
  const idx = process.argv.indexOf("--lang");
  return idx >= 0 ? process.argv[idx + 1] : "cs";
})();

// ─── Colors ──────────────────────────────────────────────────────────────

const c = NO_COLOR
  ? { reset: "", dim: "", bold: "", red: "", green: "", yellow: "", blue: "", cyan: "", magenta: "", gray: "" }
  : {
      reset: "\x1b[0m",
      dim: "\x1b[2m",
      bold: "\x1b[1m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      cyan: "\x1b[36m",
      magenta: "\x1b[35m",
      gray: "\x1b[90m",
    };

// ─── Configuration ───────────────────────────────────────────────────────

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const dotEnv = loadEnvFile(join(ROOT, ".env"));
const dotEnvLocal = loadEnvFile(join(ROOT, ".env.local"));

const LOCAL_URL = SUPABASE_LOCAL_URL;
const LOCAL_ANON_KEY =
  process.env.VITE_AISHA_POSTGREST_ANON_KEY || "";

const AISHA_POSTGREST_URL = IS_PROD
  ? process.env.VITE_AISHA_GATEWAY_URL || dotEnv.VITE_AISHA_GATEWAY_URL || dotEnvLocal.VITE_AISHA_GATEWAY_URL
  : process.env.VITE_AISHA_GATEWAY_URL || LOCAL_URL;

const AISHA_POSTGREST_ANON_KEY = IS_PROD
  ? process.env.VITE_AISHA_GATEWAY_KEY || dotEnv.VITE_AISHA_GATEWAY_KEY || dotEnvLocal.VITE_AISHA_GATEWAY_KEY
  : process.env.VITE_AISHA_GATEWAY_KEY || LOCAL_ANON_KEY;

const TEST_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@platform.app";
const TEST_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Admin123!";

const AISHA_POSTGREST_SERVICE_KEY = IS_PROD
  ? process.env.AISHA_POSTGREST_SERVICE_KEY || dotEnv.AISHA_POSTGREST_SERVICE_KEY || dotEnvLocal.AISHA_POSTGREST_SERVICE_KEY
  : process.env.AISHA_POSTGREST_SERVICE_KEY || null;

if (!AISHA_POSTGREST_URL || !AISHA_POSTGREST_ANON_KEY) {
  console.error("Missing AISHA_POSTGREST_URL or AISHA_POSTGREST_ANON_KEY");
  process.exit(1);
}

// ─── State ───────────────────────────────────────────────────────────────

let conversationId = null;
let accessToken = null;
let lastResponse = null;
let turnCount = 0;
let _ephemeralUserId = null;
let _adminClient = null;

// ─── Supabase client ─────────────────────────────────────────────────────

const supabase = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_ANON_KEY);

// ─── Auth ────────────────────────────────────────────────────────────────

async function authenticate() {
  // For --prod with service_role_key: create ephemeral admin test user
  if (IS_PROD && AISHA_POSTGREST_SERVICE_KEY) {
    console.log(`\n${c.cyan}Creating ephemeral admin user for debug session...${c.reset}`);

    _adminClient = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const ephemeralEmail = `aisha-debug-${Date.now()}@evymo-test.local`;
    const ephemeralPassword = `AishaDbg!${Math.random().toString(36).slice(2, 10)}`;

    const { data: created, error: createErr } = await _adminClient.auth.admin.createUser({
      email: ephemeralEmail,
      password: ephemeralPassword,
      email_confirm: true,
      user_metadata: { display_name: "AISHA Debug Console" },
      app_metadata: { role: "admin" },
    });

    if (createErr || !created?.user) {
      console.error(`${c.red}Failed to create ephemeral user: ${createErr?.message ?? "no user"}${c.reset}`);
      process.exit(1);
    }

    _ephemeralUserId = created.user.id;
    console.log(`  ${c.dim}user_id: ${_ephemeralUserId}${c.reset}`);

    // Assign admin role in user_roles table
    const { error: roleErr } = await _adminClient
      .from("user_roles")
      .insert({ user_id: _ephemeralUserId, role: "admin" });
    if (roleErr) {
      console.log(`  ${c.yellow}role insert: ${roleErr.message}${c.reset}`);
    }

    // Seed membership
    const { error: membershipErr } = await _adminClient
      .from("memberships")
      .insert({ user_id: _ephemeralUserId, tier: "basic", status: "active" });
    if (membershipErr) {
      console.log(`  ${c.yellow}membership: ${membershipErr.message}${c.reset}`);
    }

    // Sign in as the new user
    const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({
      email: ephemeralEmail,
      password: ephemeralPassword,
    });

    if (signErr || !signIn.session) {
      console.error(`${c.red}Auth failed: ${signErr?.message ?? "No session"}${c.reset}`);
      process.exit(1);
    }

    accessToken = signIn.session.access_token;

    // Grant consent
    const authedClient = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { error: consentErr } = await authedClient.rpc("grant_consent", { p_consent_type: "data_processing" });
    if (consentErr) {
      console.log(`  ${c.yellow}consent: ${consentErr.message}${c.reset}`);
    }

    console.log(`${c.green}Authenticated as ephemeral admin.${c.reset} ${c.dim}(debug events enabled)${c.reset}`);
    return;
  }

  // Local / fallback: use config test user
  console.log(`\n${c.cyan}Authenticating as ${TEST_EMAIL}...${c.reset}`);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error) {
    console.error(`${c.red}Auth failed: ${error.message}${c.reset}`);
    process.exit(1);
  }

  accessToken = data.session.access_token;
  const userId = data.user.id;
  console.log(`${c.green}Authenticated.${c.reset} user_id=${c.dim}${userId}${c.reset}`);
}

async function cleanup() {
  if (_ephemeralUserId && _adminClient) {
    try {
      await _adminClient.auth.admin.deleteUser(_ephemeralUserId);
    } catch {
      // Non-blocking
    }
  }
}

// ─── Chat API call ───────────────────────────────────────────────────────

async function sendMessage(message) {
  const url = `${AISHA_POSTGREST_URL}/functions/v1/ai-chat`;

  const body = {
    message,
    language: LANG,
    debug: DEBUG_MODE,
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const startTime = Date.now();

  const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    const text = await response.text();
    return { error: true, status: response.status, body: text, elapsed };
  }

  const json = await response.json();
  lastResponse = json;

  // Track conversation
  if (json.conversation_id && !conversationId) {
    conversationId = json.conversation_id;
  }
  turnCount++;

  return { error: false, data: json, elapsed };
}

// ─── Display helpers ─────────────────────────────────────────────────────

function printSeparator(label) {
  const line = "─".repeat(60);
  console.log(`\n${c.dim}${line}${c.reset}`);
  if (label) console.log(`${c.bold}${c.cyan} ${label}${c.reset}`);
}

function printKV(key, value, color = c.reset) {
  if (value === undefined || value === null) return;
  console.log(`  ${c.dim}${key}:${c.reset} ${color}${value}${c.reset}`);
}

function printDebugEvents(events) {
  if (!events || events.length === 0) return;

  printSeparator("PIPELINE DEBUG EVENTS");

  // Group by stage prefix
  const stageColors = {
    auth: c.green,
    request: c.blue,
    access: c.cyan,
    guardrails: c.yellow,
    pii: c.magenta,
    conversation: c.blue,
    history: c.dim,
    message: c.green,
    aisha: c.magenta,
    agents: c.cyan,
    tools: c.yellow,
    memory: c.blue,
    workflow: c.cyan,
    context: c.green,
    model: c.yellow,
    engine: c.bold,
    output: c.green,
    eval: c.dim,
    response: c.green,
    handler: c.red,
  };

  for (const evt of events) {
    const stagePrefix = (evt.stage || "").split(".")[0];
    const color = stageColors[stagePrefix] || c.reset;
    const level = evt.level === "error" ? `${c.red}ERR` : evt.level === "warn" ? `${c.yellow}WRN` : `${c.dim}INF`;
    const ts = evt.timestamp ? `${c.gray}${new Date(evt.timestamp).toISOString().slice(11, 23)}${c.reset} ` : "";
    console.log(`  ${ts}${level}${c.reset} ${color}[${evt.stage}]${c.reset} ${evt.message}`);
  }
}

function printModelSelection(metadata) {
  if (!metadata) return;

  printSeparator("MODEL SELECTION (Smart Routing)");

  const model = metadata.aisha_model_selected;
  const complexity = metadata.aisha_model_complexity;
  const reason = metadata.aisha_model_reason;

  if (model) {
    const modelColor = model.includes("gpt-5") ? c.magenta
      : model.includes("gpt-4o") ? c.yellow
      : model.includes("gpt-4") ? c.cyan
      : model.includes("gemini") ? c.blue
      : model.includes("claude") ? c.green
      : c.reset;

    printKV("Model", model, modelColor);
    printKV("Complexity", complexity, c.yellow);
    printKV("Reason", reason, c.dim);
  }
}

function printWorkflowInfo(metadata) {
  if (!metadata) return;

  printSeparator("WORKFLOW EXECUTION");

  printKV("Workflow", metadata.workflow_name);
  printKV("Workflow ID", metadata.workflow_id, c.dim);
  printKV("Agent", metadata.agent_name, c.cyan);
  printKV("Specialist", metadata.specialist_used, c.magenta);
  printKV("Category", lastResponse?.message?.routing_category, c.yellow);
}

function printTokensAndTiming(metadata, elapsed) {
  printSeparator("PERFORMANCE");

  printKV("Response time (client)", `${elapsed}ms`, elapsed > 10000 ? c.red : elapsed > 5000 ? c.yellow : c.green);
  if (metadata?.response_time_ms) {
    printKV("Response time (server)", `${metadata.response_time_ms}ms`, c.dim);
  }
  printKV("Tokens used", metadata?.tokens_used, c.cyan);
  printKV("Tools available", metadata?.tools_available);
  printKV("Tool iterations", metadata?.tool_iterations);
}

function printAishaOrchestration(metadata) {
  if (!metadata) return;

  const hasOrch = metadata.aisha_run_id || metadata.aisha_participation_hint;
  if (!hasOrch) return;

  printSeparator("AISHA ORCHESTRATION");

  printKV("Run ID", metadata.aisha_run_id, c.dim);
  printKV("Participation hint", metadata.aisha_participation_hint ? "YES" : "no",
    metadata.aisha_participation_hint ? c.magenta : c.dim);
}

function printResponse(result) {
  if (result.error) {
    printSeparator("ERROR");
    console.log(`  ${c.red}HTTP ${result.status}${c.reset}`);
    try {
      const parsed = JSON.parse(result.body);
      console.log(`  ${c.red}${parsed.error || JSON.stringify(parsed)}${c.reset}`);
    } catch {
      console.log(`  ${c.red}${result.body?.substring(0, 500)}${c.reset}`);
    }
    console.log(`  ${c.dim}Elapsed: ${result.elapsed}ms${c.reset}`);
    return;
  }

  const { data, elapsed } = result;
  const meta = data.metadata || {};
  const msg = data.message || {};

  if (SHOW_RAW) {
    printSeparator("RAW RESPONSE");
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // 1. Workflow info
  printWorkflowInfo(meta);

  // 2. Model selection
  printModelSelection(meta);

  // 3. AISHA orchestration
  printAishaOrchestration(meta);

  // 4. Tokens & timing
  printTokensAndTiming(meta, elapsed);

  // 5. Debug events (pipeline trace)
  if (data.debug) {
    printDebugEvents(data.debug);
  }

  // 6. AISHA response
  printSeparator("AISHA RESPONSE");
  console.log(`  ${c.dim}conversation_id: ${data.conversation_id}${c.reset}`);
  console.log(`  ${c.dim}message_id: ${msg.id}${c.reset}`);
  console.log(`  ${c.dim}category: ${msg.routing_category || "—"}${c.reset}`);
  console.log();

  // Word-wrap the response
  const content = msg.content || "(empty response)";
  const maxWidth = process.stdout.columns ? Math.min(process.stdout.columns - 4, 100) : 100;
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.length <= maxWidth) {
      console.log(`  ${line}`);
    } else {
      // Soft wrap
      let remaining = line;
      while (remaining.length > 0) {
        console.log(`  ${remaining.substring(0, maxWidth)}`);
        remaining = remaining.substring(maxWidth);
      }
    }
  }

  // 7. Aisha observing flag
  if (data.aisha_observing) {
    console.log(`\n  ${c.magenta}[AISHA is observing this conversation via Realtime]${c.reset}`);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────

async function handleCommand(input) {
  const cmd = input.trim().toLowerCase();

  if (cmd === "/new") {
    conversationId = null;
    turnCount = 0;
    console.log(`${c.cyan}New conversation started.${c.reset}`);
    return true;
  }

  if (cmd === "/history" && conversationId) {
    console.log(`${c.dim}conversation_id: ${conversationId}, turns: ${turnCount}${c.reset}`);
    return true;
  }

  if (cmd === "/last") {
    if (lastResponse) {
      console.log(JSON.stringify(lastResponse, null, 2));
    } else {
      console.log(`${c.dim}No previous response.${c.reset}`);
    }
    return true;
  }

  if (cmd === "/debug") {
    DEBUG_MODE = !DEBUG_MODE;
    console.log(`${c.cyan}Debug mode: ${DEBUG_MODE ? "ON" : "OFF"}${c.reset}`);
    return true;
  }

  if (cmd === "/raw") {
    SHOW_RAW = !SHOW_RAW;
    console.log(`${c.cyan}Raw output: ${SHOW_RAW ? "ON" : "OFF"}${c.reset}`);
    return true;
  }

  if (cmd === "/quit" || cmd === "/exit" || cmd === "/q") {
    console.log(`\n${c.dim}Cleaning up...${c.reset}`);
    await cleanup();
    console.log(`${c.dim}Bye.${c.reset}`);
    process.exit(0);
  }

  if (cmd === "/help" || cmd === "/?") {
    console.log(`
${c.bold}Commands:${c.reset}
  ${c.cyan}/new${c.reset}      — Start new conversation
  ${c.cyan}/history${c.reset}  — Show conversation info
  ${c.cyan}/last${c.reset}     — Show last raw JSON response
  ${c.cyan}/debug${c.reset}    — Toggle debug events (currently: ${DEBUG_MODE ? "ON" : "OFF"})
  ${c.cyan}/raw${c.reset}      — Toggle raw JSON output (currently: ${SHOW_RAW ? "ON" : "OFF"})
  ${c.cyan}/quit${c.reset}     — Exit
`);
    return true;
  }

  return false;
}

// ─── Main REPL ───────────────────────────────────────────────────────────

function askLine(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

async function main() {
  console.log(`
${c.bold}${c.magenta}╔══════════════════════════════════════════════════════════╗
║        AISHA Interactive Chat — Debug Console            ║
╚══════════════════════════════════════════════════════════╝${c.reset}

${c.dim}Target:${c.reset}  ${AISHA_POSTGREST_URL} ${IS_PROD ? `${c.red}[PRODUCTION]${c.reset}` : `${c.green}[LOCAL]${c.reset}`}
${c.dim}Debug:${c.reset}   ${DEBUG_MODE ? "ON" : "OFF"}
${c.dim}Lang:${c.reset}    ${LANG}

${c.dim}Type a message to chat with AISHA.
Type /help for commands, /quit to exit.${c.reset}
`);

  await authenticate();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptStr = `\n${c.green}you>${c.reset} `;

  // Sequential question-based REPL (waits for each response before next prompt)
  while (true) {
    let input;
    try {
      input = await askLine(rl, promptStr);
    } catch (err) {
      // EOF on stdin (Ctrl-D or pipe closed) — graceful exit of the REPL.
      // Log at info level so users can disambiguate "I hit Ctrl-D" from a real hang.
      console.info("[aisha-chat] stdin closed, exiting REPL:", err?.message ?? err);
      break;
    }

    input = input.trim();
    if (!input) continue;

    // Handle commands
    if (input.startsWith("/")) {
      const handled = await handleCommand(input);
      if (handled) continue;
    }

    // Send message
    console.log(`\n${c.dim}Sending to AISHA... (debug=${DEBUG_MODE})${c.reset}`);

    try {
      const result = await sendMessage(input);
      printResponse(result);
    } catch (err) {
      console.error(`\n${c.red}Network error: ${err.message}${c.reset}`);
    }
  }

  console.log(`\n${c.dim}Cleaning up...${c.reset}`);
  await cleanup();
  console.log(`${c.dim}Bye.${c.reset}`);
  rl.close();
}

main().catch(async (err) => {
  console.error(`Fatal: ${err.message}`);
  await cleanup();
  process.exit(1);
});

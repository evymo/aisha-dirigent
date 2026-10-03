/**
 * Helpers for invoking the .claude/* overlay from the host (via `docker exec`
 * when containerized, or directly when running locally).
 *
 * Why no node-pty: the overlay's contract is env-in / stdout+stderr-out /
 * exit-code-out. Plain spawn() captures all of that. node-pty would only
 * matter if we were driving the real `claude-code` CLI's interactive REPL.
 */

import { spawn, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKSPACE_ROOT = resolve(__dirname, "../workspace-fixture");

// HOST URL: how the test runner (on the host) talks to mock-backend.
// Default 127.0.0.1:3030 (compose publishes the port).
const MOCK_BACKEND_URL = process.env.MOCK_BACKEND_URL ?? "http://127.0.0.1:3030";

const USE_CONTAINER = process.env.E2E_USE_CONTAINER === "1";
const CONTAINER_NAME = process.env.E2E_CLAUDE_CLI_CONTAINER ?? "e2e-claude-cli";

// INTERNAL URL: how the relay (running inside claude-cli container) talks
// to mock-backend. Uses docker-compose service name on the bridge network.
// Local mode uses the same host URL.
const RELAY_BACKEND_URL = USE_CONTAINER
  ? (process.env.E2E_RELAY_BACKEND_URL ?? "http://mock-backend:3030")
  : MOCK_BACKEND_URL;

/**
 * Run a hook script with the given tool input JSON. Returns
 * { stdout, stderr, code }.
 *
 * When E2E_USE_CONTAINER=1, executes via `docker exec` so the test runs
 * inside the actual Linux container (CI parity).
 */
export async function runHook(hookRelPath, toolInput, env = {}) {
  const envBlock = {
    CLAUDE_HOOK_TOOL_INPUT: JSON.stringify(toolInput),
    CLAUDE_PROJECT_DIR: USE_CONTAINER ? "/workspace" : WORKSPACE_ROOT,
    AISHA_GATEWAY_URL: env.AISHA_GATEWAY_URL ?? RELAY_BACKEND_URL,
    AISHA_MCP_TOKEN: env.AISHA_MCP_TOKEN ?? "test-token-e2e",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    ...env,
  };

  if (USE_CONTAINER) {
    const envArgs = Object.entries(envBlock).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const args = ["exec", ...envArgs, CONTAINER_NAME, "bash", `/workspace/.claude/${hookRelPath}`];
    return spawnAndCapture("docker", args);
  }

  // Local: run hook with bash directly, working dir = workspace fixture
  return spawnAndCapture("bash", [`${WORKSPACE_ROOT}/.claude/${hookRelPath}`], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, ...envBlock },
  });
}

/**
 * Run a node-based hook (e.g. aisha-supervisor-relay.mjs) under the same
 * conventions.
 */
export async function runNodeHook(hookRelPath, event, env = {}) {
  const envBlock = {
    CLAUDE_PROJECT_DIR: USE_CONTAINER ? "/workspace" : WORKSPACE_ROOT,
    AISHA_GATEWAY_URL: env.AISHA_GATEWAY_URL ?? RELAY_BACKEND_URL,
    AISHA_MCP_TOKEN: env.AISHA_MCP_TOKEN ?? "test-token-e2e",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    ...env,
  };

  if (USE_CONTAINER) {
    const envArgs = Object.entries(envBlock).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const args = [
      "exec",
      ...envArgs,
      CONTAINER_NAME,
      "node",
      `/workspace/.claude/${hookRelPath}`,
      event,
    ];
    return spawnAndCapture("docker", args);
  }

  // Mirror Claude Code's hook invocation: the event payload arrives as JSON on
  // stdin (session_id, transcript_path, tool_input). The relay reads fd 0 first
  // and falls back to env vars when a field is absent.
  const hookInput = JSON.stringify({
    session_id: env.CLAUDE_SESSION_ID ?? "e2e-session",
    transcript_path: null,
    tool_input: {},
  });
  return spawnAndCapture("node", [`${WORKSPACE_ROOT}/.claude/${hookRelPath}`, event], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, ...envBlock },
    input: hookInput,
  });
}

function spawnAndCapture(cmd, args, opts = {}) {
  const { input, ...spawnOpts } = opts;
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectP);
    child.on("close", (code) => resolveP({ stdout, stderr, code: code ?? -1 }));
    // Claude Code delivers each hook event as a JSON object on STDIN and CLOSES
    // it. Mirror that here: write the payload (if any) and ALWAYS end stdin, so
    // hooks that read fd 0 synchronously (aisha-supervisor-relay.mjs does) get
    // EOF instead of blocking forever on an open, empty pipe.
    if (child.stdin) {
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Reset the mock-backend before a test (idempotent).
 */
export async function resetMockBackend() {
  const res = await fetch(`${MOCK_BACKEND_URL}/__test__/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`mock-backend reset → ${res.status}`);
}

export async function configureMockDispatch(event, response) {
  const res = await fetch(`${MOCK_BACKEND_URL}/__test__/configure-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, response }),
  });
  if (!res.ok) throw new Error(`mock-backend configure-dispatch → ${res.status}`);
}

export async function getMockCallLog() {
  const res = await fetch(`${MOCK_BACKEND_URL}/__test__/call-log`);
  return res.json();
}

/**
 * Clear cooldown files between tests (hooks write to /tmp/aisha-advise-*).
 * Container variant runs in container; local variant runs on host /tmp.
 */
export function clearCooldowns() {
  if (USE_CONTAINER) {
    spawnSync("docker", [
      "exec",
      CONTAINER_NAME,
      "sh",
      "-c",
      "rm -f /tmp/aisha-advise-* 2>/dev/null || true",
    ]);
  } else {
    spawnSync("sh", ["-c", "rm -f /tmp/aisha-advise-* 2>/dev/null || true"]);
  }
}

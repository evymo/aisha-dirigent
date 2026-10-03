/**
 * Verifies .claude/hooks/aisha-supervisor-relay.mjs:
 *   - POSTs to $AISHA_GATEWAY_URL/dirigent/dispatch with bearer
 *   - Prints the response's `additionalContext` on stdout (so Claude Code
 *     injects it as additional context for the session)
 *   - Exits 0 even when the backend is unreachable (fail-open)
 *   - Silently no-ops when AISHA_MCP_TOKEN is unset (cold-start parity)
 *
 * Mock backend MUST be running on $MOCK_BACKEND_URL for the happy-path
 * tests. Tests that exercise the fail-open path point at an unreachable
 * URL.
 *
 * This is the test for the user's invariant:
 *   "agent lokalne musi upozornovat a pripadne poslat i zpravu co mu
 *    prijde z backendu pokud eskalujeme"
 *
 * The relay is the channel by which a backend-pushed message reaches the
 * Claude Code session as additionalContext.
 */

import { test, before, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  runNodeHook,
  resetMockBackend,
  configureMockDispatch,
  getMockCallLog,
} from "./harness.mjs";

const MOCK_BACKEND_URL = process.env.MOCK_BACKEND_URL ?? "http://127.0.0.1:3030";

before(async () => {
  // This test requires mock-backend up; skip suite if it isn't
  try {
    const res = await fetch(`${MOCK_BACKEND_URL}/health`);
    if (!res.ok) throw new Error(`mock-backend /health → ${res.status}`);
  } catch (err) {
     
    console.log(
      `[skip] mock-backend not reachable at ${MOCK_BACKEND_URL}: ${err.message}`,
    );
    process.exit(0);
  }

  // Warm the FULL relay path before the assertions. The happy-path tests POST
  // from INSIDE the cli container, but the /health probe above only proves the
  // HOST→backend path. Under CI load the very first container→backend dispatch
  // can race a cold bridge, and the fail-open relay then prints nothing — a
  // flake unrelated to relay logic (the spec passes 5/5 locally once the bridge
  // is warm). Exercise the path once (best-effort retry) so the first real
  // assertion runs warm. No-op in local (non-container) mode.
  if (process.env.E2E_USE_CONTAINER === "1") {
    const PROBE = "__relay_warmup_ok__";
    await configureMockDispatch("session_start", { additionalContext: PROBE });
    for (let i = 0; i < 30; i++) {
      const r = await runNodeHook("hooks/aisha-supervisor-relay.mjs", "session_start");
      if (r.code === 0 && r.stdout.includes(PROBE)) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    await resetMockBackend();
  }
});

beforeEach(async () => {
  await resetMockBackend();
});

test("relay forwards SessionStart to backend and prints additionalContext", async () => {
  const ADVISORY =
    "🛡️ AISHA: Backend pushed this advisory. The agent MUST surface it to the user.";
  await configureMockDispatch("session_start", {
    additionalContext: ADVISORY,
  });

  const result = await runNodeHook("hooks/aisha-supervisor-relay.mjs", "session_start");

  assert.equal(result.code, 0, `relay exited ${result.code}, expected 0`);
  assert.ok(
    result.stdout.includes(ADVISORY),
    `stdout missing backend advisory; got:\n${result.stdout}`,
  );

  // Backend received the dispatch
  const log = await getMockCallLog();
  const dispatched = log.find((e) => e.path === "/dirigent/dispatch");
  assert.ok(dispatched, "backend received no /dirigent/dispatch call");
  assert.equal(dispatched.body.event, "session_start");
});

test("relay forwards PreToolUse with tool context", async () => {
  const ADVISORY = "Backend says: be careful with this Edit.";
  await configureMockDispatch("pre_tool", { additionalContext: ADVISORY });

  const result = await runNodeHook("hooks/aisha-supervisor-relay.mjs", "pre_tool");

  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes(ADVISORY));
});

test("relay exits 0 and prints nothing when AISHA_MCP_TOKEN is unset (cold start)", async () => {
  const result = await runNodeHook(
    "hooks/aisha-supervisor-relay.mjs",
    "session_start",
    { AISHA_MCP_TOKEN: "" }, // explicitly unset
  );

  assert.equal(result.code, 0);
  assert.equal(
    result.stdout.trim(),
    "",
    `expected silent exit but got stdout:\n${result.stdout}`,
  );
});

test("relay exits 0 (fail-open) when backend is unreachable", async () => {
  const result = await runNodeHook(
    "hooks/aisha-supervisor-relay.mjs",
    "session_start",
    { AISHA_GATEWAY_URL: "http://127.0.0.1:1" }, // refused
  );

  assert.equal(
    result.code,
    0,
    `relay must fail-open with exit 0 on backend unreachable; got ${result.code}`,
  );
  // Stdout should be empty (nothing useful from backend) but exit must be 0
});

test("relay surfaces nudges when backend stitches them into additionalContext", async () => {
  // Real backend's /dirigent/dispatch (services/svc-ai-chat/src/routes/
  // dirigent-supervisor.ts) drains nudges and includes their messages
  // inside additionalContext server-side. The relay only reads
  // additionalContext — it does NOT separately parse the `nudges` array.
  // Verify that contract here.
  const STITCHED =
    "Brief from backend.\n\n🔔 NUDGE: this is escalated, please address now.";
  await configureMockDispatch("session_start", { additionalContext: STITCHED });

  const result = await runNodeHook("hooks/aisha-supervisor-relay.mjs", "session_start");

  assert.equal(result.code, 0);
  assert.ok(
    result.stdout.includes("NUDGE: this is escalated"),
    `expected stitched nudge in stdout; got:\n${result.stdout}`,
  );
});

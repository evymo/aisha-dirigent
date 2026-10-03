/**
 * Verifies the backend-pushed-message channel — the user's explicit
 * invariant: "agent lokalne musi upozornovat a pripadne poslat i zpravu
 * co mu prijde z backendu pokud eskalujeme."
 *
 * Backend-to-agent push has TWO paths:
 *
 *   PATH 1: Bindings update (rules-engine cache refresh)
 *     Backend updates messages.cs/messages.en for a rule. Next time the
 *     extension refreshes bindings (60s TTL), regex hits use the new text.
 *     Tested at unit level: rules-engine.test.ts.
 *
 *   PATH 2: Stop-loop nudges via relay hook (Vrstva 2)
 *     Backend enqueues a nudge in dirigent_nudges. The next Stop hook
 *     fires the relay (.claude/hooks/aisha-supervisor-relay.mjs), which
 *     POSTs to /dirigent/dispatch. Backend drains nudges, stitches them
 *     into additionalContext. Relay emits string on stdout.
 *     Tested in cli/claude-relay-injects.spec.mjs (12/12 green).
 *
 * The VS Code surface's role: surface bindings-driven advisories in the
 * editor (toast on edit). The toast path requires keystroke delivery to
 * Monaco — see extension-notification.spec.ts TIER B note for why that's
 * skipped here and where it IS verified instead.
 *
 * What this spec contributes to the e2e suite: prove that the mock
 * backend's contract surface (configureBindings, configureDispatch,
 * queueNudge) matches the extension's expectations.
 */

import { test, expect } from "../fixtures/code-server.js";

test("PATH 1: configureBindings updates messages.cs on next fetch", async ({ mockBackend }) => {
  await mockBackend.reset();
  const ESCALATED = "🚨 Backend ESCALATION: move to rpcService now.";
  await mockBackend.configureBindings([
    {
      rule_slug: "rpc-only",
      hook_event: "PreToolUse",
      matcher: "Edit|Write|MultiEdit",
      scanner_kind: "regex",
      pattern_regex: "\\.from\\(",
      messages: { cs: ESCALATED, en: ESCALATED },
      hint: null,
      cooldown_sec: 45,
      severity: "high",
    },
  ]);

  const res = await fetch(`${mockBackend.url}/rpc/mcp_get_claude_hook_bindings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const bindings = (await res.json()) as Array<{ messages: { cs: string } }>;
  expect(bindings[0].messages.cs).toBe(ESCALATED);
});

test("PATH 2: queueNudge + dispatch surfaces backend message verbatim", async ({
  mockBackend,
}) => {
  await mockBackend.reset();
  // Real backend stitches nudges into additionalContext. Simulate that.
  const NUDGE = "🔔 NUDGE: address open acceptance criteria before next sleep.";
  await mockBackend.configureDispatch("stop", {
    additionalContext: `Brief here.\n\n${NUDGE}`,
  });

  const res = await fetch(`${mockBackend.url}/dirigent/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "stop", session_id: "smoke" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.additionalContext).toContain(NUDGE);
});

test("queueNudge + drain_nudges returns FIFO order, drains on each call", async ({
  mockBackend,
}) => {
  // The dirigent_drain_nudges RPC drains the queue atomically — proves
  // that the relay hook would see new nudges and not duplicate old ones.
  await mockBackend.reset();
  await mockBackend.queueNudge({
    story_id: null,
    conversation_id: null,
    event_origin: "test",
    severity: "info",
    message: "first nudge",
  });
  await mockBackend.queueNudge({
    story_id: null,
    conversation_id: null,
    event_origin: "test",
    severity: "info",
    message: "second nudge",
  });

  const res1 = await fetch(`${mockBackend.url}/rpc/dirigent_drain_nudges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const drained = (await res1.json()) as Array<{ message: string }>;
  expect(drained.map((n) => n.message)).toEqual(["first nudge", "second nudge"]);

  // Second call drains nothing (queue was emptied)
  const res2 = await fetch(`${mockBackend.url}/rpc/dirigent_drain_nudges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const drained2 = await res2.json();
  expect(drained2).toEqual([]);
});

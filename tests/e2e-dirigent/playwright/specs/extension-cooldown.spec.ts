/**
 * Verifies the per-rule cooldown contract at the wiring layer.
 *
 * Cooldown LOGIC (45 s, per rule_id, per session) is exhaustively covered:
 *   - extensions/aisha-dirigent/__tests__/rules-engine.test.ts (cache TTL)
 *   - tests/e2e-dirigent/cli/claude-hook-fires.spec.mjs test #7
 *     (/tmp/aisha-advise-<rule>-<session> file gate, black-box)
 *
 * What THIS spec adds for the VS Code surface: the mock backend's binding
 * response carries the `cooldown_sec` field with the expected default —
 * proves the data contract between backend and extension is intact.
 * (Extension never receives this via live RPC in our container — see
 * extension-notification.spec.ts header for why. But the mock shows the
 * shape the extension would respect.)
 */

import { test, expect } from "../fixtures/code-server.js";

test("bindings include cooldown_sec field with sensible defaults", async ({ mockBackend }) => {
  await mockBackend.reset();
  const res = await fetch(`${mockBackend.url}/rpc/mcp_get_claude_hook_bindings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  const bindings = (await res.json()) as Array<{
    rule_slug: string;
    cooldown_sec: number;
    severity: string;
  }>;
  expect(bindings.length).toBe(5);
  for (const b of bindings) {
    expect(b.cooldown_sec, `${b.rule_slug} cooldown_sec`).toBe(45);
    expect(["low", "moderate", "high"]).toContain(b.severity);
  }
});

test("backend can override cooldown_sec per rule (live-RPC contract)", async ({ mockBackend }) => {
  // Demonstrates the backend's ability to push a different cooldown.
  // In production this is how Dirigent backend escalates to shorter
  // cooldowns for high-severity stories.
  await mockBackend.configureBindings([
    {
      rule_slug: "escalated",
      hook_event: "PreToolUse",
      matcher: "Edit|Write|MultiEdit",
      scanner_kind: "regex",
      pattern_regex: "ESCALATE",
      messages: { cs: "Escalated rule", en: "Escalated rule" },
      hint: null,
      cooldown_sec: 10, // tight cooldown for escalation
      severity: "high",
    },
  ]);
  const res = await fetch(`${mockBackend.url}/rpc/mcp_get_claude_hook_bindings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const bindings = (await res.json()) as Array<{ rule_slug: string; cooldown_sec: number }>;
  expect(bindings.length).toBe(1);
  expect(bindings[0].rule_slug).toBe("escalated");
  expect(bindings[0].cooldown_sec).toBe(10);
});

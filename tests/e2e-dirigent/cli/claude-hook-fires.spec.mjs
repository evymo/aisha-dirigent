/**
 * Verifies .claude/hooks/aisha-advise-*.sh fire on positive samples,
 * stay silent on negative samples, and respect cooldown.
 *
 * Runs as `node --test` (Node built-in test runner — no extra deps).
 *
 * Local mode: hooks run on host bash (your dev machine).
 * Container mode (E2E_USE_CONTAINER=1): hooks run via `docker exec`
 * inside the claude-cli container — CI parity.
 */

import { test, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { runHook, clearCooldowns, resetMockBackend } from "./harness.mjs";

before(async () => {
  // Best-effort: mock-backend may not be running for hook-only tests
  try {
    await resetMockBackend();
  } catch {
    /* hook-side tests don't depend on mock-backend */
  }
});

beforeEach(() => {
  clearCooldowns();
});

test("aisha-advise-rpc.sh fires on .from() positive sample", async () => {
  const result = await runHook("hooks/aisha-advise-rpc.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: 'const data = await apiClient.from("users").select("id");',
  });

  // Advisory-only invariant: exit 0
  assert.equal(result.code, 0, `hook exited ${result.code}, expected 0`);

  // Message must appear on stdout (Claude Code captures stdout as advisory)
  assert.match(
    result.stdout,
    /rpc-only|RPC-Only|rpcUser|rpcService|\.from\(\)/i,
    `stdout did not contain rpc-only advisory; got:\n${result.stdout}`,
  );
});

test("aisha-advise-rpc.sh stays silent on negative sample", async () => {
  const result = await runHook("hooks/aisha-advise-rpc.sh", {
    tool_name: "Edit",
    file_path: "src/clean.ts",
    new_string: 'const data = await rpcUser<User[]>("list_users", {});',
  });

  assert.equal(result.code, 0);
  // No advisory text expected — stdout should be empty (or only contain
  // diagnostic noise, not the rule message)
  assert.doesNotMatch(
    result.stdout,
    /rpc-only|RPC-Only/i,
    `unexpected advisory on clean code; got:\n${result.stdout}`,
  );
});

test("aisha-advise-console.sh fires on console.log", async () => {
  const result = await runHook("hooks/aisha-advise-console.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: 'console.log("debug");',
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /console|safeError|hygien/i);
});

test("aisha-advise-select-star.sh fires on .select('*')", async () => {
  const result = await runHook("hooks/aisha-advise-select-star.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: '.select("*")',
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /select|\*|sloupc|column/i);
});

test("aisha-advise-any.sh fires on : any", async () => {
  const result = await runHook("hooks/aisha-advise-any.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: "const x: any = foo();",
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /any|unknown|typ/i);
});

test("aisha-advise-ts-ignore.sh fires on @ts-ignore", async () => {
  const result = await runHook("hooks/aisha-advise-ts-ignore.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: "// @ts-ignore\nconst x = foo();",
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /@ts-ignore|@ts-expect-error/i);
});

test("cooldown: same rule does not refire within 45s window", async () => {
  // rpc-only pattern requires `.from(...).select|insert|update|delete|upsert`
  // First fire
  const r1 = await runHook("hooks/aisha-advise-rpc.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: 'apiClient.from("a").select("id")',
  });
  assert.equal(r1.code, 0);
  assert.match(r1.stdout, /rpc/i);

  // Immediately again — should be silent due to cooldown
  const r2 = await runHook("hooks/aisha-advise-rpc.sh", {
    tool_name: "Edit",
    file_path: "src/violation.ts",
    new_string: 'apiClient.from("b").select("id")',
  });
  assert.equal(r2.code, 0);
  // Cooldown gate: stdout should NOT contain the advisory again
  assert.doesNotMatch(
    r2.stdout,
    /RPC-Only|rpcUser|rpcService/i,
    `cooldown did not gate second fire; got:\n${r2.stdout}`,
  );
});

after(() => {
  clearCooldowns();
});

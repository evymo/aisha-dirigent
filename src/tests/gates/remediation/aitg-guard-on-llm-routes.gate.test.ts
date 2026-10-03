/**
 * REMEDIATION GATE — SEC-03: AITG guard on every LLM-dispatching route.
 *
 * CONTRACT
 * --------
 * Every route file under `services/svc-ai-chat/src/routes/*.ts` that dispatches
 * an LLM call — i.e. imports `unifiedChat` / `unifiedChatStream` (or a bare
 * `dispatch`) from the canonical `../lib/llmRouter` or from
 * `@aisha/llm-dispatch` — MUST also import an OWASP AITG output guard, either
 * from the shared package `@aisha/aitg` (`withAitgGuard` /
 * `withAitgGuardOrRefuse` / `createAitgRunner`) or from a local `aitg` wrapper.
 *
 * The AITG guard is what runs raw model output through AITG-APP-01 (prompt
 * injection bleed-through) + AITG-APP-12 (toxic output) before the response
 * leaves the service. A route that reaches the model without ever importing a
 * guard is an ungoverned LLM egress — a security regression.
 *
 * KNOWN-RED (the reason this gate exists): `v1-chat.ts` and `generate.ts`
 * import `unifiedChat*` but have ZERO aitg import, while `chat.ts`,
 * `public-chat.ts` and `lab-recommendation.ts` correctly wire the guard.
 *
 * This is a PATTERN gate: it scans the whole routes directory so it also
 * catches any sibling route that regresses the same way.
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/aitg-guard-on-llm-routes.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(
  process.cwd(),
  "services/svc-ai-chat/src/routes",
);

/**
 * Routes that are PROVEN not to reach an LLM but might trip a naive regex.
 * Keep this EMPTY unless a route provably dispatches no model call — the whole
 * point of the gate is to flag ungoverned egress, not to be silenced.
 */
const ALLOWLIST = new Set<string>([]);

/** Detects an LLM-dispatch import: `unifiedChat` / `unifiedChatStream` (named
 * import) or a bare `dispatch` imported from the canonical router / dispatch
 * package. We look at IMPORTS (not prose) so comments mentioning "dispatch"
 * don't create false positives. */
function importsLlmDispatch(src: string): boolean {
  // Named import of unifiedChat / unifiedChatStream from anywhere.
  const namedDispatch =
    /import\s+[^;]*\b(unifiedChat|unifiedChatStream)\b[^;]*from\s+['"][^'"]+['"]/s;
  // `dispatch` imported specifically from llmRouter or @aisha/llm-dispatch.
  const bareDispatchFromRouter =
    /import\s+[^;]*\bdispatch\b[^;]*from\s+['"](?:[^'"]*lib\/llmRouter[^'"]*|@aisha\/llm-dispatch)['"]/s;
  return namedDispatch.test(src) || bareDispatchFromRouter.test(src);
}

/** Detects an AITG guard import from the shared package or a local aitg wrapper. */
function importsAitgGuard(src: string): boolean {
  const fromAitgPkg = /import\s+[^;]*from\s+['"]@aisha\/aitg['"]/s;
  const fromLocalAitg =
    /import\s+[^;]*from\s+['"][^'"]*\baitg[^'"]*['"]/is;
  const namedGuard =
    /import\s+[^;]*\b(withAitgGuard|withAitgGuardOrRefuse|createAitgRunner)\b/s;
  return fromAitgPkg.test(src) || fromLocalAitg.test(src) || namedGuard.test(src);
}

describe("SEC-03 — AITG guard on every LLM-dispatching route", () => {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();

  it("routes directory is present and non-trivial", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  const offenders: string[] = [];

  for (const file of files) {
    if (ALLOWLIST.has(file)) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    if (importsLlmDispatch(src) && !importsAitgGuard(src)) {
      offenders.push(file);
    }
  }

  it("every LLM-dispatching route imports an AITG output guard", () => {
    expect(
      offenders,
      `LLM routes that dispatch a model call WITHOUT importing an AITG guard ` +
        `(@aisha/aitg or a local aitg wrapper). Each of these is an ungoverned ` +
        `LLM egress and must wire withAitgGuard/withAitgGuardOrRefuse:\n` +
        offenders.map((f) => `  - services/svc-ai-chat/src/routes/${f}`).join("\n"),
    ).toEqual([]);
  });
});

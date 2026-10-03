/**
 * REMEDIATION GATE — SVC-06: svc-health-ai LLM egress must route through the
 * internal gateway + AITG, never call api.openai.com directly.
 *
 * CONTRACT
 * --------
 * The `svc-health-ai` service analyses uploaded health documents with an LLM.
 * That LLM call is a governed egress and MUST obey two invariants:
 *
 *   (A) NO source file under `services/svc-health-ai/src` may use the literal
 *       host `api.openai.com` as a live fetch/URL target (including as the
 *       DEFAULT of a config value). The model call has to go through the
 *       internal LLM gateway (AISHA Omni /v1), not straight to OpenAI. The only
 *       permitted exception is a source file that is EXPLICITLY marked as a
 *       documented direct-mode fallback (opt-in comment marker), and even then
 *       it must be in the allowlist below.
 *
 *   (B) Any source file that DISPATCHES the LLM call — i.e. performs a
 *       `fetch(...)` that carries the OpenAI-style request (references
 *       `openaiApiUrl` / `openaiApiKey` / an `api.openai.com` literal) — MUST
 *       import the shared OWASP AITG guard from `@aisha/aitg`, so raw model
 *       output is run through AITG before it leaves the service.
 *
 * KNOWN-RED (the reason this gate exists):
 *   - `src/config.ts` defaults `openaiApiUrl` to
 *     `https://api.openai.com/v1/chat/completions` (violates A).
 *   - `src/routes/analyze-document.ts` does
 *     `await fetch(config.openaiApiUrl, …)` with no `@aisha/aitg` import
 *     (violates B).
 *
 * This is a PATTERN gate: it walks the whole `src` tree so it also catches any
 * sibling file that regresses the same way (a second route, a helper, etc.).
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/svc-health-ai-llm-routing.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(
  process.cwd(),
  "services/svc-health-ai/src",
);

/**
 * Files that are PROVEN to be a documented, opt-in direct-mode fallback and are
 * therefore allowed to reference api.openai.com. Keep EMPTY — the contract is
 * that the health service routes through the gateway. A file only belongs here
 * if it carries an explicit direct-mode marker AND the exception is signed off.
 */
const DIRECT_MODE_ALLOWLIST = new Set<string>([]);

/** Recursively collect every .ts source file (excluding .d.ts and tests). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "node_modules") continue;
      out.push(...collectTsFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const OPENAI_HOST = /\bapi\.openai\.com\b/;

/** True if the file imports the shared OWASP AITG guard package. */
function importsAitg(src: string): boolean {
  return /import\s+[^;]*from\s+['"]@aisha\/aitg['"]/s.test(src);
}

/** True if this file DISPATCHES the LLM call: a fetch that carries the
 * OpenAI-style request. We look for a `fetch(` combined with an openai target /
 * credential reference, so pure config declarations aren't miscounted as the
 * dispatch site. */
function dispatchesLlmFetch(src: string): boolean {
  if (!/\bfetch\s*\(/.test(src)) return false;
  return (
    /openaiApiUrl/.test(src) ||
    /openaiApiKey/.test(src) ||
    OPENAI_HOST.test(src)
  );
}

describe("SVC-06 — svc-health-ai routes LLM through gateway + AITG", () => {
  const files = collectTsFiles(SRC_DIR).sort();
  const rel = (f: string) => path.relative(process.cwd(), f);

  it("svc-health-ai src tree is present and non-trivial", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  // (A) No direct api.openai.com egress anywhere in the tree.
  it("no source file targets api.openai.com directly (must go via gateway)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (DIRECT_MODE_ALLOWLIST.has(path.basename(f))) continue;
      const src = fs.readFileSync(f, "utf8");
      if (OPENAI_HOST.test(src)) offenders.push(rel(f));
    }
    expect(
      offenders,
      `Files referencing the literal host 'api.openai.com'. svc-health-ai must ` +
        `route LLM calls through the internal gateway (AISHA Omni /v1), not ` +
        `OpenAI directly — replace the hardcoded host/default with the gateway ` +
        `URL:\n` + offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  // (B) Every LLM-dispatch site imports the AITG guard.
  it("every LLM-dispatching file imports @aisha/aitg", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (dispatchesLlmFetch(src) && !importsAitg(src)) {
        offenders.push(rel(f));
      }
    }
    expect(
      offenders,
      `Files that dispatch the health-document LLM call WITHOUT importing ` +
        `@aisha/aitg. Each is an ungoverned LLM egress — wire the AITG guard ` +
        `around the model output before returning it:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});

/**
 * Gate (remediation DEV-01-relay-contract): the AISHA supervisor relay
 * template must implement the REAL Claude Code hook contract.
 *
 * Claude Code delivers hook events to a hook command as a JSON object on
 * STDIN — NOT via a `CLAUDE_HOOK_TOOL_INPUT` environment variable (no such
 * env var exists in the hook contract). That stdin payload carries, per event:
 *   - `tool_input` (PreToolUse/PostToolUse)
 *   - `transcript_path` (a JSONL of the running conversation) on every event
 *   - for the Stop event, the relay is expected to be able to emit a control
 *     decision back to Claude Code as JSON on stdout, e.g.
 *     `{ "decision": "block", "reason": "…" }`, to keep the agent working.
 *
 * The current template (aisha-supervisor-relay.mjs.txt) instead:
 *   - reads tool input ONLY from `process.env.CLAUDE_HOOK_TOOL_INPUT`
 *     (a variable Claude Code never sets) and never reads process.stdin;
 *   - never reads `transcript_path` nor forwards a `transcript_excerpt`, so
 *     the supervisor edge fn sees no conversation context;
 *   - discards the Stop `decision` — every path exits 0 with no control
 *     output, so a Stop-block advisory can never be relayed.
 *
 * This gate SCANS the Claude Code hook relay template(s) and asserts three
 * markers of the correct (post-fix) contract are present in each:
 *   1. STDIN     — reads the hook payload from stdin (process.stdin /
 *                  fd 0 / /dev/stdin), not only from the bogus env var.
 *   2. DECISION  — handles the Stop decision (references `decision` together
 *                  with a `block` verdict / `reason`).
 *   3. TRANSCRIPT— reads `transcript_path` and/or forwards `transcript_excerpt`.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd): the
 * single relay template has NONE of the three markers. After the relay is
 * reworked to read stdin, forward transcript context, and honor the Stop
 * decision, this gate goes green.
 *
 * The relay-template CLASS is discovered by walking the claude-overlay
 * templates dir for Claude Code hook relay scripts (Node `.mjs.txt` templates
 * that dispatch on a per-event argv and touch the Claude hook surface), so an
 * overlooked sibling relay would be caught too.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TEMPLATES_DIR = "scripts/ide-adapters/templates/claude-overlay";

/** Strip `//` and block comments so a commented-out mention can't satisfy a marker. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * A Claude Code hook RELAY template: a Node `.mjs.txt` template that dispatches
 * on a per-event argv (`process.argv[2]`) and touches the Claude Code hook
 * surface (a CLAUDE_* env var or the hook event vocabulary). This is the class
 * the contract applies to — discovered by walk, not hardcoded to one file.
 */
function isRelayTemplate(src: string): boolean {
  const touchesClaudeHooks =
    /CLAUDE_(SESSION_ID|HOOK|)/.test(src) || /PreToolUse|PostToolUse/.test(src);
  const dispatchesOnEvent = /process\.argv\[2\]/.test(src);
  return touchesClaudeHooks && dispatchesOnEvent;
}

function relayTemplates(): string[] {
  return readdirSync(join(ROOT, TEMPLATES_DIR))
    .filter((f) => f.endsWith(".mjs.txt"))
    .filter((f) =>
      isRelayTemplate(readFileSync(join(ROOT, TEMPLATES_DIR, f), "utf-8")),
    )
    .sort();
}

/** Reads the hook payload from STDIN, not only from an env var. */
function readsStdin(src: string): boolean {
  return (
    /process\.stdin/.test(src) ||
    /readFileSync\(\s*0\b/.test(src) ||
    /["'`]\/dev\/stdin["'`]/.test(src) ||
    /fd:\s*0\b/.test(src)
  );
}

/** Handles the Stop `decision` (block verdict / reason relayed to Claude Code). */
function handlesDecision(src: string): boolean {
  return (
    /\bdecision\b/.test(src) &&
    (/\bblock\b/.test(src) || /\breason\b/.test(src))
  );
}

/** Reads transcript_path and/or forwards transcript_excerpt. */
function handlesTranscript(src: string): boolean {
  return /transcript_path/.test(src) || /transcript_excerpt/.test(src);
}

describe("supervisor relay Claude Code hook contract", () => {
  const files = relayTemplates();

  test("at least one Claude Code hook relay template is present", () => {
    expect(files, `no relay template found under ${TEMPLATES_DIR}`).not.toEqual(
      [],
    );
  });

  test("every relay template reads stdin, honors the Stop decision, and forwards transcript context", () => {
    const violations: string[] = [];

    for (const f of files) {
      const src = stripComments(
        readFileSync(join(ROOT, TEMPLATES_DIR, f), "utf-8"),
      );
      const missing: string[] = [];
      if (!readsStdin(src)) missing.push("STDIN (process.stdin / fd 0)");
      if (!handlesDecision(src)) missing.push("DECISION (Stop block/reason)");
      if (!handlesTranscript(src))
        missing.push("TRANSCRIPT (transcript_path / transcript_excerpt)");
      if (missing.length > 0) {
        violations.push(`${f}: missing ${missing.join(", ")}`);
      }
    }

    expect(
      violations,
      `Relay template(s) do not implement the Claude Code hook contract:\n  ${violations.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });
});

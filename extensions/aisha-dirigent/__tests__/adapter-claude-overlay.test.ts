/**
 * Verifies the TS adapter port produces output structurally consistent with
 * the .mjs CLI sibling and the committed snapshot under .claude/.
 *
 * Drift between this and `scripts/ide-adapters/adapter-claude-overlay.mjs` is
 * caught by the repo-level gate `src/tests/gates/claude-overlay-drift.gate.test.ts`
 * which regenerates from the CLI and compares to the committed bytes.
 *
 * This test file scope: assert the TS adapter's in-memory output (without
 * running CLI) matches expected file paths + counts + invariants.
 */
import { describe, expect, it } from "vitest";
import { adapterClaudeOverlay } from "../src/generators/adapter-claude-overlay";
import { isMultiFileOutput } from "../src/generators/multi-file";
// Pull the real supervisor-relay binding from the seed SoT so the payload-
// override fixture stays in lockstep with it (generate() requires the relay).
import bindingsMirror from "../../../aisha/db/seed/claude_hook_bindings.json";

const RELAY_BINDING = (
  bindingsMirror as { bindings: Array<{ rule_slug: string }> }
).bindings.find((b) => b.rule_slug === "supervisor-relay");

describe("adapter-claude-overlay (TS port)", () => {
  it("registers as multi-file adapter", () => {
    expect(adapterClaudeOverlay.meta.id).toBe("claude-overlay");
    expect(adapterClaudeOverlay.meta.multiFile).toBe(true);
  });

  it("generate() returns MultiFileOutput with 16 files (3 static hooks + 1 relay + 5 regex hooks + agent + skill + 3 commands + statusline + settings.json)", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: { fingerprint: "test", context_profile: "test" },
      scope: "global",
      payload_version: 1,
      generated_at: "2026-05-23T19:00:00Z",
    });

    expect(isMultiFileOutput(output)).toBe(true);
    if (!isMultiFileOutput(output)) return;

    expect(output.files).toHaveLength(16);

    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".claude/agents/aisha-advisor.md",
      ".claude/commands/aisha-advise.md",
      ".claude/commands/aisha-cooldowns.md",
      ".claude/commands/aisha-supervise.md",
      ".claude/hooks/_aisha-advise-lib.sh",
      ".claude/hooks/aisha-advise-any.sh",
      ".claude/hooks/aisha-advise-bash-risk.sh",
      ".claude/hooks/aisha-advise-console.sh",
      ".claude/hooks/aisha-advise-i18n.sh",
      ".claude/hooks/aisha-advise-rpc.sh",
      ".claude/hooks/aisha-advise-select-star.sh",
      ".claude/hooks/aisha-advise-ts-ignore.sh",
      ".claude/hooks/aisha-supervisor-relay.mjs",
      ".claude/settings.json",
      ".claude/skills/aisha-supervisor/SKILL.md",
      ".claude/statusline.sh",
    ]);
  });

  it("all shell hooks are marked mode:executable", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    const shellFiles = output.files.filter((f) => f.path.endsWith(".sh"));
    expect(shellFiles.length).toBeGreaterThan(0);
    for (const f of shellFiles) {
      expect(f.mode, `${f.path} is not executable`).toBe("executable");
    }
  });

  it("agent and skill markdown include the shared AISHA runtime contract", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    for (const path of [
      ".claude/agents/aisha-advisor.md",
      ".claude/skills/aisha-supervisor/SKILL.md",
    ]) {
      const file = output.files.find((f) => f.path === path);
      expect(file, `${path} missing from output`).toBeDefined();
      expect(file!.content).toContain("## AISHA Runtime Contract");
      expect(file!.content).toContain("AISHA Gateway as the only app-facing backend surface");
      expect(file!.content).toContain("BROKER_TOKEN_SECRET");
      expect(file!.content).toContain("gateway `ROUTE_TABLE`");
    }
  });

  it("settings.json fragment uses merge-json-keys (preserve user entries)", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    const settings = output.files.find((f) => f.path === ".claude/settings.json");
    expect(settings).toBeDefined();
    expect(settings?.merge).toBe("merge-json-keys");
  });

  it("settings.json fragment contains 6 advisory hook entries (5 regex + i18n) + relay + Bash entry (bash-risk) with managed marker", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    const settings = output.files.find((f) => f.path === ".claude/settings.json");
    const parsed = JSON.parse(settings!.content);

    // PreToolUse now has TWO matcher entries: Edit|Write|MultiEdit (advisory hooks + relay)
    // AND Bash (bash-risk only). Both live under PreToolUse since they hook the same event.
    const preToolEntries = parsed.hooks.PreToolUse as Array<{
      matcher?: string;
      hooks?: Array<{ _aisha?: { managed?: boolean }; command: string }>;
    }>;
    expect(preToolEntries.length).toBeGreaterThanOrEqual(2);

    const editEntry = preToolEntries.find((e) => e.matcher === "Edit|Write|MultiEdit");
    expect(editEntry, "missing Edit|Write|MultiEdit entry").toBeDefined();
    expect(editEntry!.hooks!.length).toBeGreaterThanOrEqual(6); // 5 regex + i18n + relay
    for (const h of editEntry!.hooks!) {
      expect(h._aisha?.managed).toBe(true);
    }

    const bashEntry = preToolEntries.find((e) => e.matcher === "Bash");
    expect(bashEntry, "missing Bash entry").toBeDefined();
    expect(bashEntry!.hooks).toHaveLength(1);
    expect(bashEntry!.hooks![0].command).toContain("aisha-advise-bash-risk.sh");

    // Vrstva 2 relay wired on SessionStart, PostToolUse, Stop too
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("aisha-supervisor-relay.mjs session_start");
    expect(parsed.hooks.PostToolUse[0].hooks[0].command).toContain("aisha-supervisor-relay.mjs post_tool");
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain("aisha-supervisor-relay.mjs stop");
  });

  it("regex hook content carries pattern, message_cs, cooldown via templating (advisory invariants)", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    const rpcHook = output.files.find((f) => f.path === ".claude/hooks/aisha-advise-rpc.sh");
    expect(rpcHook).toBeDefined();
    const content = rpcHook!.content;

    expect(content).toContain("aisha_advise_cooldown"); // cooldown gate
    expect(content).toContain('"rpc-only"'); // rule slug
    expect(content).toContain("RPC-Only:"); // message_cs prefix
    expect(content).toMatch(/exit 0\s*$/); // advisory invariant
    expect(content).not.toContain('"decision"'); // never blocks
  });

  it("payload override: passing claude_hook_bindings on payload uses them instead of bundled mirror", async () => {
    const output = await adapterClaudeOverlay.generate({
      story: null,
      rules: [],
      ruleset: null,
      payload_version: 1,
      // @ts-expect-error — extending payload with adapter-specific field
      claude_hook_bindings: [
        {
          rule_slug: "test-rule",
          hook_event: "PreToolUse",
          matcher: "Edit|Write|MultiEdit",
          scanner_kind: "regex",
          pattern_regex: "FOOBAR",
          messages: { cs: "test message cs", en: "test message en" },
          hint: "test hint",
          cooldown_sec: 30,
          severity: "low",
        },
        // A binding-override payload is the COMPLETE set the generator renders
        // from — including the mandatory config-driven relay (in production the
        // live RPC returns it alongside the regex rules). Use the real seed
        // binding so this fixture can't drift from the relay's config contract.
        RELAY_BINDING,
      ],
    });
    if (!isMultiFileOutput(output)) throw new Error("expected MultiFileOutput");

    const testHook = output.files.find(
      (f) => f.path === ".claude/hooks/aisha-advise-test-rule.sh",
    );
    expect(testHook).toBeDefined();
    expect(testHook!.content).toContain("FOOBAR");
    expect(testHook!.content).toContain("test message cs");
    expect(testHook!.content).toContain("30");

    // 3 static + 1 relay + 1 dynamic + 1 agent + 1 skill + 3 commands + 1 statusline + 1 settings = 12
    expect(output.files).toHaveLength(12);
  });
});

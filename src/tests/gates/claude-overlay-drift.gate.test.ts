/**
 * @file claude-overlay-drift.gate.test.ts
 * Drift detection for the AISHA Dirigent supervision overlay.
 *
 * Asserts:
 *   1. SQL seed and JSON mirror are in lockstep (claude_hook_bindings.json
 *      contains exactly the same rules as the seed SQL INSERT).
 *   2. Re-running scripts/ide-adapters/adapter-claude-overlay.mjs produces
 *      byte-identical output to what's committed under .claude/.
 *
 * Why this matters: the committed .claude/* files are a GENERATED snapshot
 * (clone-to-ready). If anyone hand-edits a generated file, this test fails
 * and tells them to regenerate from the SoT instead. If anyone updates the
 * SoT (claude_hook_bindings seed) without regenerating, this also fails.
 *
 * Run: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

describe("AISHA Dirigent Claude Overlay — Drift Detection", () => {
  describe("SoT sync — SQL seed ↔ JSON mirror", () => {
    it("aisha/db/seed/claude_hook_bindings.json mirrors the SQL seed", () => {
      const sqlSeed = readRepoFile("aisha/db/seed/core/27_claude_hook_bindings.sql");
      const jsonMirror = JSON.parse(readRepoFile("aisha/db/seed/claude_hook_bindings.json")) as {
        bindings: Array<{
          rule_slug: string;
          hook_event: string;
          matcher: string;
          scanner_kind: string;
          pattern_regex: string;
          messages: { cs: string; en: string };
          hint: string;
          cooldown_sec: number;
          severity: string;
        }>;
      };

      expect(jsonMirror.bindings).toBeInstanceOf(Array);
      expect(jsonMirror.bindings.length).toBeGreaterThan(0);

      // Parse the SQL VALUES block: for each binding row, assert the JSON
      // contains the same rule_slug and a matching cs message (the most
      // distinctive string. Pattern_regex equality has subtle escape
      // differences between SQL ('' apostrophe doubling) and JSON
      // (\\ escape) so we check rule_slug + messages.cs as the proxy.
      for (const binding of jsonMirror.bindings) {
        expect(
          sqlSeed.includes(`'${binding.rule_slug}'`),
          `SQL seed missing rule_slug ${binding.rule_slug}`,
        ).toBe(true);
        // SQL embeds messages with '' for apostrophes — normalize for comparison
        const normalizedMsg = binding.messages.cs.replace(/'/g, "''");
        expect(
          sqlSeed.includes(normalizedMsg),
          `SQL seed missing messages.cs for ${binding.rule_slug}: "${binding.messages.cs}"`,
        ).toBe(true);
      }
    });

    it("JSON mirror has exactly 5 regex rules matching extension's VIOLATION_RULES", () => {
      const jsonMirror = JSON.parse(readRepoFile("aisha/db/seed/claude_hook_bindings.json"));
      const slugs = jsonMirror.bindings
        .filter((b: { scanner_kind: string }) => b.scanner_kind === "regex")
        .map((b: { rule_slug: string }) => b.rule_slug)
        .sort();
      expect(slugs).toEqual(["no-any", "no-console", "rpc-only", "select-star", "ts-ignore"]);
    });

    it("JSON mirror has the supervisor-relay binding with interpretable config", () => {
      const jsonMirror = JSON.parse(readRepoFile("aisha/db/seed/claude_hook_bindings.json"));
      const relay = jsonMirror.bindings.find(
        (b: { rule_slug: string; scanner_kind: string }) =>
          b.rule_slug === "supervisor-relay" && b.scanner_kind === "relay",
      );
      expect(relay, "supervisor-relay binding missing from JSON mirror").toBeDefined();
      // config drives BOTH the settings.json wiring (events) and the generated
      // script's runtime behaviour (phase_map, tool_derivation) — all required.
      expect(Array.isArray(relay.config?.events)).toBe(true);
      expect(relay.config.events.length).toBeGreaterThanOrEqual(4);
      const args = relay.config.events.map((e: { arg: string }) => e.arg).sort();
      expect(args).toEqual(["post_tool", "pre_tool", "session_start", "stop"]);
      expect(relay.config.phase_map).toBeDefined();
      expect(Array.isArray(relay.config.tool_derivation)).toBe(true);
      // Agent tool must be derivable + matched (live sub-agent accumulation
      // depends on relay firing for Agent tool use).
      const agentRule = relay.config.tool_derivation.find(
        (r: { tool: string }) => r.tool === "Agent",
      );
      expect(agentRule, "tool_derivation missing Agent rule").toBeDefined();
      const preTool = relay.config.events.find((e: { arg: string }) => e.arg === "pre_tool");
      expect(preTool.matcher).toContain("Agent");
    });

    it("pattern_regex uses POSIX ERE syntax (no PCRE-only constructs)", () => {
      // The generated hooks run on bash + grep -E (POSIX Extended Regex).
      // PCRE-only syntax silently works on macOS BSD grep but FAILS on Linux
      // GNU grep — pattern matches nothing → hook stays silent → test
      // expectation 'stdout contains X' fails.
      //
      // Documented offender (2026-05-24): `(?:...)` non-capturing group
      // worked on local macOS but broke runtime gate on a Linux CI
      // runner.
      //
      // POSIX ERE supports: . * + ? | () [] {} ^ $ and (via GNU/BSD
      // extension) \b \s \d. It does NOT support: (?:...) (?=...) (?!...)
      // (?<=...) (?<!...) \K named-groups inline-flags atomic-groups.
      const jsonMirror = JSON.parse(readRepoFile("aisha/db/seed/claude_hook_bindings.json"));
      const pcreOnly = [
        { pattern: /\(\?:/, name: "(?:...)  non-capturing group" },
        { pattern: /\(\?=/, name: "(?=...)  positive lookahead" },
        { pattern: /\(\?!/, name: "(?!...)  negative lookahead" },
        { pattern: /\(\?<=/, name: "(?<=...) positive lookbehind" },
        { pattern: /\(\?<!/, name: "(?<!...) negative lookbehind" },
        { pattern: /\(\?</, name: "(?<name>...) named group" },
        { pattern: /\\K/, name: "\\K  keep-out-of-match" },
        { pattern: /\(\?[imsx-]+\)/, name: "(?flag) inline flag" },
      ];
      const violations: string[] = [];
      for (const b of jsonMirror.bindings) {
        if (!b.pattern_regex) continue;
        for (const { pattern, name } of pcreOnly) {
          if (pattern.test(b.pattern_regex)) {
            violations.push(`  ${b.rule_slug}: uses ${name} — won't match on GNU grep -E`);
          }
        }
      }
      expect(
        violations,
        "PCRE-only syntax in pattern_regex breaks runtime hook on Linux:\n" +
          violations.join("\n"),
      ).toEqual([]);
    });
  });

  describe("Generator output ↔ committed snapshot", () => {
    it("adapter produces byte-identical output to committed .claude/* files", async () => {
      // Load the adapter directly and call generate() with a minimal payload.
      const adapter = await import(
        path.join(REPO_ROOT, "scripts", "ide-adapters", "adapter-claude-overlay.mjs")
      );
      const payload = {
        story: null,
        rules: [],
        ruleset: { fingerprint: "drift-test", context_profile: "test" },
        scope: "global" as const,
        payload_version: 1,
        generated_at: "2026-05-23T19:00:00Z",
      };

      const output = await adapter.generate(payload);
      expect(output.files).toBeInstanceOf(Array);

      const drifted: string[] = [];
      for (const file of output.files) {
        // settings.json is the merge target; its committed form contains
        // user-added entries (block-baseline-edit, pre-commit-migration-check)
        // not present in the adapter's bare fragment. Skip exact-bytes check
        // — covered by a separate merge invariant test below.
        if (file.path === ".claude/settings.json") continue;

        const committed = readRepoFile(file.path);
        if (committed !== file.content) {
          drifted.push(file.path);
        }
      }

      expect(drifted, `Drifted files (regenerate with 'npm run gen:ide -- --format=claude-overlay'):\n  ${drifted.join("\n  ")}`).toEqual([]);
    });

    it("settings.json merge fragment contains all 7 advisory hook entries with managed marker", () => {
      const settings = JSON.parse(readRepoFile(".claude/settings.json"));
      const preToolUseEdit = settings.hooks?.PreToolUse?.find(
        (e: { matcher?: string }) => e.matcher === "Edit|Write|MultiEdit",
      );
      expect(preToolUseEdit, "missing PreToolUse Edit entry").toBeDefined();

      const managedHookCommands = preToolUseEdit.hooks
        .filter((h: { _aisha?: { managed?: boolean } }) => h._aisha?.managed === true)
        .map((h: { command: string }) => h.command);

      const expectedRules = ["rpc", "console", "any", "i18n", "ts-ignore", "select-star"];
      for (const rule of expectedRules) {
        expect(
          managedHookCommands.some((cmd: string) => cmd.endsWith(`aisha-advise-${rule}.sh`)),
          `missing aisha-advise-${rule}.sh in PreToolUse Edit hooks`,
        ).toBe(true);
      }
    });

    it("settings.json wires the relay on config-driven matchers (incl. Agent tool)", () => {
      const settings = JSON.parse(readRepoFile(".claude/settings.json"));
      const findRelay = (event: string, matcher?: string) => {
        const entries = settings.hooks?.[event] ?? [];
        const entry = entries.find(
          (e: { matcher?: string }) => (e.matcher || "") === (matcher || ""),
        );
        return entry?.hooks?.find(
          (h: { command?: string; _aisha?: { kind?: string } }) =>
            h._aisha?.kind === "relay" && h.command?.includes("aisha-supervisor-relay.mjs"),
        );
      };
      // The Agent tool MUST be matched — live sub-agent monitoring depends on it.
      expect(
        findRelay("PreToolUse", "Edit|Write|MultiEdit|Agent"),
        "relay missing on PreToolUse Edit|Write|MultiEdit|Agent",
      ).toBeDefined();
      expect(
        findRelay("PostToolUse", "Edit|Write|MultiEdit|Bash|Agent"),
        "relay missing on PostToolUse Edit|Write|MultiEdit|Bash|Agent",
      ).toBeDefined();
      expect(findRelay("SessionStart"), "relay missing on SessionStart").toBeDefined();
      expect(findRelay("Stop"), "relay missing on Stop").toBeDefined();
    });

    it("generated relay script embeds the binding config (CONFIG = seed data, script = interpreter)", () => {
      const relay = readRepoFile(".claude/hooks/aisha-supervisor-relay.mjs");
      // CONFIG constant is injected from the supervisor-relay binding's config
      const configMatch = relay.match(/const CONFIG = (\{[\s\S]*?\n\});\n/);
      expect(configMatch, "relay missing injected CONFIG constant").toBeTruthy();
      const config = JSON.parse(configMatch![1]);
      const jsonMirror = JSON.parse(readRepoFile("aisha/db/seed/claude_hook_bindings.json"));
      const binding = jsonMirror.bindings.find(
        (b: { rule_slug: string }) => b.rule_slug === "supervisor-relay",
      );
      // Byte-level drift between seed config and embedded config = regen needed
      expect(config).toEqual(binding.config);
      // Advisory invariant applies to the relay too: always silent exit 0
      expect(relay.trimEnd().endsWith("process.exit(0);")).toBe(true);
      expect(relay.includes('"decision"')).toBe(false);
    });

    it("settings.json preserves non-managed user hooks (block-baseline-edit, pre-commit-migration-check)", () => {
      const settings = JSON.parse(readRepoFile(".claude/settings.json"));
      const allHookCommands: string[] = [];
      for (const event of Object.values(settings.hooks ?? {}) as Array<Array<{ hooks?: Array<{ command: string }> }>>) {
        for (const entry of event) {
          for (const hook of entry.hooks ?? []) {
            allHookCommands.push(hook.command);
          }
        }
      }
      expect(
        allHookCommands.some((c) => c.includes("block-baseline-edit.sh")),
        "user hook block-baseline-edit.sh got clobbered by generator merge",
      ).toBe(true);
      expect(
        allHookCommands.some((c) => c.includes("pre-commit-migration-check.sh")),
        "user hook pre-commit-migration-check.sh got clobbered by generator merge",
      ).toBe(true);
    });
  });

  describe("Advisory-only invariants — generated hooks", () => {
    const ADVISORY_HOOKS = [
      "aisha-advise-rpc.sh",
      "aisha-advise-console.sh",
      "aisha-advise-any.sh",
      "aisha-advise-i18n.sh",
      "aisha-advise-ts-ignore.sh",
      "aisha-advise-select-star.sh",
      "aisha-advise-bash-risk.sh",
    ];

    it("all 7 generated hooks end with `exit 0` (advisory invariant: never block)", () => {
      for (const hook of ADVISORY_HOOKS) {
        const content = readRepoFile(`.claude/hooks/${hook}`);
        const trimmed = content.trimEnd();
        expect(
          trimmed.endsWith("exit 0"),
          `${hook} doesn't end with 'exit 0' — would violate advisory-only invariant`,
        ).toBe(true);
      }
    });

    it("no generated hook emits `decision:deny` or `decision:block` in stdout", () => {
      for (const hook of ADVISORY_HOOKS) {
        const content = readRepoFile(`.claude/hooks/${hook}`);
        expect(
          content.includes('"decision"') && (content.includes('"deny"') || content.includes('"block"')),
          `${hook} contains decision:deny/block payload — would violate advisory-only invariant`,
        ).toBe(false);
      }
    });

    it("all generated hooks source _aisha-advise-lib.sh for shared cooldown logic", () => {
      for (const hook of ADVISORY_HOOKS) {
        const content = readRepoFile(`.claude/hooks/${hook}`);
        expect(
          content.includes("_aisha-advise-lib.sh"),
          `${hook} doesn't source _aisha-advise-lib.sh — cooldown gate missing`,
        ).toBe(true);
      }
    });

    it("all generated hooks invoke aisha_advise_cooldown for rate-limit enforcement", () => {
      for (const hook of ADVISORY_HOOKS) {
        const content = readRepoFile(`.claude/hooks/${hook}`);
        expect(
          content.includes("aisha_advise_cooldown"),
          `${hook} doesn't invoke aisha_advise_cooldown — would flood advisor output`,
        ).toBe(true);
      }
    });
  });

  describe("Generator wiring", () => {
    it("registry.mjs registers the claude-overlay adapter", () => {
      const registry = readRepoFile("scripts/ide-adapters/registry.mjs");
      expect(registry).toContain('"claude-overlay"');
      expect(registry).toContain("./adapter-claude-overlay.mjs");
      expect(registry).toContain("multiFile: true");
    });

    it("multi-file write loop in generate-ide-instructions.mjs handles executable mode", () => {
      const orchestrator = readRepoFile("scripts/generate-ide-instructions.mjs");
      expect(orchestrator).toContain("isMultiFileOutput");
      expect(orchestrator).toContain("writeMultiFileOutput");
      expect(orchestrator).toContain('file.mode === "executable"');
      expect(orchestrator).toContain("chmodSync");
    });

    it("backend RPC mcp_get_claude_hook_bindings is declared in SoT", () => {
      const fn = readRepoFile("aisha/db/sql/functions/mcp_get_claude_hook_bindings.sql");
      expect(fn).toContain("SECURITY DEFINER");
      expect(fn).toContain("SET search_path TO 'public'");
      expect(fn).toContain("REVOKE ALL ON FUNCTION");
      expect(fn).toContain("GRANT EXECUTE");
    });

    it("mcp_get_claude_hook_bindings is registered in KNOWN_NO_AUTH_FUNCTIONS", () => {
      const security = readRepoFile("src/tests/gates/security-known-issues.ts");
      expect(security).toContain("'mcp_get_claude_hook_bindings'");
    });
  });

  describe("RPC contract — deep static analysis (Gap 1)", () => {
    const rpcFile = readRepoFile("aisha/db/sql/functions/mcp_get_claude_hook_bindings.sql");

    it("function signature matches expected: p_story_id uuid → returns jsonb", () => {
      expect(rpcFile).toMatch(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.mcp_get_claude_hook_bindings\s*\(\s*p_story_id\s+uuid\s+DEFAULT\s+NULL\s*\)\s*RETURNS\s+jsonb/,
      );
    });

    it("function body queries claude_hook_bindings table with all expected columns", () => {
      const expectedCols = [
        "rule_slug",
        "hook_event",
        "matcher",
        "scanner_kind",
        "pattern_regex",
        "messages",
        "hint",
        "cooldown_sec",
        "severity",
        "config",
      ];
      for (const col of expectedCols) {
        expect(rpcFile, `RPC body missing column ${col}`).toContain(`'${col}',`);
      }
      expect(rpcFile).toContain("FROM public.claude_hook_bindings");
      expect(rpcFile).toContain("WHERE is_active = true");
      expect(rpcFile).toContain("ORDER BY rule_slug");
    });

    it("function uses COALESCE for empty-array fallback (no NULL leakage)", () => {
      expect(rpcFile).toContain("COALESCE(v_bindings, '[]'::jsonb)");
    });

    it("function grants EXECUTE to all 3 roles (anon + authenticated + service_role)", () => {
      expect(rpcFile).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.mcp_get_claude_hook_bindings\(uuid\)\s+TO\s+anon/);
      expect(rpcFile).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.mcp_get_claude_hook_bindings\(uuid\)\s+TO\s+authenticated/);
      expect(rpcFile).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.mcp_get_claude_hook_bindings\(uuid\)\s+TO\s+service_role/);
    });

    it("table SoT pair has matching schema (rule_slug UNIQUE, severity CHECK, scanner_kind CHECK, hook_event CHECK)", () => {
      const tbl = readRepoFile("aisha/db/sql/tables/claude_hook_bindings.sql");
      expect(tbl).toContain("rule_slug text NOT NULL");
      expect(tbl).toContain("CONSTRAINT claude_hook_bindings_rule_slug_unique UNIQUE (rule_slug)");
      expect(tbl).toContain("CONSTRAINT claude_hook_bindings_severity_check");
      expect(tbl).toContain("CONSTRAINT claude_hook_bindings_scanner_kind_check");
      expect(tbl).toContain("CONSTRAINT claude_hook_bindings_hook_event_check");
      expect(tbl).toContain("CONSTRAINT claude_hook_bindings_regex_when_kind_regex");
      // 2026-06-12: relay/snapshot kinds + config column (data-driven hook scripts)
      expect(tbl).toContain("'regex','heuristic','relay','snapshot'");
      expect(tbl).toContain("config jsonb NOT NULL DEFAULT '{}'::jsonb");
    });

    it("RLS pair has 3 policies (service_role full, anon read, auth read) — all DROP IF EXISTS prefixed for idempotence", () => {
      const rls = readRepoFile("aisha/db/sql/rls/claude_hook_bindings.sql");
      expect(rls.match(/DROP POLICY IF EXISTS/g)?.length, "expected 3 DROP POLICY IF EXISTS").toBe(3);
      expect(rls.match(/CREATE POLICY/g)?.length, "expected 3 CREATE POLICY").toBe(3);
      expect(rls).toContain("service_role_full_access_claude_hook_bindings");
      expect(rls).toContain("anon_read_active_claude_hook_bindings");
      expect(rls).toContain("auth_read_active_claude_hook_bindings");
    });

    it("trigger SoT pair set_claude_hook_bindings_updated_at exists + matches table", () => {
      const trg = readRepoFile("aisha/db/sql/triggers/set_claude_hook_bindings_updated_at.sql");
      expect(trg).toContain("set_claude_hook_bindings_updated_at()");
      expect(trg).toContain("BEFORE UPDATE ON public.claude_hook_bindings");
      expect(trg).toContain("NEW.updated_at = now()");
    });

    it("seed contains all 5 regex rules + supervisor-relay (cold-start applied via seed/core)", () => {
      // Seed moved to seed/core/ (2026-06-12) so compile-seed actually applies
      // it on fresh databases — the old root-level file was never applied.
      const seed = readRepoFile("aisha/db/seed/core/27_claude_hook_bindings.sql");
      const expectedSlugs = [
        "rpc-only",
        "no-console",
        "no-any",
        "ts-ignore",
        "select-star",
        "supervisor-relay",
      ];
      for (const slug of expectedSlugs) {
        expect(seed, `seed missing rule '${slug}'`).toContain(`'${slug}'`);
      }
      // Each rule has ON CONFLICT for re-runnable seed
      expect(seed).toContain("ON CONFLICT (rule_slug) DO UPDATE");
      // The relay row's config must survive re-seeding (behaviour = data)
      expect(seed).toContain("config = EXCLUDED.config");
    });

    it("compiled seed includes the bindings + phase catalog (cold-start regression guard)", () => {
      const compiled = readRepoFile("aisha/db/seed.compiled.sql");
      expect(
        compiled.includes("supervisor-relay"),
        "seed.compiled.sql missing supervisor-relay — run AISHA_SEED_PROFILE=demo npm run db:seed:compile",
      ).toBe(true);
      expect(
        compiled.includes("agent_phase_catalog"),
        "seed.compiled.sql missing agent_phase_catalog seed",
      ).toBe(true);
    });
  });

  describe("CLI ↔ extension TS adapter byte parity (Gap 2)", () => {
    // The CLI adapter (scripts/ide-adapters/adapter-claude-overlay.mjs) and the
    // extension TS adapter (extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts)
    // are two ports that share the same templates + bindings JSON SoT. They MUST
    // produce byte-identical output. Drift between them = users get different
    // hook behaviour from CLI (`npm run gen:ide`) vs extension (auto-regen).
    //
    // We don't actually run the TS adapter here (would require esbuild + vscode
    // mock); instead we assert STRUCTURAL parity: same imports, same template
    // names, same rendering function signatures.

    it("TS adapter imports the SAME 10 template files as CLI .mjs adapter does", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");

      const expectedTemplates = [
        "_aisha-advise-lib.sh",
        "aisha-advise-i18n.sh",
        "aisha-advise-bash-risk.sh",
        "regex-hook.template.sh",
        "aisha-advisor.md",
        "aisha-supervisor.SKILL.md",
        "cmd-aisha-advise.md",
        "cmd-aisha-supervise.md",
        "cmd-aisha-cooldowns.md",
        "statusline.sh",
      ];
      for (const tpl of expectedTemplates) {
        expect(tsAdapter, `TS adapter missing template ${tpl}`).toContain(tpl);
        expect(mjsAdapter, `CLI adapter missing template ${tpl}`).toContain(tpl);
      }
    });

    it("TS adapter uses the SAME bindings JSON mirror as CLI adapter", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");
      expect(tsAdapter).toContain("aisha/db/seed/claude_hook_bindings.json");
      expect(mjsAdapter).toContain("aisha/db/seed/claude_hook_bindings.json");
    });

    it("both adapters declare the SAME 16-file output set (same paths)", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");

      const expectedPaths = [
        ".claude/hooks/_aisha-advise-lib.sh",
        ".claude/hooks/aisha-advise-i18n.sh",
        ".claude/hooks/aisha-advise-bash-risk.sh",
        ".claude/hooks/aisha-supervisor-relay.mjs",
        ".claude/agents/aisha-advisor.md",
        ".claude/skills/aisha-supervisor/SKILL.md",
        ".claude/commands/aisha-advise.md",
        ".claude/commands/aisha-supervise.md",
        ".claude/commands/aisha-cooldowns.md",
        ".claude/statusline.sh",
        ".claude/settings.json",
      ];
      for (const p of expectedPaths) {
        expect(tsAdapter, `TS adapter missing path ${p}`).toContain(`"${p}"`);
        expect(mjsAdapter, `CLI adapter missing path ${p}`).toContain(`"${p}"`);
      }
    });

    it("both adapters use the SAME helper functions (renderRegexHook, injectAutoGenHeader, renderSettingsFragment)", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");
      for (const fn of [
        "renderRegexHook",
        "injectAutoGenHeader",
        "renderSettingsFragment",
        "hookSlugToFilename",
        "applyTemplate",
        "pickRelayBinding",
        "renderRelayScript",
      ]) {
        expect(tsAdapter, `TS adapter missing ${fn}`).toContain(fn);
        expect(mjsAdapter, `CLI adapter missing ${fn}`).toContain(fn);
      }
    });

    it("both adapters inject RELAY_CONFIG_JSON with identical JSON.stringify formatting", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");
      // Identical stringify args = byte-identical CONFIG in both outputs
      for (const adapter of [tsAdapter, mjsAdapter]) {
        expect(adapter).toContain("RELAY_CONFIG_JSON: JSON.stringify(relayBinding.config, null, 2)");
      }
    });

    it("both adapters use IDENTICAL AUTO_GEN_MARKER constant + same regex-hook variables", () => {
      const tsAdapter = readRepoFile("extensions/aisha-dirigent/src/generators/adapter-claude-overlay.ts");
      const mjsAdapter = readRepoFile("scripts/ide-adapters/adapter-claude-overlay.mjs");
      const marker = "Auto-generated from AISHA Expert Overlay ruleset.";
      expect(tsAdapter).toContain(marker);
      expect(mjsAdapter).toContain(marker);

      // Same template variable names
      const tplVars = ["HOOK_FILENAME", "RULE_SLUG", "SEVERITY", "HOOK_EVENT", "MATCHER", "PATTERN_REGEX", "COOLDOWN_SEC", "MESSAGE_CS", "HINT_LINE"];
      for (const v of tplVars) {
        expect(tsAdapter, `TS adapter missing tpl var ${v}`).toContain(v);
        expect(mjsAdapter, `CLI adapter missing tpl var ${v}`).toContain(v);
      }
    });
  });

  describe("mergeSettingsJson error handling (Gap 3)", () => {
    // The mergeSettingsJson helper (scripts/ide-adapters/multi-file.mjs) is the
    // hot path for any settings.json regeneration. If the user hand-edits their
    // settings.json into invalid JSON state, the next regen must fail with a
    // clear error — not silently overwrite the file or produce confusing parser
    // output. Similarly, generated JSON must never be malformed.

    it("throws clear error when existing JSON is malformed", async () => {
      const { mergeSettingsJson } = await import(
        path.join(REPO_ROOT, "scripts", "ide-adapters", "multi-file.mjs")
      );
      const validGenerated = JSON.stringify({ permissions: { allow: [] } });
      expect(() => mergeSettingsJson('{"unclosed":', validGenerated)).toThrow(
        /mergeSettingsJson: existing JSON invalid/,
      );
    });

    it("throws clear error when generated JSON is malformed", async () => {
      const { mergeSettingsJson } = await import(
        path.join(REPO_ROOT, "scripts", "ide-adapters", "multi-file.mjs")
      );
      expect(() => mergeSettingsJson("{}", "{not valid json")).toThrow(
        /mergeSettingsJson: generated JSON invalid/,
      );
    });

    it("accepts empty/whitespace-only existing (treats as {})", async () => {
      const { mergeSettingsJson } = await import(
        path.join(REPO_ROOT, "scripts", "ide-adapters", "multi-file.mjs")
      );
      const generated = JSON.stringify({ permissions: { allow: ["Bash(ls)"] } });
      const merged = mergeSettingsJson("", generated);
      const parsed = JSON.parse(merged);
      expect(parsed.permissions.allow).toEqual(["Bash(ls)"]);
    });

    it("merge is idempotent — applying twice produces same result", async () => {
      const { mergeSettingsJson } = await import(
        path.join(REPO_ROOT, "scripts", "ide-adapters", "multi-file.mjs")
      );
      const existing = JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: "user-hook.sh" }],
            },
          ],
        },
      });
      const generated = JSON.stringify({
        permissions: { allow: ["Bash(cat)"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [
                {
                  type: "command",
                  command: "managed.sh",
                  _aisha: { managed: true },
                },
              ],
            },
          ],
        },
      });
      const once = mergeSettingsJson(existing, generated);
      const twice = mergeSettingsJson(once, generated);
      expect(twice).toBe(once);
    });
  });
});

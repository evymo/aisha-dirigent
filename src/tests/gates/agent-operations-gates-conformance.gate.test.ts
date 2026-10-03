/**
 * Gate: agent operations gates are governed knowledge WITH live enforcement.
 *
 * A rule without technical enforcement is just text. This gate asserts both
 * halves stay true:
 *  A. the 10 gates exist as governed expert_rules seed (published, machine-
 *     enforceable `RULE:` ai_instructions, Source Onboarding classification tags
 *     per docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md, valid enum categories), and
 *  B. every enforcement point named by a rule exists in code and is wired into
 *     .claude/settings.json — so deleting an advisory hook breaks this gate, not
 *     just the doctrine.
 *
 * The enum-membership check in A is deliberate: scripts/import-knowledge-to-expert-rules.ts
 * drifted away from `expert_rule_category` unnoticed and can never run. A seed that
 * casts an invalid enum value fails at cold start, so the drift is caught here first.
 *
 * Companion to anthropic-principles-conformance.gate.test.ts — same shape, same
 * governance path (expert_rules → compose_context ruleset layer + CLAUDE.md overlay).
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const SEED = "aisha/db/seed/core/39_agent_operations_gates.sql";
const ENUM = "aisha/db/sql/enums/expert_rule_category.sql";
const SETTINGS = ".claude/settings.json";

const GATE_SLUGS = [
  "agent-ops-repo-state-gate",
  "agent-ops-context-reuse",
  "agent-ops-scope-adjacency",
  "agent-ops-bounded-self-correction",
  "agent-ops-mandatory-lens",
  "agent-ops-closure-backlog-brake",
  "agent-ops-impact-consistency",
  "agent-ops-unclear-escalation",
  "agent-ops-stop-is-not-closure",
  "agent-ops-no-placeholder-commands",
];

const CLASSIFICATION_TAGS = [
  "source_type:internal",
  "data_sensitivity:public",
  "retention_class:long_term",
  "legal_basis:legitimate_interest",
];

describe("agent operations gates — governed KB", () => {
  test("all 10 gates are seeded as published expert_rules with enforceable ai_instructions", () => {
    const seed = read(SEED);
    for (const slug of GATE_SLUGS) {
      expect(seed, `missing gate rule: ${slug}`).toContain(`'${slug}'`);
    }
    const inserts = seed.split("INSERT INTO expert_rules").length - 1;
    expect(inserts, "expected 10 gate inserts").toBe(GATE_SLUGS.length);
    expect(
      (seed.match(/RULE:/g) ?? []).length,
      "each rule needs a machine-enforceable ai_instructions directive",
    ).toBeGreaterThanOrEqual(GATE_SLUGS.length);
    expect((seed.match(/'published'/g) ?? []).length).toBeGreaterThanOrEqual(GATE_SLUGS.length);
  });

  test("rules carry the mandatory Source Onboarding classification (4 dimensions)", () => {
    const seed = read(SEED);
    for (const tag of CLASSIFICATION_TAGS) {
      const count = (seed.match(new RegExp(tag, "g")) ?? []).length;
      expect(count, `classification tag ${tag} must be on all 10 rules`).toBeGreaterThanOrEqual(
        GATE_SLUGS.length,
      );
    }
  });

  test("seed is idempotent and never downgrades a published rule", () => {
    const seed = read(SEED);
    expect((seed.match(/\) ON CONFLICT \(slug\) DO UPDATE SET/g) ?? []).length).toBe(
      GATE_SLUGS.length,
    );
    expect(seed).toMatch(/status = 'published'/);
  });

  test("seed skips gracefully when partner bootstrap has not run", () => {
    const seed = read(SEED);
    expect(seed, "author_partner_id is NOT NULL — the seed must no-op, not explode").toMatch(
      /IF v_partner_id IS NULL THEN[\s\S]*RETURN;/,
    );
  });

  test("every category cast is a real member of expert_rule_category", () => {
    // Guards the drift that silently killed scripts/import-knowledge-to-expert-rules.ts.
    const enumSrc = read(ENUM);
    const valid = new Set(
      [...enumSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(valid.size, "failed to parse the enum").toBeGreaterThan(5);

    const used = [...read(SEED).matchAll(/'([a-z_]+)'::expert_rule_category/g)].map((m) => m[1]);
    expect(used.length, "every rule must cast a category").toBe(GATE_SLUGS.length);
    for (const c of used) {
      expect(valid.has(c), `category '${c}' is not a member of expert_rule_category`).toBe(true);
    }
  });

  test("no third-party content leaked into the doctrine", () => {
    // Provenance rule: the gates are abstracted general practice. No foreign
    // identifiers, domains, or personal data may ride along into the KB/RAG corpus.
    const seed = read(SEED);
    for (const forbidden of [/duargema/i, /\bwpml\b/i, /houzez/i, /\bNIF\b/]) {
      expect(seed, `third-party marker ${forbidden} must not appear in the seed`).not.toMatch(
        forbidden,
      );
    }
  });
});

describe("agent operations gates — enforcement exists", () => {
  /** Every `.claude/hooks/<name>` path named in the seed's ai_instructions. */
  const hooksNamedInSeed = (): string[] => {
    const seed = read(SEED);
    return [...new Set([...seed.matchAll(/\.claude\/hooks\/([a-z0-9-]+\.(?:sh|mjs))/g)].map((m) => m[1]))];
  };

  test("every enforcement hook named by a rule exists and is executable", () => {
    const named = hooksNamedInSeed();
    expect(named.length, "rules must name their enforcement hooks").toBeGreaterThanOrEqual(8);
    for (const hook of named) {
      const p = join(ROOT, ".claude/hooks", hook);
      expect(existsSync(p), `enforcement hook missing: ${hook}`).toBe(true);
      expect(() => accessSync(p, constants.X_OK), `hook not executable: ${hook}`).not.toThrow();
    }
  });

  test("every enforcement hook named by a rule is wired into settings.json", () => {
    const settings = read(SETTINGS);
    for (const hook of hooksNamedInSeed()) {
      expect(settings, `hook not registered in settings.json: ${hook}`).toContain(hook);
    }
  });

  test("settings.json stays valid JSON with the advisory hooks registered", () => {
    const parsed = JSON.parse(read(SETTINGS)) as {
      hooks: Record<string, Array<{ hooks?: Array<{ _aisha?: { rule?: string; kind?: string } }> }>>;
    };
    const rules = new Set<string>();
    for (const entries of Object.values(parsed.hooks)) {
      for (const e of entries) {
        for (const h of e.hooks ?? []) {
          if (h._aisha?.kind === "advisory" && h._aisha.rule) rules.add(h._aisha.rule);
        }
      }
    }
    for (const rule of [
      "repo-state",
      "context-reuse",
      "scope-adjacency",
      "retry-loop",
      "closure-backlog",
      "open-state",
      "impact-consistency",
      "placeholder-cmd",
      "i18n",
    ]) {
      expect(rules.has(rule), `advisory rule not registered: ${rule}`).toBe(true);
    }
  });

  test("advisory-only invariant: expert-plane hooks warn, they never block", () => {
    // Dirigent has an opinion, not authority. A non-zero exit would block the tool
    // call — that power belongs to CI and repo-safety hooks (block-baseline-edit.sh).
    for (const hook of hooksNamedInSeed()) {
      if (hook === "block-baseline-edit.sh") continue; // the one intentional hard block
      const src = read(join(".claude/hooks", hook));
      expect(src, `${hook} must declare itself advisory`).toMatch(/advisory only/i);
      expect(src, `${hook} must never exit non-zero (would block the tool call)`).not.toMatch(
        /^\s*exit\s+[1-9]/m,
      );
    }
  });

  test("closure + open-state enforcement runs on Stop, not mid-flight", () => {
    const parsed = JSON.parse(read(SETTINGS)) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const stopCmds = (parsed.hooks.Stop ?? [])
      .flatMap((e) => e.hooks ?? [])
      .map((h) => h.command ?? "")
      .join(" ");
    expect(stopCmds).toContain("aisha-advise-closure-backlog.sh");
    expect(stopCmds).toContain("aisha-advise-open-state.sh");
  });

  test("enforcement hooks survive gen:ide regeneration (managed:true ⇒ generator SoT)", () => {
    // .claude/settings.json is a GENERATED artifact: the gen:ide merge drops every
    // entry marked _aisha.managed:true and re-emits managed entries solely from the
    // generator SoT (aisha/db/seed/claude_hook_bindings.json + the adapter's static
    // list). A hook that is managed:true but unknown to the generator is therefore
    // silently DELETED on the next regeneration — the exact failure mode a
    // conformance gate exists to prevent. Found by an aisha-advisor review.
    const bindingsFile = JSON.parse(read("aisha/db/seed/claude_hook_bindings.json")) as {
      bindings: Array<{ rule_slug?: string }>;
    };
    const generatorRules = new Set(bindingsFile.bindings.map((b) => b.rule_slug).filter(Boolean));
    generatorRules.add("i18n"); // pushed statically by adapter-claude-overlay.mjs

    const parsed = JSON.parse(read(SETTINGS)) as {
      hooks: Record<
        string,
        Array<{ hooks?: Array<{ command?: string; _aisha?: { rule?: string; managed?: boolean } }> }>
      >;
    };
    const seedHooks = new Set(hooksNamedInSeed());
    for (const entries of Object.values(parsed.hooks)) {
      for (const e of entries) {
        for (const h of e.hooks ?? []) {
          const file = /\.claude\/hooks\/([a-z0-9-]+\.sh)/.exec(h.command ?? "")?.[1];
          if (!file || !seedHooks.has(file)) continue;
          if (h._aisha?.managed === true) {
            expect(
              generatorRules.has(h._aisha.rule ?? ""),
              `${file} is managed:true but absent from claude_hook_bindings.json — the next gen:ide run deletes it. ` +
                `Either register it in the generator SoT or drop managed:true (user-maintained).`,
            ).toBe(true);
          }
        }
      }
    }
  });

  test("the hard half of impact-consistency is a real block, not an advisory", () => {
    // Baselines are never rewritten retroactively — that one is enforced, not suggested.
    const blocker = read(".claude/hooks/block-baseline-edit.sh");
    expect(blocker).toMatch(/baseline/i);
    expect(blocker, "the baseline blocker must actually be able to block").toMatch(
      /exit\s+[1-9]|"decision":\s*"block"|permissionDecision/,
    );
  });
});

/**
 * AISHA Self-Tooling Gate Tests
 *
 * Static analysis META-2 vrstvy: AISHA's self-authored skills/hooks/commands
 * (z docs/deploy/AISHA_SELF_TOOLING.md). Validuje:
 *
 * 1. Migrace aisha_self_tooling_proposals existuje + má správné kolony
 * 2. WF_AISHA_TOOLING_OBSERVER existuje + má required nodes
 * 3. RPCs `propose_tooling_artifact`, `lock_tooling_proposal`,
 *    `update_tooling_proposal_status`, `get_pending_tooling_proposals`,
 *    `get_tooling_proposal_count_pending` existují v migraci
 * 4. SKILL.md frontmatter validní pro každý skill v .claude/skills/
 * 5. Hook scripts mají bash shebang + reagují na CLAUDE_HOOK_TOOL_INPUT
 * 6. .claude/settings.json hook entries mají platnou matcher syntax
 * 7. Spec dokument AISHA_SELF_TOOLING.md exists + má required sections
 *
 * Související specs:
 *   docs/deploy/AISHA_SELF_TOOLING.md
 *   docs/deploy/APPSMITH_AISHA_OPS.md (admin approve/reject UI)
 *
 * Spouští se přes: npm run test:gates -- aisha-self-tooling
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

const SELF_TOOLING_MIGRATION = join(
  ROOT,
  "aisha/db/migrations/00000000000000_baseline.sql"
);
const TOOLING_OBSERVER_WF = join(
  ROOT,
  "n8n/workflows/WF_AISHA_TOOLING_OBSERVER.json"
);
const SELF_TOOLING_SPEC = join(ROOT, "docs/deploy/AISHA_SELF_TOOLING.md");
const SKILLS_DIR = join(ROOT, ".claude/skills");
const HOOKS_DIR = join(ROOT, ".claude/hooks");
const SETTINGS_JSON = join(ROOT, ".claude/settings.json");

// Downstream loop (the closing edge the META-2 architecture depends on):
const FACTORY_WORKFLOWS = [
  join(ROOT, "n8n/workflows/WF_AISHA_SKILL_FACTORY.json"),
  join(ROOT, "n8n/workflows/WF_AISHA_HOOK_FACTORY.json"),
  join(ROOT, "n8n/workflows/WF_AISHA_COMMAND_FACTORY.json"),
];
const TOOLING_COMMITTER_WF = join(ROOT, "n8n/workflows/WF_AISHA_TOOLING_COMMITTER.json");
const APPSMITH_BUILDER = join(ROOT, "scripts/build-aisha-appsmith.mjs");
const OPS_DASHBOARD_TEMPLATE = join(ROOT, "appsmith/dashboards/aisha-ops.template.json");

// The 8 self-tooling widget slots the admin approval page must render.
const SELF_TOOLING_SLOTS = [
  "statbox-pending-proposals",
  "statbox-recent-committed",
  "table-pending-proposals",
  "code-proposal-detail",
  "btn-approve-proposal",
  "btn-commit-proposal",
  "btn-reject-proposal",
  "btn-lock-proposal",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function readJsonSafe(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).filter((entry) => {
    const skillFile = join(SKILLS_DIR, entry, "SKILL.md");
    return existsSync(skillFile);
  });
}

function listHooks(): string[] {
  if (!existsSync(HOOKS_DIR)) return [];
  return readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".sh"));
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fm[key] = value;
  }
  return fm;
}

// ─── 1. Migration tooling proposals ──────────────────────────────────────────

describe("AISHA Self-Tooling — Migration", () => {
  test("aisha_self_tooling_proposals migration exists", () => {
    expect(existsSync(SELF_TOOLING_MIGRATION)).toBe(true);
  });

  test("migration creates aisha_tooling_proposals table", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(public\.)?aisha_tooling_proposals/i);
  });

  test("migration defines all required RPC functions", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    const requiredRpcs = [
      "propose_tooling_artifact",
      "lock_tooling_proposal",
      "update_tooling_proposal_status",
      "get_pending_tooling_proposals",
      "get_tooling_proposal_count_pending",
    ];
    for (const rpc of requiredRpcs) {
      expect(sql).toMatch(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${rpc}\\b`, "i"));
    }
  });

  test("migration table has required columns", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    const requiredColumns = [
      "id",
      "proposal_kind",
      "artifact_name",
      "artifact_path",
      "artifact_content",
      "trigger_pattern",
      "occurrence_count",
      "decision_provenance",
      "approval_status",
      "approval_id",
      "committed_sha",
      "committed_at",
      "reverted_sha",
      "manual_locked",
      "proposal_bundle_id",
    ];
    for (const col of requiredColumns) {
      expect(sql, `missing column: ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  test("migration enforces proposal_kind enum (skill, hook, command)", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    expect(sql).toMatch(/proposal_kind[\s\S]*?CHECK[\s\S]*?'skill'[\s\S]*?'hook'[\s\S]*?'command'/);
  });

  test("migration enforces approval_status state machine (pending/approved/rejected/expired/committed/reverted)", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    expect(sql).toMatch(/'pending'/);
    expect(sql).toMatch(/'approved'/);
    expect(sql).toMatch(/'rejected'/);
    expect(sql).toMatch(/'expired'/);
    expect(sql).toMatch(/'committed'/);
    expect(sql).toMatch(/'reverted'/);
  });

  test("migration has UNIQUE (proposal_kind, artifact_path) constraint (dedup)", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    expect(sql).toMatch(/UNIQUE\s*\(\s*proposal_kind\s*,\s*artifact_path\s*\)/i);
  });

  test("self-tooling RPCs use SECURITY DEFINER + search_path pattern (CLAUDE.md rule)", () => {
    // Scoped to the self-tooling RPCs' own SoT files (the migration was folded into
    // the baseline; matching CREATE FUNCTION over the whole baseline would scan
    // every platform function).
    const rpcs = [
      "propose_tooling_artifact",
      "lock_tooling_proposal",
      "update_tooling_proposal_status",
      "get_pending_tooling_proposals",
      "get_tooling_proposal_count_pending",
    ];
    expect(rpcs.length).toBeGreaterThanOrEqual(5);
    for (const fn of rpcs) {
      const block = readSafe(join(ROOT, `aisha/db/sql/functions/${fn}.sql`));
      expect(block, `${fn} missing SECURITY DEFINER`).toMatch(/SECURITY\s+DEFINER/i);
      expect(block, `${fn} missing search_path`).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    }
  });

  test("migration has REVOKE ALL FROM PUBLIC + explicit GRANT (CLAUDE.md rule)", () => {
    const sql = readSafe(SELF_TOOLING_MIGRATION);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/i);
  });
});

// ─── 2. Tooling observer workflow ────────────────────────────────────────────

describe("AISHA Self-Tooling — Observer Workflow", () => {
  test("WF_AISHA_TOOLING_OBSERVER.json exists", () => {
    expect(existsSync(TOOLING_OBSERVER_WF)).toBe(true);
  });

  test("workflow JSON parses", () => {
    expect(readJsonSafe(TOOLING_OBSERVER_WF)).not.toBeNull();
  });

  test("workflow has scheduleTrigger node", () => {
    const wf = readJsonSafe(TOOLING_OBSERVER_WF) as { nodes?: Array<{ type: string }> };
    expect(wf?.nodes).toBeDefined();
    const hasSchedule = wf.nodes?.some((n) => n.type === "n8n-nodes-base.scheduleTrigger");
    expect(hasSchedule).toBe(true);
  });

  test("workflow calls get_audit_aggregates RPC", () => {
    const txt = readSafe(TOOLING_OBSERVER_WF);
    expect(txt).toMatch(/"functionName"\s*:\s*"get_audit_aggregates"/);
  });

  test("workflow has Detect Patterns code node", () => {
    const wf = readJsonSafe(TOOLING_OBSERVER_WF) as { nodes?: Array<{ name: string; type: string }> };
    const detect = wf?.nodes?.find((n) => n.name === "Detect Patterns");
    expect(detect).toBeDefined();
    expect(detect?.type).toBe("n8n-nodes-base.code");
  });

  test("workflow routes to factory webhook URLs", () => {
    const txt = readSafe(TOOLING_OBSERVER_WF);
    // Either Skill Factory, Hook Factory, or Command Factory webhook
    const hasFactoryHttp = /tooling-(skill|hook|command)-factory|aisha-(skill|hook|command)-factory|skill-factory|hook-factory|command-factory/i.test(
      txt
    );
    expect(hasFactoryHttp).toBe(true);
  });

  test("workflow logs completion via aishaRpc", () => {
    const wf = readJsonSafe(TOOLING_OBSERVER_WF) as { nodes?: Array<{ name: string; type: string }> };
    const logNode = wf?.nodes?.find(
      (n) => n.type === "n8n-nodes-aisha.aishaRpc" && /log|complet/i.test(n.name)
    );
    expect(logNode).toBeDefined();
  });
});

// ─── 3. Spec document ────────────────────────────────────────────────────────

describe("AISHA Self-Tooling — Spec doc", () => {
  test("AISHA_SELF_TOOLING.md exists", () => {
    expect(existsSync(SELF_TOOLING_SPEC)).toBe(true);
  });

  test("spec has TL;DR section", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/##\s+TL;DR/);
  });

  test("spec covers all three artifact kinds (skill, hook, command)", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/skill/i);
    expect(md).toMatch(/hook/i);
    expect(md).toMatch(/command/i);
  });

  test("spec describes Forgejo committer flow (PR-based)", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/forgejo/i);
    expect(md).toMatch(/pull request|PR/);
  });

  test("spec describes admin approval gate", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/admin/i);
    expect(md).toMatch(/approv/i);
  });

  test("spec links to AUTONOMOUS_DEPLOY_FLOW master", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/AUTONOMOUS_DEPLOY_FLOW\.md/);
  });
});

// ─── 4. Skills validation ─────────────────────────────────────────────────────

describe("AISHA Self-Tooling — Existing skills", () => {
  test("at least 5 AISHA skills exist (deploy-flow, edge-fn, migration, n8n-workflow, rpc)", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const requiredAishaSkills = [
      "aisha-deploy-flow",
      "aisha-edge-fn",
      "aisha-migration",
      "aisha-n8n-workflow",
      "aisha-rpc",
    ];
    for (const required of requiredAishaSkills) {
      expect(skills).toContain(required);
    }
  });

  test("every AISHA skill has valid frontmatter (name + description)", () => {
    const skills = listSkills().filter((s) => s.startsWith("aisha-"));
    for (const skill of skills) {
      const skillFile = join(SKILLS_DIR, skill, "SKILL.md");
      const content = readSafe(skillFile);
      const fm = parseFrontmatter(content);
      expect(fm, `${skill}: missing or invalid frontmatter`).not.toBeNull();
      expect(fm?.name, `${skill}: missing name`).toBeTruthy();
      expect(fm?.description, `${skill}: missing description`).toBeTruthy();
    }
  });

  test("every AISHA skill description is between 50 and 800 chars (good triggering)", () => {
    const skills = listSkills().filter((s) => s.startsWith("aisha-"));
    for (const skill of skills) {
      const skillFile = join(SKILLS_DIR, skill, "SKILL.md");
      const content = readSafe(skillFile);
      const fm = parseFrontmatter(content);
      const descLen = (fm?.description ?? "").length;
      expect(descLen, `${skill}: description ${descLen} chars (need 50-800)`).toBeGreaterThanOrEqual(50);
      expect(descLen, `${skill}: description ${descLen} chars (need 50-800)`).toBeLessThanOrEqual(800);
    }
  });

  test("AISHA skills have at least 3 ## sections (substantive content)", () => {
    const skills = listSkills().filter((s) => s.startsWith("aisha-"));
    for (const skill of skills) {
      const skillFile = join(SKILLS_DIR, skill, "SKILL.md");
      const content = readSafe(skillFile);
      const sections = content.match(/^##\s+/gm) ?? [];
      expect(sections.length, `${skill}: only ${sections.length} ## sections`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ─── 5. Hooks validation ──────────────────────────────────────────────────────

describe("AISHA Self-Tooling — Hook scripts", () => {
  test("at least one hook script exists", () => {
    const hooks = listHooks();
    expect(hooks.length).toBeGreaterThanOrEqual(1);
  });

  test("every hook has bash shebang", () => {
    const hooks = listHooks();
    for (const hook of hooks) {
      const content = readSafe(join(HOOKS_DIR, hook));
      expect(
        content.startsWith("#!/usr/bin/env bash") || content.startsWith("#!/bin/bash"),
        `${hook}: missing bash shebang`
      ).toBe(true);
    }
  });

  test("every TOOL hook reads CLAUDE_HOOK_TOOL_INPUT (input contract)", () => {
    // Požadavek platí pro háčky na NÁSTROJOVÝCH událostech — jen ty nějaký
    // nástrojový vstup dostanou. Háček na `Stop` se pouští na konci odpovědi,
    // kdy žádný nástroj neexistuje; vyžadovat po něm CLAUDE_HOOK_TOOL_INPUT
    // znamená nutit ho číst proměnnou, která je vždycky prázdná.
    //
    // Dřív tenhle test bral VŠECHNY soubory v .claude/hooks/ a byl zelený jen
    // proto, že do 2026-08-04 byly všechny háčky PreToolUse. První Stop háček
    // ho shodil — což nebyla vada háčku, ale předpoklad zapečený do brány.
    // Univerzum se proto ODVOZUJE z registrace v settings.json, ne z adresáře.
    const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);
    const settings = JSON.parse(readSafe(join(ROOT, ".claude/settings.json")) || "{}");
    const toolHooks = new Set<string>();
    const allRegistered = new Set<string>();

    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      for (const group of groups as Array<{ hooks?: Array<{ command?: string }> }>) {
        for (const h of group.hooks ?? []) {
          const file = (h.command ?? "").split("/").pop() ?? "";
          if (!file) continue;
          allRegistered.add(file);
          if (TOOL_EVENTS.has(event)) toolHooks.add(file);
        }
      }
    }

    // Prázdné univerzum by tenhle test proměnilo v ozdobu.
    expect(allRegistered.size).toBeGreaterThan(5);
    expect(toolHooks.size).toBeGreaterThan(5);

    for (const hook of listHooks()) {
      if (!toolHooks.has(hook)) continue;
      const content = readSafe(join(HOOKS_DIR, hook));
      expect(
        /CLAUDE_HOOK_TOOL_INPUT/.test(content),
        `${hook}: doesn't reference CLAUDE_HOOK_TOOL_INPUT`
      ).toBe(true);
    }
  });

  test("every hook uses set -euo pipefail (defensive bash)", () => {
    const hooks = listHooks();
    for (const hook of hooks) {
      const content = readSafe(join(HOOKS_DIR, hook));
      expect(
        /set -euo pipefail/.test(content),
        `${hook}: missing 'set -euo pipefail'`
      ).toBe(true);
    }
  });

  test("hooks don't shell out to network commands (security)", () => {
    const hooks = listHooks();
    const networkPatterns = /\b(curl\s|wget\s|nc\s|ssh\s|scp\s|sftp\s|rsync\s)/;
    for (const hook of hooks) {
      const content = readSafe(join(HOOKS_DIR, hook));
      expect(networkPatterns.test(content), `${hook}: uses network command in hook (security)`).toBe(
        false
      );
    }
  });
});

// ─── 6. Settings.json validation ──────────────────────────────────────────────

describe("AISHA Self-Tooling — settings.json hooks registry", () => {
  test("settings.json exists and is valid JSON", () => {
    expect(existsSync(SETTINGS_JSON)).toBe(true);
    expect(readJsonSafe(SETTINGS_JSON)).not.toBeNull();
  });

  test("hooks entries reference existing hook script files", () => {
    const settings = readJsonSafe(SETTINGS_JSON) as Record<string, unknown> | null;
    expect(settings).not.toBeNull();
    const hooksEntry = settings?.hooks as Record<string, unknown> | undefined;
    if (!hooksEntry) {
      // No hooks registered yet — OK
      return;
    }
    // Walk PreToolUse, PostToolUse, etc.
    for (const event of Object.values(hooksEntry)) {
      if (!Array.isArray(event)) continue;
      for (const hookCfg of event) {
        const hooks = (hookCfg as Record<string, unknown>).hooks as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(hooks)) continue;
        for (const h of hooks) {
          const cmd = h.command as string | undefined;
          if (!cmd) continue;
          // Extract referenced .sh file (look for .sh path)
          const shMatch = cmd.match(/([^\s]+\.sh)/);
          if (shMatch) {
            const shRef = shMatch[1].replace("${CLAUDE_PROJECT_DIR}", ROOT).replace(/^\$\{[^}]+\}/, "");
            const candidate = shRef.startsWith("/") ? shRef : join(ROOT, shRef.replace(/^\.\//, ""));
            expect(existsSync(candidate), `settings.json references missing hook: ${shMatch[1]}`).toBe(true);
          }
        }
      }
    }
  });

  test("hook matchers are valid strings (not arrays of unknown)", () => {
    const settings = readJsonSafe(SETTINGS_JSON) as Record<string, unknown> | null;
    const hooksEntry = settings?.hooks as Record<string, unknown> | undefined;
    if (!hooksEntry) return;
    for (const event of Object.values(hooksEntry)) {
      if (!Array.isArray(event)) continue;
      for (const hookCfg of event) {
        const matcher = (hookCfg as Record<string, unknown>).matcher;
        if (matcher !== undefined) {
          expect(typeof matcher).toBe("string");
        }
      }
    }
  });
});

// ─── 7. Cross-spec consistency ────────────────────────────────────────────────

describe("AISHA Self-Tooling — Cross-spec consistency", () => {
  test("AUTONOMOUS_DEPLOY_FLOW master spec exists", () => {
    expect(existsSync(join(ROOT, "docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md"))).toBe(true);
  });

  test("AISHA_SELF_TOOLING references aisha_tooling_proposals table", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/aisha_tooling_proposals/);
  });

  test("AISHA_SELF_TOOLING describes risk evaluation extension", () => {
    const md = readSafe(SELF_TOOLING_SPEC);
    expect(md).toMatch(/fn_evaluate_proposal_risk/);
    expect(md).toMatch(/tooling_commit/);
  });
});

// ─── 8. Downstream loop: factories + committer (closing edge) ─────────────────
// The observer→proposal half was already gated above; this block pins the
// render→commit half that the whole self-tooling loop depends on. Without these,
// deleting a factory or regressing the committer's status lookup would ship green.

describe("AISHA Self-Tooling — Factory + Committer workflows", () => {
  test("all three factory workflows exist and parse", () => {
    for (const wf of FACTORY_WORKFLOWS) {
      expect(existsSync(wf), `missing factory workflow: ${wf}`).toBe(true);
      expect(readJsonSafe(wf), `factory workflow not valid JSON: ${wf}`).not.toBeNull();
    }
  });

  test("each factory renders the artifact via the Anthropic Messages API", () => {
    for (const wf of FACTORY_WORKFLOWS) {
      expect(readSafe(wf), `${wf}: no Anthropic /v1/messages render call`).toMatch(/v1\/messages/);
    }
  });

  test("each factory persists rendered content via propose_tooling_artifact", () => {
    for (const wf of FACTORY_WORKFLOWS) {
      expect(readSafe(wf), `${wf}: does not call propose_tooling_artifact`).toMatch(
        /propose_tooling_artifact/
      );
    }
  });

  // Tier 1 expert-overlay seam (docs/deploy/AISHA_SELF_TOOLING.md §13):
  // each factory must fetch instance/expert KB context via mcp_search_knowledge and
  // inject it into the render prompt, with a graceful fallback (onError continue) so
  // the OSS base still renders on an empty/offline KB.
  test("each factory enriches the prompt with KB expert context (Tier 1 seam)", () => {
    for (const wf of FACTORY_WORKFLOWS) {
      const txt = readSafe(wf);
      expect(txt, `${wf}: missing mcp_search_knowledge enrichment fetch`).toMatch(
        /mcp_search_knowledge/
      );
      expect(txt, `${wf}: render prompt does not inject Fetch Expert Context`).toMatch(
        /Fetch Expert Context/
      );
    }
  });

  // Producer side of the hook-registration contract: the committer registers a hook
  // in .claude/settings.json from metadata.settings_patch (event + matcher). The HOOK
  // factory must therefore emit that patch when it proposes — otherwise the committer
  // always falls back to defaults and the factory has no say over event/matcher.
  test("hook factory emits settings.json registration metadata (event+matcher) for the committer", () => {
    const HOOK_FACTORY = join(ROOT, "n8n/workflows/WF_AISHA_HOOK_FACTORY.json");
    const txt = readSafe(HOOK_FACTORY);
    // derives a registration target...
    expect(txt, "hook factory must derive hook_event").toMatch(/hook_event/);
    expect(txt, "hook factory must derive hook_matcher").toMatch(/hook_matcher/);
    // ...and threads it to the proposal as metadata.settings_patch (what the committer reads).
    expect(
      txt,
      "hook factory must pass p_metadata.settings_patch so the committer can register the hook"
    ).toMatch(/p_metadata[\s\S]*?settings_patch/);
  });

  test("committer creates Forgejo branch + file + PR and marks committed", () => {
    expect(existsSync(TOOLING_COMMITTER_WF)).toBe(true);
    const txt = readSafe(TOOLING_COMMITTER_WF);
    expect(txt).toMatch(/\/branches/);
    expect(txt).toMatch(/\/contents\//);
    expect(txt).toMatch(/\/pulls/);
    expect(txt).toMatch(/update_tooling_proposal_status/);
    expect(txt).toMatch(/'committed'/);
  });

  // Regression guard for the status-contract bug: the committer must resolve the
  // target proposal directly by id and gate on approval_status='approved'. It must
  // NOT select via get_pending_tooling_proposals (which filters status='pending'
  // and therefore can never see an approved proposal → loop never closes).
  test("committer resolves by id + guards approved (no pending-only lookup)", () => {
    const txt = readSafe(TOOLING_COMMITTER_WF);
    expect(
      txt,
      "committer must not select its target via get_pending_tooling_proposals"
    ).not.toMatch(/get_pending_tooling_proposals/);
    expect(txt, "committer must enforce approval_status='approved'").toMatch(/approval_status/);
  });

  // Regression guard against the duplicate-implementation class: the hook→settings.json
  // registration was implemented independently in two parallel PRs. We keep the single
  // metadata-driven version (event/matcher derived from the proposal); a second branch
  // must never creep back in. Exactly ONE IF node may switch on proposal_kind==='hook'.
  test("committer has exactly one hook-kind registration branch (no duplication)", () => {
    const wf = readJsonSafe(TOOLING_COMMITTER_WF) as { nodes?: Array<{ type: string }> } | null;
    const hookIfs = (wf?.nodes ?? []).filter((n) => {
      if (n.type !== "n8n-nodes-base.if") return false;
      const s = JSON.stringify(n);
      return s.includes("proposal_kind") && /["']hook["']/.test(s);
    });
    expect(hookIfs.length, "committer must have exactly ONE hook-kind branch (no dup)").toBe(1);
  });

  // A hook proposal is TWO files, not one: the `.sh` in `.claude/hooks/` is inert
  // until it is registered in `.claude/settings.json` (an event entry with a matcher
  // + command). The committer must therefore, for proposal_kind==='hook', make a
  // SECOND commit on the same aisha/tooling/<id> branch that patches settings.json —
  // otherwise the shipped hook never fires. Skills/commands are standalone and skip it.
  describe("committer hook→settings.json second commit", () => {
    type WfNode = { name: string; type: string; parameters?: Record<string, unknown> };
    type Wf = {
      nodes?: WfNode[];
      connections?: Record<string, { main?: Array<Array<{ node: string }>> }>;
    };
    const committer = (): Wf | null => readJsonSafe(TOOLING_COMMITTER_WF) as Wf | null;
    const settingsContentNode = (wf: Wf | null, method: string): WfNode | undefined =>
      wf?.nodes?.find((n) => {
        const p = n.parameters ?? {};
        return (
          p.method === method &&
          /contents\/\.claude\/settings\.json/.test(String(p.url ?? ""))
        );
      });

    test("branches on proposal_kind === 'hook'", () => {
      const wf = committer();
      const ifNode = wf?.nodes?.find((n) => n.type === "n8n-nodes-base.if");
      expect(ifNode, "no IF node to gate hook-kind proposals").toBeDefined();
      const conds =
        (ifNode?.parameters?.conditions as
          | { conditions?: Array<{ leftValue?: string; rightValue?: unknown }> }
          | undefined) ?? {};
      const hookCond = conds.conditions?.find(
        (c) => /proposal_kind/.test(String(c.leftValue ?? "")) && c.rightValue === "hook"
      );
      expect(hookCond, "IF node doesn't compare proposal_kind to 'hook'").toBeDefined();
    });

    test("reads then patches .claude/settings.json on the proposal branch (update, not create)", () => {
      const wf = committer();
      expect(settingsContentNode(wf, "GET"), "no GET of .claude/settings.json").toBeDefined();
      const put = settingsContentNode(wf, "PUT");
      expect(put, "no PUT to .claude/settings.json (the second commit)").toBeDefined();
      const body = String((put?.parameters as { jsonBody?: string })?.jsonBody ?? "");
      // Second commit lands on the SAME aisha/tooling/<id> branch and carries the
      // existing blob sha required by Forgejo's update-file API.
      expect(body, "settings PUT must target the proposal branch").toMatch(/branch_name/);
      expect(body, "settings PUT must send the existing file sha (update, not create)").toMatch(
        /settings_sha|"sha"/
      );
    });

    test("merge is idempotent (no double-add of the same command)", () => {
      const wf = committer();
      const mergeNode = wf?.nodes?.find(
        (n) => n.type === "n8n-nodes-base.code" && /settings|hook|merge/i.test(n.name)
      );
      expect(mergeNode, "no code node merging the hook entry").toBeDefined();
      const code = String((mergeNode?.parameters as { jsCode?: string })?.jsCode ?? "");
      expect(code, "merge must existence-check before push").toMatch(/\.some\(/);
      expect(code).toMatch(/command/);
    });

    test("derives a sensible default event+matcher when the proposal carries none", () => {
      const txt = readSafe(TOOLING_COMMITTER_WF);
      expect(txt).toMatch(/PreToolUse/);
      expect(txt).toMatch(/Edit\|Write\|MultiEdit/);
    });

    test("hook branch converges back to the PR; non-hook proposals skip the patch", () => {
      const wf = committer();
      const conns = wf?.connections ?? {};
      const targets = (from: string, out = 0): string[] =>
        (conns[from]?.main?.[out] ?? []).map((c) => c.node);
      const ifName = wf?.nodes?.find((n) => n.type === "n8n-nodes-base.if")?.name ?? "";
      // false output → straight to the PR (skills/commands don't touch settings.json).
      expect(targets(ifName, 1), "non-hook branch must go straight to the PR").toContain(
        "Create Pull Request"
      );
      // patch must feed back into the PR so the hook branch isn't a dead-end.
      const put = settingsContentNode(wf, "PUT");
      expect(targets(put!.name), "settings patch must converge into the PR").toContain(
        "Create Pull Request"
      );
      // true output must actually start the read/merge/patch chain.
      expect(targets(ifName, 0).length, "hook branch must do work before the PR").toBeGreaterThan(0);
    });
  });
});

describe("AISHA Self-Tooling — Admin approval UI render", () => {
  // Regression guard for the empty-page bug: the Appsmith builder must map every
  // self-tooling slot, else the page renders zero widgets and the human
  // approve→commit gate has no operable surface.
  test("builder slotMap covers every self-tooling slot", () => {
    const builder = readSafe(APPSMITH_BUILDER);
    for (const slot of SELF_TOOLING_SLOTS) {
      expect(builder, `build-aisha-appsmith.mjs slotMap missing '${slot}'`).toMatch(
        new RegExp(`'${slot}'\\s*:`)
      );
    }
  });

  test("self-tooling page declares all slots incl. the explicit commit button", () => {
    const tpl = readJsonSafe(OPS_DASHBOARD_TEMPLATE) as {
      pageList?: Array<{ pageSlug: string; _widgetSlots?: string[] }>;
    } | null;
    const page = tpl?.pageList?.find((p) => p.pageSlug === "self-tooling");
    expect(page, "self-tooling page missing").toBeDefined();
    for (const slot of SELF_TOOLING_SLOTS) {
      expect(page?._widgetSlots ?? [], `page missing slot ${slot}`).toContain(slot);
    }
  });
});

// ─── 9. Activation wiring — credential-based, no plaintext secrets in long-running n8n ────
// The 5 workflows activate fully automatically on cold-start. SECRETS (Forgejo
// token, Anthropic key, PostgREST service key) are NOT plaintext $env in the
// always-on n8n/n8n-worker — they live in the ENCRYPTED n8n credential store,
// minted by deploy-workflows from values read ONCE in the transient
// n8n-workflow-init container. Non-secret routing vars (URLs, webhook) stay as
// ${VAR:-} compose passthroughs derived from canonical sources by the
// orchestration block. Spec: docs/deploy/AISHA_SELF_TOOLING.md §13-14.

const N8N_COMPOSE = join(ROOT, "docker-compose.coolify-n8n.yml");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");
const DEPLOY_WORKFLOWS = join(ROOT, "scripts/deploy-workflows.mjs");
const ALL_TOOLING_WF = [...FACTORY_WORKFLOWS, TOOLING_COMMITTER_WF, TOOLING_OBSERVER_WF];
// Secrets that MUST be credential-based, never plaintext $env in the workflows:
const CREDENTIAL_SECRETS = ["FORGEJO_API_TOKEN", "ANTHROPIC_API_KEY"];

describe("AISHA Self-Tooling — Activation wiring (credentials, no long-running plaintext secrets)", () => {
  // 1. Workflows must NOT read credential secrets from $env — encrypted n8n credentials.
  test("workflows do not read credential secrets from $env", () => {
    for (const wf of ALL_TOOLING_WF) {
      const txt = readSafe(wf);
      for (const s of CREDENTIAL_SECRETS) {
        expect(txt, `${wf} must not read $env.${s} (use an n8n credential)`).not.toMatch(
          new RegExp(`\\$env\\.${s}\\b`)
        );
      }
    }
  });

  test("factories use the 'Anthropic API' n8n credential", () => {
    for (const wf of FACTORY_WORKFLOWS) {
      expect(readSafe(wf), `${wf} must reference the Anthropic API credential`).toMatch(/"Anthropic API"/);
    }
  });

  test("committer uses the 'Forgejo API' n8n credential", () => {
    expect(readSafe(TOOLING_COMMITTER_WF), "committer must reference the Forgejo API credential").toMatch(
      /"Forgejo API"/
    );
  });

  // The always-on n8n + n8n-worker hold NO self-tooling secret env vars; the only
  // permitted occurrence is the single transient n8n-workflow-init bootstrap.
  test("long-running n8n/n8n-worker carry no self-tooling secret env vars", () => {
    const compose = readSafe(N8N_COMPOSE);
    for (const v of [...CREDENTIAL_SECRETS, "AISHA_POSTGREST_SERVICE_KEY"]) {
      const decls = (compose.match(new RegExp(`-\\s*${v}=`, "g")) || []).length;
      expect(
        decls,
        `${v} declared ${decls}× — must be ≤1 (transient init bootstrap only, never long-running)`
      ).toBeLessThanOrEqual(1);
    }
  });

  // ⛔ PŘEPSÁNO 2026-09-19. Dřív brána chtěla, aby pověření zakládal
  // deploy-workflows (ensureSelfToolingCredentials). Naměřeno na guru: dělal to
  // VEDLE provision-credentials, s jinou adresou PostgREST, a protože veřejné API
  // n8n 1.79 pověření nevypíše (GET → 405), zakládal je při KAŽDÉM nasazení znovu
  // (duplicity). Vlastnost, kterou brána drží TEĎ: pověření self-toolingu
  // deklaruje JEDINÝ zakladatel (provision-credentials) a deploy-workflows žádné
  // nezakládá — jen přemapuje odkazy podle mapy, kterou zakladatel zapíše.
  test("self-tooling credentials have ONE creator: provision-credentials; deploy-workflows creates none", () => {
    const provision = readSafe(join(ROOT, "scripts/n8n/provision-credentials.mjs"));
    expect(provision).toMatch(/name:\s*"AISHA PostgREST",\s*type:\s*"aishaPostgrestApi"/);
    expect(provision).toMatch(/name:\s*"Forgejo API",\s*type:\s*"httpHeaderAuth"/);
    expect(provision).toMatch(/name:\s*"Anthropic API",\s*type:\s*"httpHeaderAuth"/);
    const deploy = readSafe(DEPLOY_WORKFLOWS);
    expect(deploy, "deploy-workflows nesmí pověření zakládat").not.toMatch(/n8nApi\(\s*["'`]\/credentials/);
    expect(deploy, "deploy-workflows přemapuje podle mapy od zakladatele").toMatch(/N8N_POVERENI_MAPA/);
  });

  // Wipe / cold-reset safety: on a fresh post-wipe n8n the credentials are
  // created; on a redeploy the existing one is UPDATED to the env values (rotation
  // propagates) — never created a second time.
  test("credential creation is idempotent (wipe-safe re-mint)", () => {
    const provision = readSafe(join(ROOT, "scripts/n8n/provision-credentials.mjs"));
    expect(provision, "existující pověření se upraví, ne založí znovu").toMatch(/klient\.patch\(`\/credentials\//);
  });

  test("n8n-workflow-init carries the bootstrap secrets to mint the credentials", () => {
    const initBlock = readSafe(N8N_COMPOSE).split("n8n-workflow-init:")[1] ?? "";
    expect(initBlock).toMatch(/-\s*FORGEJO_API_TOKEN=/);
    expect(initBlock).toMatch(/-\s*ANTHROPIC_API_KEY=/);
  });

  test("non-secret routing vars are env interpolations (no hardcoded literals)", () => {
    // Invariant je „adresa se odvozuje z parametrů, nikdy natvrdo“, ne tvar
    // `${VAR:-}` stejného jména: n8n-workflow-init bere AISHA_POSTGREST_URL
    // z API_UPSTREAM_MESH (naměřeno 2026-09-17 — https://${API_DOMAIN} v meshi
    // nikdo neobsluhuje). Každý výskyt proměnné musí být CELÝ jedna interpolace.
    const compose = readSafe(N8N_COMPOSE);
    for (const v of ["AISHA_POSTGREST_URL", "FORGEJO_API_URL", "N8N_WEBHOOK_URL"]) {
      const hodnoty = [...compose.matchAll(new RegExp(`^\\s*-\\s*${v}=(.*)$`, "gm"))].map((m) => m[1].trim());
      expect(hodnoty.length, `${v}: compose ji žádné službě nepředává`).toBeGreaterThan(0);
      for (const h of hodnoty) expect(h, `${v}=${h}`).toMatch(/^\$\{[A-Z0-9_]+(:[-?][^}]*)?\}$/);
    }
  });

  test("orchestration block pushes canonical sources (parameter-derived, not hardcoded)", () => {
    const sh = readSafe(DEPLOY_INIT);
    expect(sh).toMatch(/AISHA_POSTGREST_URL.*AISHA_API_URL/);
    expect(sh).toMatch(/set_coolify_env_if.*FORGEJO_API_TOKEN/);
    expect(sh).toMatch(/set_coolify_env_if.*FORGEJO_API_URL/);
    expect(sh).not.toMatch(/"AISHA_POSTGREST_URL"\s+"https?:/);
  });
});

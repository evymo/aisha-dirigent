/**
 * Generates codex/skills/aisha-dirigent-autopilot/SKILL.md — OpenAI Codex skill definition.
 * Ported from scripts/ide-adapters/adapter-codex-skill.mjs.
 * @module
 */

import {
  autoGenHeader,
  CORE_LAWS_SLUG,
  findRuleBySlug,
  getRuleContent,
  getRulesForCategory,
  metadataFooter,
} from "./registry";

import type { IdeAdapter, InstructionPayload } from "./registry";

const meta = {
  id: "codex-skill",
  outputPath: "codex/skills/aisha-dirigent-autopilot/SKILL.md",
  description: "OpenAI Codex SKILL.md — AISHA Dirigent Autopilot",
} as const;

function generate(payload: InstructionPayload): string {
  const rules = payload.rules || [];

  let md = "";

  md += "---\n";
  md += "name: aisha-dirigent-autopilot\n";
  md += "description: Hybrid Aisha/Codex autopilot for the AISHA platform. ";
  md += "Use for planning, compliance, quality, testing, deployment gates, ";
  md += "and workspace orchestration with remote-first routing and deterministic local fallback.\n";
  md += "---\n\n";

  md += autoGenHeader(
    "AISHA Dirigent Autopilot",
    payload.ruleset?.fingerprint || null,
    payload.generated_at,
  );

  md += "## Core rules\n\n";
  md += "- Treat `AGENTS.md` as the policy source.\n";
  md += "- Prefer Aisha for planning, routing, and compliance when remote services are healthy.\n";
  md += "- Fall back to local CLI checks immediately when MCP or n8n is unavailable.\n";
  md += "- Use `smoke` lane for in-flight work and `full` lane for merge, deploy, or autonomous release actions.\n";
  md += "- Stop on failed gates and return the audit trace instead of continuing silently.\n\n";

  md += "## Default workflow\n\n";
  md += '1. Run `aisha-health --json`.\n';
  md += '2. If remote checks pass, delegate intent with `aisha-dirigent "<task>"`.\n';
  md += "3. Use `aisha-next`, `aisha-quality`, and `aisha-test --lane smoke|full` to execute the loop.\n";
  md += "4. Use `aisha-db <status|migrate|types|reset>` for DB work.\n";
  md += "5. Use `aisha-deploy --dry-run` before any trusted deploy.\n\n";

  md += "## Platform rules\n\n";

  const lawRule = findRuleBySlug(rules, CORE_LAWS_SLUG);
  if (lawRule) {
    const content = getRuleContent(lawRule);
    if (content) {
      md += content + "\n\n";
    }
  }

  const testRules = getRulesForCategory(rules, "testing_strategy");
  if (testRules.length > 0) {
    md += "## Testing\n\n";
    for (const rule of testRules.slice(0, 2)) {
      const content = getRuleContent(rule);
      if (content) {
        md += content + "\n\n";
      }
    }
  }

  const devopsRules = getRulesForCategory(rules, "devops_pipeline");
  const workflowRule = devopsRules.find(
    (r) => r.slug?.includes("workflow") || r.title?.includes("Workflow"),
  );
  if (workflowRule) {
    md += "## Workflows\n\n";
    md += getRuleContent(workflowRule) + "\n\n";
  }

  md += "## Bootstrap\n\n";
  md += "- Generate local config: `npm run dirigent:bootstrap`\n";
  md += "- Generate local MCP config too: `npm run dirigent:bootstrap:mcp`\n";
  md += "- Refresh generated IDE instructions: AISHA Dirigent sync or `npm run gen:ide`\n";
  md += "- Refresh the generated source pack: `npm run dirigent:source-pack`\n";
  md += "- Install this skill into Codex: `npm run dirigent:skill:install`\n\n";

  md += "## References\n\n";
  md += "- `references/control-plane.md`\n";
  md += "- `references/commands.md`\n";
  md += "- `references/workflow-lanes.md`\n";

  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}

export const adapterCodexSkill: IdeAdapter = { meta, generate };

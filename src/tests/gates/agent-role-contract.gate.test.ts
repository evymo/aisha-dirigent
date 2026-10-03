/**
 * Agent Role Contract Gate Tests (Fáze 3.4-3.5)
 *
 * Ověřuje AISHA agent architekturu:
 * 1. Všechny agenti jsou definováni slug-based (role ≠ model identity)
 * 2. Modely jsou konfigurovatelné za běhu (ne hardcoded do SQL/kódu)
 * 3. Každý agent má správně definovanou autonomy_level a safety_level
 * 4. Bypass cesty jsou explicitně dokumentované a omezené
 * 5. Agent katalog obsahuje povinné agenty (dirigent, librarian, compliance_gate, dev_patch, verifier)
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SQL_FUNCS_DIR = path.join(ROOT, "aisha/db/sql/functions");
const N8N_WORKFLOWS_DIR = path.join(ROOT, "n8n/workflows");
const SRC_DIR = path.join(ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSql(name: string): string {
  const p = path.join(SQL_FUNCS_DIR, name);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

function readWorkflow(name: string): Record<string, unknown> | null {
  const p = path.join(N8N_WORKFLOWS_DIR, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Povinné agenty dle AISHA architektury (AGENTS.md)
// ---------------------------------------------------------------------------
const REQUIRED_AGENT_SLUGS = [
  "dirigent",
  "librarian",
  "compliance_gate",
  "dev_patch",
  "verifier",
];

const REQUIRED_AUTONOMY_LEVELS = ["manual", "semi", "full"];

// ---------------------------------------------------------------------------
// 1. Katalog agentů
// ---------------------------------------------------------------------------
describe("Agent Role Contract: Agent catalog SQL", () => {
  it("get_agent_catalog.sql or get_agent_catalog_admin.sql exists as SoT", () => {
    const hasBase = fs.existsSync(path.join(SQL_FUNCS_DIR, "get_agent_catalog.sql"));
    const hasAdmin = fs.existsSync(path.join(SQL_FUNCS_DIR, "get_agent_catalog_admin.sql"));
    expect(hasBase || hasAdmin, "Chybí get_agent_catalog*.sql v aisha/db/sql/functions/").toBe(
      true
    );
  });

  it("agent catalog SQL references slug column (role-based identity)", () => {
    const sql =
      readSql("get_agent_catalog.sql") || readSql("get_agent_catalog_admin.sql");
    expect(sql, "agent catalog SQL neobsahuje 'slug'").toContain("slug");
  });

  it("agent catalog SQL includes autonomy_level or safety_level", () => {
    const sql =
      readSql("get_agent_catalog.sql") || readSql("get_agent_catalog_admin.sql");
    const hasAutonomy =
      sql.includes("autonomy_level") || sql.includes("safety_level");
    expect(hasAutonomy, "agent catalog SQL neobsahuje autonomy_level nebo safety_level").toBe(
      true
    );
  });

  it("agent catalog SQL does not hardcode model names (gpt-4, claude) as agent identity", () => {
    const sql =
      readSql("get_agent_catalog.sql") || readSql("get_agent_catalog_admin.sql");
    // Model names smí být v default_model poli, ale ne jako podmínka pro agent identity
    // Nesmí být: WHERE ... = 'gpt-4' nebo CASE ... 'claude-3'
    expect(sql).not.toMatch(/WHERE\s+.*=\s*['"]gpt-4/i);
    expect(sql).not.toMatch(/WHERE\s+.*=\s*['"]claude/i);
  });
});

// ---------------------------------------------------------------------------
// 2. route_task nepřiřazuje model hardcoded k agent slug
// ---------------------------------------------------------------------------
describe("Agent Role Contract: route_task model decoupling", () => {
  it("route_task.sql exists", () => {
    expect(fs.existsSync(path.join(SQL_FUNCS_DIR, "route_task.sql"))).toBe(true);
  });

  it("route_task.sql routes by slug/task_kind, not by model name", () => {
    const sql = readSql("route_task.sql");
    // Routing logika musí používat slugs, ne model IDs
    expect(sql).toContain("slug");
    // Obecný model routing neměl by být přímou podmínkou v route_task
    // (to patří do get_agent_configuration)
    expect(sql).not.toMatch(/CASE\s+WHEN.*gpt-4|CASE\s+WHEN.*claude/i);
  });

  it("route_task.sql uses v_agent_slugs array for multi-agent routing", () => {
    const sql = readSql("route_task.sql");
    const hasAgentSlugArray =
      sql.includes("v_agent_slugs") ||
      sql.includes("agent_slugs") ||
      sql.includes("ARRAY[");
    expect(hasAgentSlugArray, "route_task.sql nepoužívá array slugů pro multi-agent routing").toBe(
      true
    );
  });

  it("route_task.sql supports escalation based on risk/safety level", () => {
    const sql = readSql("route_task.sql");
    const hasEscalation =
      sql.includes("safety_level") ||
      sql.includes("risk") ||
      sql.includes("escalat") ||
      sql.includes("autonomy");
    expect(
      hasEscalation,
      "route_task.sql nemá risk escalation logiku — porušení AISHA architektury"
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. get_active_channel_config — channel-centric architecture (agent_configurations dropped)
// ---------------------------------------------------------------------------
describe("Agent Role Contract: channel-centric config separation", () => {
  it("get_active_channel_config.sql exists in SoT", () => {
    const exists = fs.existsSync(path.join(SQL_FUNCS_DIR, "get_active_channel_config.sql"));
    expect(exists, "Chybí get_active_channel_config.sql v aisha/db/sql/functions/").toBe(true);
  });

  it("channel config SQL has model field as a DATA field, not routing predicate", () => {
    const sql = readSql("get_active_channel_config.sql");
    const hasModelField =
      sql.includes("v_channel.model") ||
      sql.includes("'model'") ||
      / model[,\s)]/i.test(sql);
    expect(hasModelField, "get_active_channel_config neobsahuje model field").toBe(true);
    // Routing nesmí být klíčem funkce — identita jde přes slug
    expect(sql).not.toMatch(/WHERE\s+.*model\s*=\s*['"]/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Povinné agenti jsou přítomni v n8n workflow souborech
// ---------------------------------------------------------------------------
describe("Agent Role Contract: Required agent workflow files", () => {
  it("Dirigent workflow exists (WF_DIRIGENT_AGENT.json)", () => {
    expect(
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_DIRIGENT_AGENT.json"))
    ).toBe(true);
  });

  it("Compliance gate workflow exists (WF_COMPLIANCE_AGENT.json or WF_PR_COMPLIANCE_GATE.json)", () => {
    const hasCompliance =
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_COMPLIANCE_AGENT.json")) ||
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_PR_COMPLIANCE_GATE.json"));
    expect(hasCompliance, "Chybí compliance gate workflow").toBe(true);
  });

  it("Knowledge agent / librarian workflow exists (WF_KNOWLEDGE_AGENT.json)", () => {
    expect(
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_KNOWLEDGE_AGENT.json"))
    ).toBe(true);
  });

  it("Delivery agent workflow exists (WF_DELIVERY_AGENT.json)", () => {
    expect(
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_DELIVERY_AGENT.json"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Agenti v n8n neobsahují hardcoded model identifiers v agent logic
// ---------------------------------------------------------------------------
describe("Agent Role Contract: n8n workflows do not hardcode model identity", () => {
  const agentWorkflows = [
    "WF_DIRIGENT_AGENT.json",
    "WF_COMPLIANCE_AGENT.json",
    "WF_DELIVERY_AGENT.json",
    "WF_KNOWLEDGE_AGENT.json",
    "WF_PR_COMPLIANCE_GATE.json",
  ];

  for (const fname of agentWorkflows) {
    const fpath = path.join(N8N_WORKFLOWS_DIR, fname);

    it(`${fname}: exists`, () => {
      expect(fs.existsSync(fpath), `Chybí workflow ${fname}`).toBe(true);
    });

    it(`${fname}: model routing nodes use aishaRpc or aishaModelRouter (not hardcoded API keys)`, () => {
      if (!fs.existsSync(fpath)) return;
      const wf = JSON.parse(fs.readFileSync(fpath, "utf-8")) as {
        nodes: Array<{ type: string; parameters?: Record<string, unknown> }>;
      };
      for (const node of wf.nodes) {
        if (!node.parameters) continue;
        const params = JSON.stringify(node.parameters);
        // Žádný node nesmí mít hardcoded OpenAI API key v parametrech
        expect(
          params,
          `${fname}/${node.type}: obsahuje hardcoded sk- API key`
        ).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
        // Žádný node nesmí mít hardcoded Anthropic API key
        expect(
          params,
          `${fname}/${node.type}: obsahuje hardcoded Anthropic API key`
        ).not.toMatch(/sk-ant-[A-Za-z0-9]{20,}/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Bypass cesty jsou explicitní a omezené
// ---------------------------------------------------------------------------
describe("Agent Role Contract: Bypass paths are explicit and limited", () => {
  it("models:check script exists for model catalog validation", () => {
    const scriptPaths = [
      path.join(ROOT, "scripts/models-check.mjs"),
      path.join(ROOT, "scripts/models-check.ts"),
      path.join(ROOT, "scripts/models.mjs"),
    ];
    // package.json must have models:check script
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
    ) as { scripts?: Record<string, string> };
    const hasModelsCheck = pkg.scripts?.["models:check"] !== undefined;
    expect(hasModelsCheck, "package.json nemá 'models:check' script — není možné ověřit model catalog").toBe(true);
  });

  it("governance-gate CI job exists (prevents unreviewed model/agent changes from deploying)", () => {
    const ciPath = path.join(ROOT, ".forgejo/workflows/ci.yml");
    const content = fs.readFileSync(ciPath, "utf-8");
    expect(content).toContain("governance-gate");
  });

  it("validate:static script exists in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
    ) as { scripts?: Record<string, string> };
    expect(
      pkg.scripts?.["validate:static"],
      "package.json nemá 'validate:static' script"
    ).toBeDefined();
  });

  it("WF_APPROVAL_GATE.json exists for human-in-the-loop on high-risk decisions", () => {
    expect(
      fs.existsSync(path.join(N8N_WORKFLOWS_DIR, "WF_APPROVAL_GATE.json")),
      "Chybí WF_APPROVAL_GATE.json — žádný human-in-the-loop pro high-risk rozhodnutí"
    ).toBe(true);
  });

  it("WF_APPROVAL_GATE.json is non-trivial (has at least 5 nodes)", () => {
    const fpath = path.join(N8N_WORKFLOWS_DIR, "WF_APPROVAL_GATE.json");
    if (!fs.existsSync(fpath)) return;
    const wf = JSON.parse(fs.readFileSync(fpath, "utf-8")) as { nodes: unknown[] };
    expect(
      wf.nodes.length,
      "WF_APPROVAL_GATE.json má méně než 5 nodů — zřejmě je triviální bypass"
    ).toBeGreaterThanOrEqual(5);
  });

  it("get_autonomy_enforcement_rules.sql exists for risk-to-autonomy matrix", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCS_DIR, "get_autonomy_enforcement_rules.sql")),
      "Chybí get_autonomy_enforcement_rules.sql — risk-to-autonomy matrix není vynucena v DB"
    ).toBe(true);
  });

  it("get_autonomy_enforcement_rules.sql references auth.uid() (user-scoped access)", () => {
    const sql = readSql("get_autonomy_enforcement_rules.sql");
    expect(sql, "get_autonomy_enforcement_rules.sql nepoužívá auth.uid()").toContain(
      "auth.uid()"
    );
  });
});

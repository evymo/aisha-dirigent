/**
 * CI/CD Governance Gate Tests
 *
 * Ověřuje, že Forgejo CI/CD pipeline obsahuje povinné governance kroky:
 * - detekci db_change, n8n_workflow, security_change
 * - governance-gate job pro DB/security změny
 * - validate-n8n-workflows job pro workflow změny
 * - upload gate report artefaktu
 * - governance-gate jako závislost deploy-web
 *
 * Také ověřuje strukturální integritu všech n8n workflow JSON souborů.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { spustiSePriGovernance, ulohyNasazujiciDbZmeny, zavisiNaGovernance } from "./lib/nasazeni-db-zmen";

const ROOT = process.cwd();
const CI_YML = path.join(ROOT, ".forgejo/workflows/ci.yml");
const N8N_WORKFLOWS_DIR = path.join(ROOT, "n8n/workflows");

// ---------------------------------------------------------------------------
// Forgejo CI workflow — governance structure
// ---------------------------------------------------------------------------
describe("CI/CD Governance Gate", () => {
  describe("Forgejo CI workflow exists and is valid YAML", () => {
    it("ci.yml exists", () => {
      expect(fs.existsSync(CI_YML), "Chybí .forgejo/workflows/ci.yml").toBe(true);
    });

    it("ci.yml is non-empty", () => {
      const content = fs.readFileSync(CI_YML, "utf-8");
      expect(content.length).toBeGreaterThan(500);
    });
  });

  describe("Change detection — governance paths", () => {
    // Směrování podle cest = jeden domov (scripts/ci/zmenene-cesty.sh, volá ho ci.yml
    // i pre-push hook). Vzory cest a inicializace příznaků se čtou ODTUD; deklarace
    // výstupů jobu (`db_change: ${{ steps.changes.outputs… }}`) dál z ci.yml.
    let content: string;
    let smerovani: string;
    beforeAll(() => {
      content = fs.readFileSync(CI_YML, "utf-8");
      smerovani = fs.readFileSync(path.join(ROOT, "scripts/ci/zmenene-cesty.sh"), "utf-8");
    });

    it("ci.yml routes through the single routing script", () => {
      expect(content).toContain("scripts/ci/zmenene-cesty.sh");
    });

    it("detects db_change output (aisha/db/migrations + sql changes)", () => {
      expect(content).toContain("db_change");
      // Must detect aisha/db/migrations/ or aisha/db/sql/ changes
      expect(smerovani).toMatch(/aisha\/db\/migrations\//);
    });

    it("detects n8n_workflow output (n8n/workflows/ changes)", () => {
      expect(content).toContain("n8n_workflow");
      expect(smerovani).toMatch(/n8n\/workflows\//);
    });

    it("detects security_change output (functions + security lib)", () => {
      expect(content).toContain("security_change");
      expect(smerovani).toMatch(/src\/lib\/security\//);
    });

    it("all three new outputs are declared in detect job outputs: block", () => {
      // Exact output declarations as rendered by Forgejo Actions
      expect(content).toContain("db_change: ${{ steps.changes.outputs.db_change }}");
      expect(content).toContain("n8n_workflow: ${{ steps.changes.outputs.n8n_workflow }}");
      expect(content).toContain("security_change: ${{ steps.changes.outputs.security_change }}");
    });

    it("new variables initialised before if block", () => {
      expect(smerovani).toContain("DB_CHANGE=false");
      expect(smerovani).toContain("N8N_WORKFLOW=false");
      expect(smerovani).toContain("SECURITY_CHANGE=false");
    });
  });

  describe("governance-gate job", () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(CI_YML, "utf-8"); });

    it("governance-gate job exists", () => {
      expect(content).toContain("governance-gate:");
    });

    it("governance-gate runs when db_change or security_change", () => {
      const govSection = content.split("governance-gate:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(govSection).toContain("db_change");
      expect(govSection).toContain("security_change");
    });

    it("governance-gate runs validate:static", () => {
      const govSection = content.split("governance-gate:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(govSection).toContain("validate:static");
    });

    it("governance-gate runs DB access-flow analysis", () => {
      const govSection = content.split("governance-gate:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(govSection).toContain("access.mjs");
    });

    it("governance-gate runs source-of-truth check", () => {
      const govSection = content.split("governance-gate:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(govSection).toContain("source.mjs");
    });
  });

  describe("validate-n8n-workflows job", () => {
    let content: string;
    beforeAll(() => { content = fs.readFileSync(CI_YML, "utf-8"); });

    it("validate-n8n-workflows job exists", () => {
      expect(content).toContain("validate-n8n-workflows:");
    });

    it("validate-n8n-workflows fires on n8n_workflow changes", () => {
      const section = content.split("validate-n8n-workflows:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(section).toContain("n8n_workflow");
    });

    it("validate-n8n-workflows runs JSON validation", () => {
      const section = content.split("validate-n8n-workflows:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(section).toContain("json.load");
    });

    it("validate-n8n-workflows checks node structure", () => {
      const section = content.split("validate-n8n-workflows:")[1]?.split(/\n {2}[a-z][\w-]+:/)[0] ?? "";
      expect(section).toContain("nodes");
      expect(section).toContain("connections");
    });
  });

  /**
   * ⭐ MĚŘÍ SE VLASTNOST, NE JMÉNO ÚLOHY.
   *
   * Do 2026-08-08 tu stálo `content.split("deploy-web:")` — a když se úlohy
   * Deploy: Web / Core / Keycloak (všechny nasazovaly TUTÉŽ appku `-core`)
   * sloučily do jedné, brána zčervenala nad ZLEPŠENÍM: hledané jméno zmizelo,
   * `split` vrátil undefined a prázdný řetězec „neobsahoval" governance-gate.
   *
   * Chráněná vlastnost je přitom jasná z účelu té brány: mění-li se DB nebo
   * bezpečnost, nasazení nesmí proběhnout bez governance-gate. Kdo se tedy
   * spouští na `db_change`/`security_change`, musí na ní viset — a to se dá
   * odvodit ze spouštěče, ne z toho, jak kdo úlohu pojmenoval.
   */
  describe("nasazení DB změn visí na governance-gate", () => {
    // Univerzum a vyhodnocení podmínek: lib/nasazeni-db-zmen.ts (tamtéž proč).
    const dotcene = () => ulohyNasazujiciDbZmeny(ROOT);

    it("univerzum není prázdné (jinak by tvrzení níž byla vakuová)", () => {
      expect(
        dotcene().length,
        "žádná deploy úloha nerozhoduje podle deploy_apps ani db_change — buď se změnil detektor, nebo parser",
      ).toBeGreaterThan(0);
    });

    it("každá taková úloha závisí na governance-gate", () => {
      const hresi = dotcene().filter((u) => !zavisiNaGovernance(u.uloha)).map((u) => u.jmeno);
      expect(
        hresi,
        `tyhle úlohy nasazují DB změny BEZ governance-gate: ${hresi.join(", ")}`,
      ).toEqual([]);
    });

    it("a připouští governance-gate jako 'skipped' (když DB/security změny nebyly)", () => {
      const hresi = dotcene()
        .filter((u) => !spustiSePriGovernance(ROOT, u.uloha, "skipped"))
        .map((u) => u.jmeno);
      expect(
        hresi,
        `tyhle úlohy by se nenasadily ani tehdy, když se governance-gate legitimně přeskočila: ${hresi.join(", ")}`,
      ).toEqual([]);
    });

    it("⛔ a NEnasadí, když governance-gate selže", () => {
      const hresi = dotcene()
        .filter((u) => spustiSePriGovernance(ROOT, u.uloha, "failure"))
        .map((u) => u.jmeno);
      expect(hresi, `tyhle úlohy by nasadily i přes selhanou governance-gate: ${hresi.join(", ")}`).toEqual([]);
    });
  });


});

// ---------------------------------------------------------------------------
// n8n workflow JSON integrity
// ---------------------------------------------------------------------------
describe("n8n Workflow JSON integrity", () => {
  const workflowFiles = fs.existsSync(N8N_WORKFLOWS_DIR)
    ? fs.readdirSync(N8N_WORKFLOWS_DIR).filter((f) => f.endsWith(".json"))
    : [];

  it("n8n/workflows/ directory exists", () => {
    expect(fs.existsSync(N8N_WORKFLOWS_DIR)).toBe(true);
  });

  it("has at least one workflow JSON file", () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it.each(workflowFiles)("%s — valid JSON", (file) => {
    const content = fs.readFileSync(path.join(N8N_WORKFLOWS_DIR, file), "utf-8");
    expect(() => JSON.parse(content), `${file} není validní JSON`).not.toThrow();
  });

  it.each(workflowFiles)("%s — má nenulový nodes[] array", (file) => {
    const wf = JSON.parse(fs.readFileSync(path.join(N8N_WORKFLOWS_DIR, file), "utf-8")) as {
      nodes?: unknown[];
      connections?: unknown;
    };
    expect(Array.isArray(wf.nodes), `${file}: nodes musí být array`).toBe(true);
    expect((wf.nodes ?? []).length, `${file}: nodes nesmí být prázdný`).toBeGreaterThan(0);
  });

  it.each(workflowFiles)("%s — má connections map", (file) => {
    const wf = JSON.parse(fs.readFileSync(path.join(N8N_WORKFLOWS_DIR, file), "utf-8")) as {
      connections?: unknown;
    };
    expect(typeof wf.connections, `${file}: connections musí být object`).toBe("object");
  });

  it.each(workflowFiles)("%s — aishaRpc nody mají onError nastavení", (file) => {
    const wf = JSON.parse(fs.readFileSync(path.join(N8N_WORKFLOWS_DIR, file), "utf-8")) as {
      nodes?: Array<{ type?: string; name?: string; onError?: string }>;
    };
    const nodes = wf.nodes ?? [];
    const violations = nodes
      .filter((n) => n.type?.startsWith("n8n-nodes-aisha.") && !n.onError)
      .map((n) => n.name ?? "unnamed");
    expect(
      violations,
      `${file}: aishaRpc nody bez onError: ${violations.join(", ")}`
    ).toHaveLength(0);
  });
});

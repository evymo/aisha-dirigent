import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { spustiSePriGovernance, ulohyNasazujiciDbZmeny, zavisiNaGovernance } from "./lib/nasazeni-db-zmen";

const ROOT = path.resolve(__dirname, "../../..");
const CI_YML = path.join(ROOT, ".forgejo/workflows/ci.yml");
const DOC_OPERATOR = path.join(ROOT, "docs/operations/OPERATOR_HANDBOOK.md");
const DOC_RELEASE_EVIDENCE = path.join(ROOT, "docs/operations/RELEASE_EVIDENCE_CHECKLIST.md");
const DOC_GOVERNANCE = path.join(ROOT, "docs/governance/GOVERNANCE_INDEX.md");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("Release operations & SRE hardening", () => {
  it("operator handbook exists", () => {
    expect(fs.existsSync(DOC_OPERATOR)).toBe(true);
  });

  it("release evidence checklist exists", () => {
    expect(fs.existsSync(DOC_RELEASE_EVIDENCE)).toBe(true);
  });

  it("governance index exists", () => {
    expect(fs.existsSync(DOC_GOVERNANCE)).toBe(true);
  });

  it("operator handbook includes incident and rollback sections", () => {
    const content = read(DOC_OPERATOR).toLowerCase();
    expect(content).toContain("incident");
    expect(content).toContain("rollback");
    expect(content).toContain("approval");
  });

  it("release evidence checklist includes mandatory artifacts", () => {
    const content = read(DOC_RELEASE_EVIDENCE).toLowerCase();
    expect(content).toContain("gates-test-report.json");
    expect(content).toContain("access-flow-report.json");
    expect(content).toContain("source-truth-report.json");
  });

  /**
   * ⭐ VLASTNOST, NE JMÉNO ÚLOHY. Do 2026-08-08 tu stálo
   * `content.split("deploy-web:")` — a když se tři úlohy nad TOUŽ appkou
   * `-core` (Web/Core/Keycloak) sloučily do jedné, `split` vrátil undefined,
   * prázdný řetězec „neobsahoval" governance-gate a brána zčervenala nad
   * ZLEPŠENÍM. Chráněné je přitom tohle: kdo nasazuje změny DB/bezpečnosti,
   * nesmí to udělat bez governance-gate — a to se pozná ze SPOUŠTĚČE.
   */
  it("nasazení DB/security změn visí na governance-gate", () => {
    // Univerzum = deploy úlohy rozhodující podle deploy_apps nebo db/security
    // příznaku; podmínka se VYHODNOCUJE (lib/nasazeni-db-zmen.ts, tamtéž proč).
    const dotcene = ulohyNasazujiciDbZmeny(ROOT);
    expect(dotcene.length, "žádná deploy úloha nerozhoduje podle deploy_apps ani db_change — parser nebo detektor se změnil").toBeGreaterThan(0);
    const hresi = dotcene.filter((u) => !zavisiNaGovernance(u.uloha)).map((u) => u.jmeno);
    expect(hresi, `nasazují DB změny BEZ governance-gate: ${hresi.join(", ")}`).toEqual([]);
    const presSelhani = dotcene.filter((u) => spustiSePriGovernance(ROOT, u.uloha, "failure")).map((u) => u.jmeno);
    expect(presSelhani, `nasadí i přes selhanou governance-gate: ${presSelhani.join(", ")}`).toEqual([]);
  });
});

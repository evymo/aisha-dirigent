import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const DOC_GOVERNANCE = path.join(ROOT, "docs/governance/GOVERNANCE_INDEX.md");
const DOC_ONBOARDING_CONTRACT = path.join(
  ROOT,
  "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md",
);
const DOC_ADAPTER_PATTERN = path.join(ROOT, "docs/enterprise/SOURCE_ADAPTER_PATTERN.md");
const DOC_SOURCE_HANDBOOK = path.join(
  ROOT,
  "docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md",
);
const AGENTS_DOC = path.join(ROOT, "AGENTS.md");
const CLAUDE_DOC = path.join(ROOT, "CLAUDE.md");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("Documentation closure finalization", () => {
  it("enterprise source docs exist", () => {
    expect(fs.existsSync(DOC_ONBOARDING_CONTRACT)).toBe(true);
    expect(fs.existsSync(DOC_ADAPTER_PATTERN)).toBe(true);
    expect(fs.existsSync(DOC_SOURCE_HANDBOOK)).toBe(true);
  });

  it("governance index includes enterprise source hosting safety", () => {
    const content = read(DOC_GOVERNANCE).toLowerCase();
    expect(content).toContain("enterprise source hosting safety");
    expect(content).toContain("source onboarding contract");
  });

  it("source onboarding handbook references required enterprise docs", () => {
    const content = read(DOC_SOURCE_HANDBOOK);
    expect(content).toContain("SOURCE_ONBOARDING_CONTRACT.md");
    expect(content).toContain("SOURCE_ADAPTER_PATTERN.md");
    expect(content).toContain("GOVERNANCE_INDEX.md");
    expect(content).toContain("KNOWLEDGE_LOOP_SLA.md");
  });

  it("AGENTS includes mandatory enterprise source onboarding rule", () => {
    const content = read(AGENTS_DOC).toLowerCase();
    expect(content).toContain("enterprise source onboarding povinný");
    expect(content).toContain("source_onboarding_contract.md");
    expect(content).toContain("source_application_onboarding_handbook.md");
  });

  it("CLAUDE includes mandatory enterprise source onboarding rule", () => {
    const content = read(CLAUDE_DOC).toLowerCase();
    expect(content).toContain("enterprise source onboarding povinný");
    expect(content).toContain("source_onboarding_contract.md");
    expect(content).toContain("source_application_onboarding_handbook.md");
  });
});

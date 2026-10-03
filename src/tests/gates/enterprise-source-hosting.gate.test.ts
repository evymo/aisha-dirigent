import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const DOC_ONBOARDING = path.join(ROOT, "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md");
const DOC_ADAPTER = path.join(ROOT, "docs/enterprise/SOURCE_ADAPTER_PATTERN.md");
const GOVERNANCE_INDEX = path.join(ROOT, "docs/governance/GOVERNANCE_INDEX.md");
const DB_TABLES = path.join(ROOT, "aisha/db/sql/tables/public_chat_channels.sql");
const RPC_ONLY_GATE = path.join(ROOT, "src/tests/gates/rpc-only-data-access.gate.test.ts");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("Enterprise source hosting readiness", () => {
  it("source onboarding contract exists", () => {
    expect(fs.existsSync(DOC_ONBOARDING)).toBe(true);
  });

  it("source adapter pattern doc exists", () => {
    expect(fs.existsSync(DOC_ADAPTER)).toBe(true);
  });

  it("source onboarding contract defines all 4 classification dimensions", () => {
    const content = read(DOC_ONBOARDING).toLowerCase();
    // source_type, data_sensitivity, retention_class, legal_basis must all be defined
    expect(content).toContain("source_type");
    expect(content).toContain("data_sensitivity");
    expect(content).toContain("retention_class");
    expect(content).toContain("legal_basis");
  });

  it("source onboarding contract includes consent model and ownership rules", () => {
    const content = read(DOC_ONBOARDING).toLowerCase();
    expect(content).toContain("consent");
    expect(content).toContain("owner");
    expect(content).toContain("retention");
  });

  it("source onboarding contract defines BYOD governance flow (5 steps)", () => {
    const content = read(DOC_ONBOARDING);
    // Must include all 5 BYOD flow steps
    expect(content).toContain("UPLOAD");
    expect(content).toContain("VALIDATION");
    expect(content).toContain("INDEXING");
    expect(content).toContain("APPROVAL");
    expect(content).toContain("ACTIVATION");
  });

  it("source onboarding contract enforces multi-tenant namespace isolation", () => {
    const content = read(DOC_ONBOARDING).toLowerCase();
    expect(content).toContain("namespace");
    expect(content).toContain("quota");
    expect(content).toContain("acl");
  });

  it("source adapter pattern defines ingest normalization pipeline", () => {
    const content = read(DOC_ADAPTER).toLowerCase();
    expect(content).toContain("normalization");
    expect(content).toContain("pii");
    expect(content).toContain("metadata");
    expect(content).toContain("provenance");
  });

  it("source adapter pattern enforces namespace scope in retrieval", () => {
    const content = read(DOC_ADAPTER);
    expect(content).toContain("p_namespace");
    expect(content).toContain("namespace");
    // Must explicitly call out cross-namespace leak risk
    const lower = content.toLowerCase();
    expect(lower).toContain("cross-tenant");
  });

  it("source adapter pattern defines data products via RPC contracts (no direct from())", () => {
    const content = read(DOC_ADAPTER);
    // Must define RPC data product pattern
    expect(content).toContain("get_source_data_product");
    // Must explicitly document direct from() as forbidden
    expect(content).toContain(".from(");
    expect(content.toLowerCase()).toContain("zakázáno");
  });

  it("knowledge source config exists in channel schema (vector_store_config)", () => {
    expect(fs.existsSync(DB_TABLES)).toBe(true);
    const content = read(DB_TABLES);
    expect(content).toContain("public_chat_channels");
    expect(content).toContain("vector_store_config");
    expect(content).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("rpc-only gate test exists to enforce data access pattern", () => {
    // The enterprise source hosting relies on rpc-only enforcement
    expect(fs.existsSync(RPC_ONLY_GATE)).toBe(true);
  });

  it("governance index references enterprise source hosting", () => {
    const content = read(GOVERNANCE_INDEX).toLowerCase();
    // Governance index must map enterprise principles to enforcement
    expect(content).toContain("enterprise");
  });
});

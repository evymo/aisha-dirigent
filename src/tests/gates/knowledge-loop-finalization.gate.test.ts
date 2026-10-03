import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const DOC_KNOWLEDGE_SLA = path.join(ROOT, "docs/knowledge/KNOWLEDGE_LOOP_SLA.md");
const DOC_GOVERNANCE_INDEX = path.join(ROOT, "docs/governance/GOVERNANCE_INDEX.md");
const WF_KB_SYNC = path.join(ROOT, "n8n/workflows/WF_KB_RAGNAROK_SYNC.json");
const WF_KNOWLEDGE_AGENT = path.join(ROOT, "n8n/workflows/WF_KNOWLEDGE_AGENT.json");
const AI_CHAT_DIR = path.join(ROOT, "services/svc-ai-chat/src");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/** Concatenate all .ts files under a directory recursively. */
function readAllTs(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(".ts")) parts.push(fs.readFileSync(full, "utf-8"));
    }
  };
  walk(dir);
  return parts.join("\n");
}

describe("Knowledge loop finalization", () => {
  it("knowledge SLA doc exists", () => {
    expect(fs.existsSync(DOC_KNOWLEDGE_SLA)).toBe(true);
  });

  it("knowledge SLA defines freshness and reindex policy", () => {
    const content = read(DOC_KNOWLEDGE_SLA).toLowerCase();
    expect(content).toContain("freshness");
    expect(content).toContain("reindex");
    expect(content).toContain("decay");
  });

  it("knowledge SLA defines retrieval utility metrics", () => {
    const content = read(DOC_KNOWLEDGE_SLA).toLowerCase();
    expect(content).toContain("hit_quality_rate");
    expect(content).toContain("chunk_usefulness_score");
    expect(content).toContain("false_positive_rate");
    expect(content).toContain("false_negative_rate");
  });

  it("governance index exists and maps retrieval-first principle", () => {
    const content = read(DOC_GOVERNANCE_INDEX).toLowerCase();
    expect(content).toContain("retrieval-first");
    expect(content).toContain("enforce point");
    expect(content).toContain("owner");
  });

  it("KB sync workflow exists", () => {
    expect(fs.existsSync(WF_KB_SYNC)).toBe(true);
  });

  it("knowledge agent workflow exists", () => {
    expect(fs.existsSync(WF_KNOWLEDGE_AGENT)).toBe(true);
  });

  it("ai-chat service uses compose_context retrieval", () => {
    const content = readAllTs(AI_CHAT_DIR);
    expect(content).toContain("compose_context");
    // New v2 architecture: Fastify microservice calls PostgREST via rpcService helper.
    // We accept either supabase-style .rpc( call or the v2 rpcService( helper as evidence
    // of DB-backed retrieval.
    expect(content).toMatch(/\.rpc\(|rpcService</);
  });
});

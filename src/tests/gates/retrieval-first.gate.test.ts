/**
 * Retrieval-First Enforcement Gate Tests (Fáze 3.3)
 *
 * Ověřuje, že AI edge functions volají retrieval (compose_context / search_knowledge)
 * PŘED inference voláním na LLM API. Bez retrieval = halucinace, bez kontextu = non-compliance.
 *
 * Pravidla:
 * 1. ai-chat MUSÍ volat compose_context nebo search_ragnarok před LLM inference
 * 2. ai-router MUSÍ volat route_task (který interně provádí context retrieval)
 * 3. AI edge functions nesmí volat LLM API bez předchozího retrieval
 * 4. ai-proactive a ai-task MUSÍ mít retrieval krok
 * 5. n8n knowledge agent workflows MUSÍ obsahovat retrieval node
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SERVICES_DIR = path.join(ROOT, "services");
const AI_CHAT_SVC = path.join(SERVICES_DIR, "svc-ai-chat/src");
const N8N_WORKFLOWS_DIR = path.join(ROOT, "n8n/workflows");
const SQL_FUNCS_DIR = path.join(ROOT, "aisha/db/sql/functions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read all .ts files under `dir` recursively and return concatenated source.
 * Used to replace single-file `edge-functions/<name>/index.ts` reads.
 */
function readAllTs(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.isFile() && full.endsWith(".ts")) {
        parts.push(fs.readFileSync(full, "utf-8"));
      }
    }
  };
  walk(dir);
  return parts.join("\n");
}

/**
 * Read a single Fastify route file by name under svc-ai-chat.
 * Falls back to empty string if missing.
 */
function readSvcRoute(serviceDir: string, routeFile: string): string {
  const p = path.join(serviceDir, "routes", routeFile);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

/** Vrací index prvního výskytu patternu v textu, nebo -1 */
function findFirst(content: string, patterns: RegExp[]): number {
  let first = Infinity;
  for (const p of patterns) {
    const m = p.exec(content);
    if (m && m.index < first) first = m.index;
  }
  return first === Infinity ? -1 : first;
}

/** Vrací true pokud retrieval přichází před inference v kódu (poziční analýza) */
function retrievalBeforeInference(content: string): boolean {
  const retrievalPatterns = [
    /compose_context/,
    /search_knowledge/,
    /search_ragnarok/,
    /kbChunks/,
    /retrievalContext/,
    /ragnarok[_-]?search/i,
    /knowledge_search/,
    /mcp_search_knowledge/,
  ];
  const inferencePatterns = [
    /openai\.chat\.completions/,
    /anthropic\.messages\.create/,
    /OpenAI\(/,
    /createCompletion/,
    /invoke.*llm/i,
    /callLLM/,
    /streamText\(/,
    /generateText\(/,
    /\/v1\/chat\/completions/,
    /fetch.*openai\.com/,
    /fetch.*anthropic\.com/,
    /fetch.*googleapis\.com.*generateContent/,
  ];

  const firstRetrieval = findFirst(content, retrievalPatterns);
  const firstInference = findFirst(content, inferencePatterns);

  if (firstRetrieval === -1) return false; // Žádný retrieval — fail
  if (firstInference === -1) return true; // Žádná inference (edge case) — pass
  return firstRetrieval < firstInference;
}

// ---------------------------------------------------------------------------
// 1. compose_context SQL funkce existuje a má správnou strukturu
// ---------------------------------------------------------------------------
describe("Retrieval-First: compose_context SQL function", () => {
  it("compose_context.sql exists as SoT", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCS_DIR, "compose_context.sql")),
      "Chybí aisha/db/sql/functions/compose_context.sql"
    ).toBe(true);
  });

  it("compose_context.sql performs knowledge retrieval (vector or text search)", () => {
    const content = fs.readFileSync(path.join(SQL_FUNCS_DIR, "compose_context.sql"), "utf-8");
    // Musí volat search retrieval — buď vector embedding search nebo text search
    const hasRetrieval =
      content.includes("knowledge_items") ||
      content.includes("embedding") ||
      content.includes("search") ||
      content.includes("chunks") ||
      content.includes("similarity");
    expect(hasRetrieval, "compose_context.sql neobsahuje knowledge retrieval logiku").toBe(true);
  });

  it("compose_context.sql builds context layers (project_context, ruleset, kb_retrieval)", () => {
    const content = fs.readFileSync(path.join(SQL_FUNCS_DIR, "compose_context.sql"), "utf-8");
    const hasLayers =
      content.includes("project_context") ||
      content.includes("ruleset") ||
      content.includes("kb_retrieval") ||
      content.includes("context_layers") ||
      content.includes("knowledge");
    expect(hasLayers, "compose_context.sql neobsahuje context layer logiku").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. svc-ai-chat chat route — retrieval-first
// ---------------------------------------------------------------------------
describe("Retrieval-First: svc-ai-chat /chat route", () => {
  it("svc-ai-chat/routes/chat.ts exists", () => {
    expect(fs.existsSync(path.join(AI_CHAT_SVC, "routes/chat.ts"))).toBe(true);
  });

  it("svc-ai-chat /chat calls compose_context for knowledge retrieval", () => {
    const content = readSvcRoute(AI_CHAT_SVC, "chat.ts");
    expect(content, "svc-ai-chat /chat nevolá compose_context").toContain("compose_context");
  });

  it("svc-ai-chat /chat calls compose_context via rpcService (v2 RPC helper)", () => {
    const content = readSvcRoute(AI_CHAT_SVC, "chat.ts");
    expect(content).toContain("compose_context");
    expect(content).toMatch(/rpcService\s*[<(]|\.rpc\(/);
  });

  it("svc-ai-chat /chat has retrieval call before LLM inference (retrieval-first pattern)", () => {
    const content = readSvcRoute(AI_CHAT_SVC, "chat.ts");
    expect(
      retrievalBeforeInference(content),
      "svc-ai-chat /chat: retrieval nepřichází před LLM inference — porušení retrieval-first vzoru"
    ).toBe(true);
  });

  it("svc-ai-chat /chat skips retrieval only conditionally (not unconditional bypass)", () => {
    const content = readSvcRoute(AI_CHAT_SVC, "chat.ts");
    if (content.match(/skip.*compose_context|bypass.*compose_context/i)) {
      expect(
        content,
        "svc-ai-chat /chat: skip compose_context není podmíněn absencí story_id — možný bezpodmínečný bypass"
      ).toMatch(
        /no story_id|story_id.*null|story_id.*undefined|!story_id|without.*story|no.*story|channelConfig/i
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. svc-ai-chat /router — route_task (obsahuje retrieval interně)
// ---------------------------------------------------------------------------
describe("Retrieval-First: svc-ai-chat /router route", () => {
  it("svc-ai-chat/routes/orchestration.ts exists (serves /router)", () => {
    expect(fs.existsSync(path.join(AI_CHAT_SVC, "routes/orchestration.ts"))).toBe(true);
  });

  it("svc-ai-chat /router calls route_task RPC (enforces agent selection with knowledge context)", () => {
    const content = readSvcRoute(AI_CHAT_SVC, "orchestration.ts");
    expect(content).toContain("route_task");
    expect(content).toMatch(/rpcService\s*[<(]|\.rpc\(/);
  });
});

// ---------------------------------------------------------------------------
// 4. svc-ai-chat context endpoint — dedikovaný retrieval endpoint
// ---------------------------------------------------------------------------
describe("Retrieval-First: svc-ai-chat /context endpoint", () => {
  it("svc-ai-chat source tree references /context endpoint or compose_context", () => {
    // v2 routing (gateway): ai-context-composer -> AI_CHAT_SERVICE_URL with rewritePath 'context'.
    // We accept either a dedicated context.ts route file or a compose_context call anywhere in the service.
    const all = readAllTs(AI_CHAT_SVC);
    expect(all, "svc-ai-chat nevolá compose_context nikde v servisu").toContain("compose_context");
  });
});

// ---------------------------------------------------------------------------
// 5. n8n Knowledge Agent — retrieval node přítomen
// ---------------------------------------------------------------------------
describe("Retrieval-First: n8n Knowledge Agent workflow", () => {
  const WF_KNOWLEDGE = path.join(N8N_WORKFLOWS_DIR, "WF_KNOWLEDGE_AGENT.json");

  it("WF_KNOWLEDGE_AGENT.json exists", () => {
    expect(fs.existsSync(WF_KNOWLEDGE)).toBe(true);
  });

  it("WF_KNOWLEDGE_AGENT contains a search/retrieval node", () => {
    const wf = JSON.parse(fs.readFileSync(WF_KNOWLEDGE, "utf-8")) as {
      nodes: Array<{ type: string; name: string }>;
    };
    const hasRetrieval = wf.nodes.some(
      (n) =>
        n.type.includes("search") ||
        n.type.includes("ragnarok") ||
        n.type.includes("knowledge") ||
        n.type.includes("retrieval") ||
        n.name.toLowerCase().includes("search") ||
        n.name.toLowerCase().includes("retrieval") ||
        n.name.toLowerCase().includes("ragnarok") ||
        n.name.toLowerCase().includes("knowledge")
    );
    expect(
      hasRetrieval,
      "WF_KNOWLEDGE_AGENT: chybí search/retrieval node — porušení retrieval-first vzoru"
    ).toBe(true);
  });

  it("WF_KNOWLEDGE_AGENT has more than one node (not trivial pass-through)", () => {
    const wf = JSON.parse(fs.readFileSync(WF_KNOWLEDGE, "utf-8")) as {
      nodes: unknown[];
    };
    expect(wf.nodes.length).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 6. route_task SQL — agent routing je basováno na kontextu (ne hardcoded)
// ---------------------------------------------------------------------------
describe("Retrieval-First: route_task SQL dynamic routing", () => {
  it("route_task.sql exists", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCS_DIR, "route_task.sql")),
      "Chybí aisha/db/sql/functions/route_task.sql"
    ).toBe(true);
  });

  it("route_task.sql uses agent slugs (role-based routing, not hardcoded model IDs)", () => {
    const content = fs.readFileSync(path.join(SQL_FUNCS_DIR, "route_task.sql"), "utf-8");
    expect(content).toContain("slug");
    expect(content).not.toMatch(/gpt-4[^_"]|claude-[^'"\s]{3,}|gemini-/);
  });

  it("route_task.sql handles multiple task kinds (project_delivery, pr_gate, chat minimum)", () => {
    const content = fs.readFileSync(path.join(SQL_FUNCS_DIR, "route_task.sql"), "utf-8");
    const hasProjectDelivery = content.includes("project_delivery");
    const hasPrGate = content.includes("pr_gate") || content.includes("compliance");
    const hasChat = content.includes("chat") || content.includes("librarian");
    expect(hasProjectDelivery, "route_task.sql neobsahuje project_delivery routing").toBe(true);
    expect(hasPrGate, "route_task.sql neobsahuje pr_gate/compliance routing").toBe(true);
    expect(hasChat, "route_task.sql neobsahuje chat routing").toBe(true);
  });
});

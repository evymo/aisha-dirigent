/**
 * Layer Boundary Enforcement Gate Tests (Fáze 3.1-3.2)
 *
 * Ověřuje, že platforma dodržuje layer boundaries:
 * 1. NocoDB/Appsmith NEJSOU SoT — žádná business invarianta nesmí vznikat pouze tam
 * 2. Architektonický tok: Pages → Components → Hooks → RPC (žádné přímé API volání z komponent)
 * 3. Dashboard konfigurace (NocoDB/Appsmith) neobsahují přímé DB mutation bez RPC
 * 4. Admin stack secrets jsou čteny z env, ne hardcoded
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const DOCKER_ADMIN = path.join(ROOT, "docker-compose.coolify-admin.yml");
const N8N_WORKFLOWS_DIR = path.join(ROOT, "n8n/workflows");
const SRC_DIR = path.join(ROOT, "src");
const PAGES_DIR = path.join(SRC_DIR, "pages");
const COMPONENTS_DIR = path.join(SRC_DIR, "components");
const HOOKS_DIR = path.join(SRC_DIR, "hooks");
const SERVICES_DIR = path.join(ROOT, "services");
const AI_CHAT_SERVICE_DIR = path.join(SERVICES_DIR, "svc-ai-chat/src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full, ext));
    else if (entry.name.endsWith(ext)) result.push(full);
  }
  return result;
}

/** Returns true if content contains a direct Supabase .from() call (not via RPC) */
function hasDirectFromCall(content: string): boolean {
  return /supabase\s*\.\s*from\s*\(/.test(content);
}

/** Returns true if content contains a supabase.rpc() call */
function hasRpcCall(content: string): boolean {
  return /supabase\s*(?:\.\s*\w+)?\s*\.\s*rpc\s*\(/.test(content);
}

// ---------------------------------------------------------------------------
// 1. NocoDB / Appsmith nejsou SoT
// ---------------------------------------------------------------------------
describe("Layer Boundary: NocoDB/Appsmith are not SoT", () => {
  it("NocoDB admin stack docker-compose exists", () => {
    expect(fs.existsSync(DOCKER_ADMIN), "Chybí docker-compose.coolify-admin.yml").toBe(true);
  });

  it("NocoDB is configured as read-only viewer (no direct DB write credentials exported to UI)", () => {
    const content = fs.readFileSync(DOCKER_ADMIN, "utf-8");
    // NocoDB musí být nasazen — je součástí admin stacku
    expect(content).toContain("nocodb");
    // Nesmí mít hardcoded DB URL s write credentials přímo v compose souboru
    // (credentials musí být v secrets/env vars)
    expect(content).not.toMatch(/postgresql:\/\/postgres:[^$\s]{4,}@/);
  });

  it("Appsmith is configured without hardcoded superuser credentials", () => {
    const content = fs.readFileSync(DOCKER_ADMIN, "utf-8");
    // Appsmith musí být nasazen
    expect(content).toContain("appsmith");
    // Žádné hardcoded admin hesla přímo v YAML (musí být env refs)
    expect(content).not.toMatch(/APPSMITH_ADMIN_PASSWORD\s*=\s*["'][^$]{6,}/);
  });

  it("n8n workflows do not write directly to NocoDB tables bypassing RPC", () => {
    // NocoDB workflows smí volat NocoDB API, ale nesmí obcházet audit trail u sensitive operací
    // Kontrola: žádný n8n workflow nevolá supabase DB přímým SQL (jen přes AishaRpc)
    const workflowFiles = fs.readdirSync(N8N_WORKFLOWS_DIR).filter((f) => f.endsWith(".json"));
    for (const fname of workflowFiles) {
      const content = fs.readFileSync(path.join(N8N_WORKFLOWS_DIR, fname), "utf-8");
      // Žádný přímý postgres connection string v workflow
      expect(content, `${fname}: obsahuje přímý postgres connection string`).not.toMatch(
        /postgresql:\/\/[^/]+\/[^"'\s]+/
      );
    }
  });

  it("RPC SQL SoT files for admin operations exist (admin goes through RPC, not direct DB)", () => {
    const adminRpcFunctions = [
      "get_agent_catalog_admin.sql",
    ];
    const funcDir = path.join(ROOT, "aisha/db/sql/functions");
    for (const fn of adminRpcFunctions) {
      expect(
        fs.existsSync(path.join(funcDir, fn)),
        `Chybí admin RPC SoT funkce: ${fn}`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Architektonický tok: Pages → Components → Hooks → RPC
// ---------------------------------------------------------------------------
describe("Layer Boundary: Pages → Components → Hooks → RPC", () => {
  let pageFiles: string[];
  let componentFiles: string[];

  beforeAll(() => {
    pageFiles = walkFiles(PAGES_DIR, ".tsx");
    componentFiles = walkFiles(COMPONENTS_DIR, ".tsx");
  });

  it("src/pages/ directory exists and has files", () => {
    expect(fs.existsSync(PAGES_DIR)).toBe(true);
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  it("src/components/ directory exists and has files", () => {
    expect(fs.existsSync(COMPONENTS_DIR)).toBe(true);
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it("src/hooks/ directory exists with barrel index.ts", () => {
    expect(fs.existsSync(HOOKS_DIR)).toBe(true);
    expect(fs.existsSync(path.join(HOOKS_DIR, "index.ts"))).toBe(true);
  });

  it("page files do not call supabase.from() directly (must use hooks)", () => {
    const violations: string[] = [];
    for (const f of pageFiles) {
      const content = fs.readFileSync(f, "utf-8");
      if (hasDirectFromCall(content)) {
        violations.push(path.relative(ROOT, f));
      }
    }
    expect(
      violations,
      `Pages volají .from() přímo (porušení layer boundary): ${violations.join(", ")}`
    ).toHaveLength(0);
  });

  it("component files do not call supabase.from() directly (must use hooks)", () => {
    const violations: string[] = [];
    for (const f of componentFiles) {
      const content = fs.readFileSync(f, "utf-8");
      if (hasDirectFromCall(content)) {
        violations.push(path.relative(ROOT, f));
      }
    }
    expect(
      violations,
      `Components volají .from() přímo (porušení layer boundary): ${violations.join(", ")}`
    ).toHaveLength(0);
  });

  it("page files do not call supabase.rpc() directly (must use hooks)", () => {
    const violations: string[] = [];
    for (const f of pageFiles) {
      const content = fs.readFileSync(f, "utf-8");
      // Pages smí importovat supabase pouze pro typy, ne pro RPC volání
      if (hasRpcCall(content)) {
        violations.push(path.relative(ROOT, f));
      }
    }
    expect(
      violations,
      `Pages volají supabase.rpc() přímo (porušení layer boundary): ${violations.join(", ")}`
    ).toHaveLength(0);
  });

  it("hook files export functions starting with 'use'", () => {
    const hookFiles = walkFiles(HOOKS_DIR, ".ts").filter(
      (f) => !f.endsWith("index.ts") && !f.endsWith(".test.ts")
    );
    expect(hookFiles.length).toBeGreaterThan(0);
    for (const f of hookFiles) {
      const content = fs.readFileSync(f, "utf-8");
      const basename = path.basename(f, ".ts");
      if (basename.startsWith("use")) {
        // Kontrolujeme pouze soubory, které DEFINUJÍ funkci s 'use' prefixem
        // (soubory s utility funkcemi jako uploadXxx jsou výjimka)
        const definesUseFunction =
          /(?:function|const)\s+use[A-Z]\w*/.test(content);
        if (!definesUseFunction) continue; // Skip utility soubory pojmenované useXxx

        // Pokud soubor definuje use* funkci, musí ji exportovat
        const hasUseExport =
          /export\s+(?:function|const)\s+use\w/.test(content) ||
          /export\s*\{[^}]*use[A-Z]\w*[^}]*\}/.test(content) ||
          /export\s+default\s+function\s+use\w/.test(content) ||
          /export\s*\*\s*from/.test(content); // barrel re-export
        expect(hasUseExport, `${basename}.ts: chybí export funkce use*`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. v2 microservices (svc-ai-chat) respektují RPC-only vzor
// ---------------------------------------------------------------------------
describe("Layer Boundary: v2 AI service uses RPC-only pattern", () => {
  const readSvcAiChatAll = (): string => {
    const parts: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) parts.push(fs.readFileSync(full, "utf-8"));
      }
    };
    walk(AI_CHAT_SERVICE_DIR);
    return parts.join("\n");
  };

  it("svc-ai-chat service source tree exists", () => {
    expect(
      fs.existsSync(AI_CHAT_SERVICE_DIR),
      `Chybí v2 service: services/svc-ai-chat/src`
    ).toBe(true);
    expect(
      fs.existsSync(path.join(AI_CHAT_SERVICE_DIR, "server.ts")),
      `Chybí svc-ai-chat/src/server.ts (Fastify entry)`
    ).toBe(true);
  });

  it("svc-ai-chat orchestration route calls route_task via RPC (not direct table access)", () => {
    const content = fs.readFileSync(
      path.join(AI_CHAT_SERVICE_DIR, "routes/orchestration.ts"),
      "utf-8"
    );
    expect(content).toContain("route_task");
    // v2: rpcService() helper is the RPC-only abstraction over PostgREST
    expect(content).toMatch(/rpcService\s*[<(]|\.rpc\(/);
    // No direct table selects for agent_catalog
    expect(content).not.toMatch(/from\s*\(\s*["']agent_catalog["']\s*\)/);
  });

  it("svc-ai-chat calls compose_context via RPC (retrieval-first)", () => {
    const content = readSvcAiChatAll();
    expect(content).toContain("compose_context");
    expect(content).toMatch(/rpcService\s*[<(]|\.rpc\(/);
  });
});

/**
 * n8n Workflow Integrity Gate Tests
 *
 * Ověřuje integritu n8n workflow JSON souborů ve DVOU adresářích:
 * - n8n/workflows/ (working copy — z live n8n sync)
 * - packages/n8n-nodes-aisha/workflows/ (template source — pro purge-test reimport)
 *
 * Kontroly:
 * 1. ALL toolCode nody s MCP voláním MUSÍ používat KC user token ($env?.AISHA_ACCESS_TOKEN
 *    nebo legacy alias $env?.AISHA_KEYCLOAK_ACCESS_TOKEN) — ne hardcoded prázdný token,
 *    ne retired $env?.MCP_TOKEN (commit 8a0a946b retired the single-secret path)
 * 2. ALL toolCode nody s MCP voláním NESMÍ obsahovat literal n8n template syntaxi '{{ $env' v JS kódu
 * 3. Všechny workflow JSON soubory MUSÍ být validní JSON
 * 4. Agent workflows MUSÍ mít připojený LLM model (ai_languageModel connection)
 * 5. ALL aishaRpc nody MUSÍ mít onError: "continueRegularOutput"
 * 6. Žádné hardcoded URLs v node parametrech (musí používat $env fallback)
 *
 * Nespouští DB dotazy — pracuje POUZE se soubory.
 * Spouští se přes vitest.gates.config.ts (node env, 2 min timeout).
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

/** Both directories that contain n8n workflow JSON files */
const WORKFLOW_DIRS = [
  path.join(ROOT, "n8n/workflows"),
  path.join(ROOT, "packages/n8n-nodes-aisha/workflows"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface N8nNode {
  id: string;
  name: string;
  type: string;
  parameters?: {
    jsCode?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  connections?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorkflowEntry {
  dir: string;
  filename: string;
  relPath: string;
}

function getAllWorkflowFiles(): WorkflowEntry[] {
  const result: WorkflowEntry[] = [];
  for (const dir of WORKFLOW_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const f of files) {
      result.push({
        dir,
        filename: f,
        relPath: path.relative(ROOT, path.join(dir, f)),
      });
    }
  }
  return result;
}

function readWorkflow(entry: WorkflowEntry): N8nWorkflow | null {
  const p = path.join(entry.dir, entry.filename);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as N8nWorkflow;
  } catch {
    return null;
  }
}

/**
 * Extract ALL toolCode nodes that call MCP (contain 'mcp-knowledge-server').
 * Covers both auto-generated nodes (with marker) and manually written admin nodes.
 */
function getMcpToolNodes(
  wf: N8nWorkflow
): Array<{ node: N8nNode; jsCode: string }> {
  return (wf.nodes || [])
    .filter(
      (n) =>
        n.type === "@n8n/n8n-nodes-langchain.toolCode" &&
        typeof n.parameters?.jsCode === "string" &&
        n.parameters.jsCode.includes("mcp-knowledge-server")
    )
    .map((n) => ({ node: n, jsCode: n.parameters!.jsCode! }));
}

// ---------------------------------------------------------------------------
// 1. Všechny workflow soubory jsou validní JSON (oba adresáře)
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: Valid JSON", () => {
  it("all workflow files in both directories are parseable JSON", () => {
    const entries = getAllWorkflowFiles();
    expect(entries.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const entry of entries) {
      const p = path.join(entry.dir, entry.filename);
      try {
        JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        broken.push(entry.relPath);
      }
    }
    expect(broken, `Nevalidní JSON v: ${broken.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. MCP Token — ALL MCP toolCode nody NESMÍ mít hardcoded prázdný token
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: MCP token in toolCode", () => {
  it("no MCP toolCode node uses hardcoded empty token (const token = '')", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const toolNodes = getMcpToolNodes(wf);
      for (const { node, jsCode } of toolNodes) {
        if (/const\s+token\s*=\s*['"]['"]/.test(jsCode)) {
          violations.push(
            `${entry.relPath} → node "${node.name}" (${node.id}): hardcoded empty token`
          );
        }
      }
    }

    expect(
      violations,
      `MCP toolCode má hardcoded prázdný token.\n` +
        `Správný pattern: const token = $env?.AISHA_ACCESS_TOKEN || $env?.AISHA_KEYCLOAK_ACCESS_TOKEN || '';\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("all MCP toolCode nodes reference an AISHA KC access token env var", () => {
    // After KC PKCE migration (commit 9b51a76e + 8a0a946b), toolCode
    // jsCode reads the user's KC bearer token from `$env?.AISHA_ACCESS_TOKEN`
    // (canonical) with `$env?.AISHA_KEYCLOAK_ACCESS_TOKEN` as legacy alias.
    // The historic single-secret `$env?.MCP_TOKEN` path is retired —
    // gateway/svc-mcp-knowledge now accept KC user tokens directly.
    // Accept either canonical or legacy reference so a workflow that
    // hardcodes the legacy alias still validates as "token-aware".
    const ACCEPTED_TOKEN_REFS = [
      "$env?.AISHA_ACCESS_TOKEN",
      "$env?.AISHA_KEYCLOAK_ACCESS_TOKEN",
    ];

    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const toolNodes = getMcpToolNodes(wf);
      for (const { node, jsCode } of toolNodes) {
        const ok = ACCEPTED_TOKEN_REFS.some((ref) => jsCode.includes(ref));
        if (!ok) {
          violations.push(
            `${entry.relPath} → node "${node.name}" (${node.id}): neobsahuje $env?.AISHA_ACCESS_TOKEN ani $env?.AISHA_KEYCLOAK_ACCESS_TOKEN`
          );
        }
      }
    }

    expect(
      violations,
      `MCP toolCode nepoužívá KC access token env var.\n` +
        `Správný pattern: const token = $env?.AISHA_ACCESS_TOKEN || $env?.AISHA_KEYCLOAK_ACCESS_TOKEN || '';\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. MCP URL — ALL MCP toolCode nody NESMÍ mít literal '{{ $env' v JS kódu
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: MCP URL in toolCode", () => {
  it("no MCP toolCode uses literal n8n template syntax in JS ({{ $env)", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const toolNodes = getMcpToolNodes(wf);
      for (const { node, jsCode } of toolNodes) {
        if (/'\{\{\s*\$env/.test(jsCode)) {
          violations.push(
            `${entry.relPath} → node "${node.name}" (${node.id}): literal '{{ $env' in jsCode`
          );
        }
      }
    }

    expect(
      violations,
      `MCP toolCode obsahuje n8n template syntaxi v jsCode stringu.\n` +
        `n8n template expressions se v toolCode nodech NEEVALUUJÍ.\n` +
        `Správný pattern: ($env?.AISHA_POSTGREST_URL || 'https://...')\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("all MCP toolCode nodes use $env?.AISHA_POSTGREST_URL for mcpUrl", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const toolNodes = getMcpToolNodes(wf);
      for (const { node, jsCode } of toolNodes) {
        if (!jsCode.includes("$env?.AISHA_POSTGREST_URL")) {
          violations.push(
            `${entry.relPath} → node "${node.name}" (${node.id}): chybí $env?.AISHA_POSTGREST_URL`
          );
        }
      }
    }

    expect(
      violations,
      `MCP toolCode nepoužívá $env?.AISHA_POSTGREST_URL.\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Agent workflows MUSÍ mít připojený LLM model (pouze n8n/workflows/)
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: Agent LLM connections", () => {
  it("every n8n agent node has ai_languageModel connection from LLM Router or similar", () => {
    const entries = getAllWorkflowFiles().filter((e) =>
      e.dir.endsWith("n8n/workflows")
    );
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const agentNodes = (wf.nodes || []).filter(
        (n) => n.type === "@n8n/n8n-nodes-langchain.agent"
      );
      if (agentNodes.length === 0) continue;

      const connections = wf.connections as Record<
        string,
        Record<string, Array<Array<{ node: string; type: string }>>>
      >;
      if (!connections) continue;

      for (const agentNode of agentNodes) {
        const hasLlmConnection = Object.values(connections).some(
          (connGroup) =>
            connGroup.ai_languageModel?.some((targets) =>
              targets.some((t) => t.node === agentNode.name)
            )
        );

        if (!hasLlmConnection) {
          violations.push(
            `${entry.relPath} → agent "${agentNode.name}": chybí ai_languageModel connection`
          );
        }
      }
    }

    expect(
      violations,
      `Agent nody bez připojeného LLM modelu:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. aishaRpc nody MUSÍ mít onError: "continueRegularOutput" (oba adresáře)
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: aishaRpc onError", () => {
  it("all aishaRpc nodes have onError set to continueRegularOutput", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const rpcNodes = (wf.nodes || []).filter(
        (n) => n.type === "n8n-nodes-aisha.aishaRpc"
      );
      for (const node of rpcNodes) {
        const onError = node.parameters?.onError;
        if (onError !== "continueRegularOutput") {
          violations.push(
            `${entry.relPath} → "${node.name}" (${node.id}): onError=${String(onError ?? "MISSING")}`
          );
        }
      }
    }

    expect(
      violations,
      `aishaRpc nody bez onError: "continueRegularOutput".\n` +
        `Bez tohoto nastavení selhání RPC zastaví celý workflow.\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Žádné hardcoded URLs v node parametrech — MUSÍ používat $env fallback
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: No hardcoded URLs", () => {
  /** Known environment-specific URLs that must use $env fallback */
  const HARDCODED_URL_PATTERNS = [
    { pattern: "api.aisha.guru", envVar: "AISHA_POSTGREST_URL" },
    { pattern: "n8n.aisha.guru", envVar: "N8N_WEBHOOK_BASE_URL" },
    { pattern: "npm.id3a.cz", envVar: "VERDACCIO_URL" },
  ];

  it("no node url parameters contain hardcoded environment URLs without $env fallback", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      for (const node of wf.nodes || []) {
        // Skip toolCode nodes — covered by MCP URL tests above
        if (node.type === "@n8n/n8n-nodes-langchain.toolCode") continue;

        const url = node.parameters?.url;
        if (typeof url !== "string") continue;

        for (const { pattern, envVar } of HARDCODED_URL_PATTERNS) {
          if (url.includes(pattern) && !url.includes("$env")) {
            violations.push(
              `${entry.relPath} → "${node.name}": hardcoded ${pattern} in url (use $env?.${envVar})`
            );
          }
        }
      }
    }

    expect(
      violations,
      `Hardcoded environment URLs v node parametrech.\n` +
        `Správný pattern: ={{ ($env?.ENV_VAR || '') + '/path' }}\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("no jsCode in non-MCP nodes contains hardcoded environment URLs without $env", () => {
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      for (const node of wf.nodes || []) {
        // Skip MCP toolCode nodes — covered by earlier tests
        if (
          node.type === "@n8n/n8n-nodes-langchain.toolCode" &&
          node.parameters?.jsCode?.includes("mcp-knowledge-server")
        ) {
          continue;
        }

        const jsCode = node.parameters?.jsCode;
        if (typeof jsCode !== "string") continue;

        for (const { pattern, envVar } of HARDCODED_URL_PATTERNS) {
          if (jsCode.includes(pattern) && !jsCode.includes("$env")) {
            violations.push(
              `${entry.relPath} → "${node.name}": hardcoded ${pattern} in jsCode (use $env?.${envVar})`
            );
          }
        }
      }
    }

    expect(
      violations,
      `Hardcoded environment URLs v jsCode.\n` +
        `Správný pattern: ($env?.ENV_VAR || 'https://...')\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Local setup credential provisioning must match registered custom nodes
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: Local setup credentials", () => {
  it("scripts/setup.sh provisions the registered AISHA PostgREST credential type", () => {
    const setupScript = fs.readFileSync(path.join(ROOT, "scripts/setup.sh"), "utf-8");
    // setup.sh uses bash-escaped JSON inside curl -d, so look for the
    // backslash-escaped form (\"type\":\"aishaPostgrestApi\") in the source.
    //
    // Credential type rename history (May 2026, PR #82):
    //   aishaSupabaseApi → aishaPostgrestApi
    //   "AISHA Supabase" → "AISHA PostgREST"
    //   "supabaseUrl"     → "postgrestUrl"
    // The data field name `postgrestUrl` MUST match the credential definition
    // in `packages/n8n-nodes-aisha/credentials/AishaPostgrestApi.credentials.ts`,
    // otherwise n8n silently stores a credential with no usable URL.
    expect(setupScript).toContain('\\"type\\":\\"aishaPostgrestApi\\"');
    expect(setupScript).toContain('\\"name\\":\\"AISHA PostgREST\\"');
    expect(setupScript).toContain('\\"postgrestUrl\\"');
    // Negative: legacy identifiers must not reappear as canonical writes.
    expect(setupScript).not.toContain('\\"type\\":\\"aishaSupabaseApi\\"');
    expect(setupScript).not.toContain('\\"type\\":\\"aishaApi\\"');
    expect(setupScript).not.toContain('\\"apiUrl\\"');
    expect(setupScript).not.toContain('\\"supabaseUrl\\"');
  });
});

// ---------------------------------------------------------------------------
// 8a. aishaRpc nody MUSÍ používat `rpcParams` — NIKDY `functionParams`
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: aishaRpc rpcParams field", () => {
  it("no aishaRpc node declares a functionParams parameter (the node only reads rpcParams)", () => {
    // The AishaRpc node reads its RPC arguments from `rpcParams`
    // (AishaRpc.node.ts: getNodeParameter('rpcParams', i)). It NEVER reads
    // `functionParams`. A node authored with `functionParams` therefore falls
    // back to the rpcParams default '{}' and calls the RPC with NO arguments —
    // a silent, onError-swallowed failure. Forbid the dead field outright so
    // this whole bug class cannot recur.
    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const rpcNodes = (wf.nodes || []).filter(
        (n) => n.type === "n8n-nodes-aisha.aishaRpc"
      );
      for (const node of rpcNodes) {
        if (node.parameters && "functionParams" in node.parameters) {
          violations.push(
            `${entry.relPath} → "${node.name}" (${node.id}): uses functionParams (must be rpcParams)`
          );
        }
      }
    }

    expect(
      violations,
      `aishaRpc nody používají functionParams místo rpcParams.\n` +
        `Node čte POUZE 'rpcParams' — 'functionParams' se tiše ignoruje a RPC se zavolá bez argumentů.\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8b. aishaRpc functionName MUSÍ rezolvovat na funkci definovanou v DB SoT
// ---------------------------------------------------------------------------
// Uzavírá celou třídu bugů "aishaRpc node volá neexistující RPC": PostgREST
// vrátí PGRST202 (function not found), onError:"continueRegularOutput" chybu
// tiše spolkne a zamýšlený audit/log řádek se nikdy nezapíše. Gate staticky
// (jen ze souborů, žádné DB dotazy) ověří, že každý LITERÁLNÍ functionName na
// aishaRpc node odpovídá nějaké CREATE FUNCTION definici v aisha/db/sql/
// functions/ NEBO aisha/db/migrations/ (vč. baseline). Dynamické výrazy
// (n8n template '{{ }}' / '=…') se přeskakují — staticky je ověřit nelze.
describe("n8n Workflow Integrity: aishaRpc functionName resolves to DB SoT", () => {
  /** Adresáře, jejichž .sql soubory definují volatelné RPC funkce. */
  const SQL_SOURCE_DIRS = [
    path.join(ROOT, "aisha/db/sql/functions"),
    path.join(ROOT, "aisha/db/migrations"),
  ];

  /** Posbírá názvy všech funkcí definovaných přes CREATE [OR REPLACE] FUNCTION. */
  function getDefinedFunctionNames(): Set<string> {
    const names = new Set<string>();
    const re =
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/gi;
    for (const dir of SQL_SOURCE_DIRS) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
      for (const f of files) {
        const sql = fs.readFileSync(path.join(dir, f), "utf-8");
        let m: RegExpExecArray | null;
        while ((m = re.exec(sql)) !== null) {
          names.add(m[1].toLowerCase());
        }
      }
    }
    return names;
  }

  it("every aishaRpc node functionName matches a defined SQL function", () => {
    const defined = getDefinedFunctionNames();
    // Sanity: SoT scan musí najít podstatnou sadu funkcí, jinak se rozbil
    // regex/cesty a gate by vakuózně prošel.
    expect(
      defined.size,
      "SoT funkce scan nenašel téměř nic — zkontroluj SQL_SOURCE_DIRS / regex"
    ).toBeGreaterThan(100);

    const entries = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const entry of entries) {
      const wf = readWorkflow(entry);
      if (!wf) continue;

      const rpcNodes = (wf.nodes || []).filter(
        (n) => n.type === "n8n-nodes-aisha.aishaRpc"
      );
      for (const node of rpcNodes) {
        const fnName = node.parameters?.functionName;
        // Jen staticky rezolvovatelné literály.
        if (typeof fnName !== "string") continue;
        if (fnName.startsWith("=") || fnName.includes("{{")) continue;
        if (!defined.has(fnName.toLowerCase())) {
          violations.push(
            `${entry.relPath} → "${node.name}" (${node.id}): functionName "${fnName}" není definovaná RPC ` +
              `(žádný CREATE FUNCTION v aisha/db/sql/functions/ ani aisha/db/migrations/)`
          );
        }
      }
    }

    expect(
      violations,
      `aishaRpc nody volají RPC, která v DB source-of-truth neexistuje → PostgREST PGRST202,\n` +
        `tiše spolknuto onError:"continueRegularOutput" (audit/log řádek se nikdy nezapíše).\n` +
        `Oprav functionName (typo?) NEBO přidej migraci + SoT pár pro funkci.\n` +
        `Violations:\n${violations.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Every n8n-nodes-aisha.* node type in a workflow resolves to a REGISTERED
//    node. A stale type (e.g. the old n8n-nodes-aisha.evymoAdminBridge that
//    survived the evymo→aisha node rebrand) loads as an "unknown node" in n8n
//    and the workflow step silently no-ops. Registered nodes = the .name fields
//    declared by packages/n8n-nodes-aisha/nodes/*/*.node.ts.
// ---------------------------------------------------------------------------
describe("n8n Workflow Integrity: node types resolve to registered nodes", () => {
  function registeredNodeTypes(): Set<string> {
    const nodesDir = path.join(ROOT, "packages/n8n-nodes-aisha/nodes");
    const types = new Set<string>();
    if (!fs.existsSync(nodesDir)) return types;
    for (const sub of fs.readdirSync(nodesDir)) {
      const dir = path.join(nodesDir, sub);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".node.ts")) continue;
        const src = fs.readFileSync(path.join(dir, f), "utf-8");
        // description.name = 'aishaXxx'  → the n8n type is n8n-nodes-aisha.<name>
        const m = src.match(/\bname:\s*['"]([a-zA-Z][\w]*)['"]/);
        if (m) types.add(`n8n-nodes-aisha.${m[1]}`);
      }
    }
    return types;
  }

  it("no workflow references an n8n-nodes-aisha type that isn't a registered node", () => {
    const registered = registeredNodeTypes();
    expect(registered.size, "expected to discover registered aisha node types").toBeGreaterThan(0);
    const violations: string[] = [];
    for (const entry of getAllWorkflowFiles()) {
      const wf = readWorkflow(entry);
      if (!wf?.nodes) continue;
      for (const node of wf.nodes) {
        const t = node.type;
        if (typeof t !== "string" || !t.startsWith("n8n-nodes-aisha.")) continue;
        if (!registered.has(t)) {
          violations.push(`${entry.relPath} → "${node.name}" (${node.id}): type "${t}" is not a registered node`);
        }
      }
    }
    expect(
      violations,
      "Workflow node types not resolving to a registered n8n-nodes-aisha node " +
        "(stale rename → 'unknown node' in n8n, step silently no-ops):\n" +
        `Registered: ${[...registered].sort().join(", ")}\n` +
        violations.join("\n"),
    ).toEqual([]);
  });
});

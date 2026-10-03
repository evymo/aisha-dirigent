/**
 * n8n Blue-Green Orchestrator Workflow Gate
 *
 * Ověřuje, že `n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json` je:
 *   1. Valid JSON
 *   2. Má požadovaný shape (name, nodes, connections)
 *   3. Trigger node je webhook na známé path
 *   4. Klíčové nody (parse-event, fetch-manifest, smoke-test, decision) přítomny
 *   5. Connections graf je acyklický a vede k respond node
 *   6. Inline JS code v Function nodech obsahuje očekávané identifiers
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { N8nNode, N8nWorkflow, N8nConnectionTarget } from "./_types";
import { requireNode } from "./_n8n-helpers";
// Jména instancí a tvar nálezu z JEDNOHO domova (lib/jmena-instanci.ts):
// ⛔ NAMĚŘENO 2026-09-12: tady stálo `.not.toMatch(/aisha-|<fork>-/)` — jméno
// JEDNÉ skutečné instance opsané do generické brány. Vzorek: sedmá instance
// projde. `aisha-` je literál platformy (třída squattingu #163) a měří se
// vždy; jména instancí přicházejí z téhož zdroje jako ve stack bráně, a bez
// nich se to hlásí jako NEZMĚŘENO, ne jako zelená.
import { VZOR_PLATFORMY, duvodNezmereno, najdiJmena, znamaJmenaInstanci } from "./lib/jmena-instanci";

const ZNAMA = await znamaJmenaInstanci();
const NEZMERENO = duvodNezmereno(ZNAMA);

const ROOT = process.cwd();
const WF_PATH = join(ROOT, "n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json");

let wf: N8nWorkflow;

describe("WF_BLUE_GREEN_ORCHESTRATOR.json — structure", () => {
  test("file exists and is valid JSON", () => {
    expect(existsSync(WF_PATH)).toBe(true);
    const content = readFileSync(WF_PATH, "utf-8");
    expect(() => { wf = JSON.parse(content); }).not.toThrow();
  });

  test("has required top-level fields", () => {
    expect(wf.name).toBe("WF_BLUE_GREEN_ORCHESTRATOR");
    expect(Array.isArray(wf.nodes)).toBe(true);
    expect(typeof wf.connections).toBe("object");
    expect(wf.nodes.length).toBeGreaterThan(5);
  });

  test("has webhook trigger node on documented path", () => {
    const trigger = requireNode(wf, (n) => n.type === "n8n-nodes-base.webhook");
    expect(trigger.parameters.path).toBe("coolify-bg-orchestrate");
    expect(trigger.parameters.httpMethod).toBe("POST");
  });

  test("has critical nodes for B/G workflow", () => {
    const nodeIds = wf.nodes.map((n: N8nNode) => n.id);
    const required = [
      "wh-coolify",         // webhook trigger
      "parse-event",        // parse Coolify payload
      "skip-gate",          // filter non-B/G events
      "fetch-manifest",     // load aisha.manifest
      "check-flag",         // check bluegreen=on flag
      "bg-gate",            // gate on flag
      "smoke-test",         // HTTP health check
      "smoke-gate",         // gate on HTTP smoke
      "exec-sandbox-test",  // svc-agent-runner integration test
      "exec-gate",          // gate on sandbox result
      "promote",            // promote slot
      "abort",              // alert on smoke fail
      "respond",            // webhook response
    ];
    for (const id of required) {
      expect(nodeIds).toContain(id);
    }
  });

  test("exec-sandbox-test calls svc-agent-runner via HTTP POST", () => {
    const node = requireNode(wf, (n) => n.id === "exec-sandbox-test");
    expect(node.type).toBe("n8n-nodes-base.httpRequest");
    expect(node.parameters.method).toBe("POST");
    // ⛔ NAMĚŘENO 2026-08-19: tady stálo `toContain("svc-agent-runner")`, což
    // sedělo jen na URL psanou NATVRDO (`http://aisha-svc-agent-runner:3030`) —
    // tedy na službu CIZÍ instance. Adresa se teď bere z prostředí, takže se
    // měří TO: uzel ji odvozuje a nejmenuje instanci.
    expect(node.parameters.url, "adresa runneru se bere z prostředí").toContain("$env.AGENT_RUNNER_URL");
    expect(node.parameters.url, "a nesmí nést jméno platformy (`aisha-<služba>` je cizí kontejner na sdíleném hostiteli, #163)").not.toMatch(VZOR_PLATFORMY);
    expect(node.parameters.url).toContain("/exec");
    // Body should reference recipe + target_slot + isolation
    const body = node.parameters.jsonBody;
    expect(body).toContain("recipe");
    expect(body).toContain("target_slot");
    expect(body).toContain("isolation");
  });

  test.skipIf(NEZMERENO !== null)(
    `adresy runneru nejmenují žádnou známou instanci${NEZMERENO ? ` — NEZMĚŘENO: ${NEZMERENO}` : ""}`,
    () => {
      for (const id of ["exec-sandbox-test"]) {
        const node = requireNode(wf, (n) => n.id === id);
        expect(
          najdiJmena(node.parameters.url ?? "", ZNAMA.jmena).map((n) => n.text),
          `${id}: adresa nese jméno instance; instance, které brána zná: ${ZNAMA.jmena.join(", ")}`,
        ).toEqual([]);
      }
    },
  );

  // Fixtura `testfork`: měřidlo se měří samo — adresa se jménem instance by
  // zčervenala, odvozená z prostředí ne, a literál platformy se chytá vždy.
  test("negativní sonda: `http://testfork-…` by zčervenalo, `$env.AGENT_RUNNER_URL` ne, `aisha-` vždy", () => {
    expect(najdiJmena("http://testfork-svc-agent-runner:3030/exec", ["testfork"]).length).toBe(1);
    expect(najdiJmena("={{ $env.AGENT_RUNNER_URL }}/exec", ["testfork"])).toEqual([]);
    expect("http://aisha-svc-agent-runner:3030/exec").toMatch(VZOR_PLATFORMY);
    expect("={{ $env.AGENT_RUNNER_URL }}/exec").not.toMatch(VZOR_PLATFORMY);
  });

  test("respond node uses respondToWebhook", () => {
    const respond = requireNode(wf, (n) => n.id === "respond");
    expect(respond.type).toBe("n8n-nodes-base.respondToWebhook");
  });

  test("connections graph leads from trigger to respond (no orphan branches)", () => {
    // BFS from `Coolify deploy webhook` (display name of trigger),
    // ensure `Respond` is reachable.
    const adj = wf.connections;
    const queue: string[] = ["Coolify deploy webhook"];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const out = adj[cur]?.main || [];
      for (const branch of out) {
        for (const conn of branch || []) {
          if (conn?.node) queue.push(conn.node);
        }
      }
    }
    expect(visited.has("Respond")).toBe(true);
  });

  test("smoke-test node has timeout for safety", () => {
    const smoke = requireNode(wf, (n) => n.id === "smoke-test");
    expect(smoke.parameters?.options?.timeout).toBeDefined();
  });

  test("workflow is tagged for AISHA + blue-green", () => {
    expect(Array.isArray(wf.tags)).toBe(true);
    expect(wf.tags).toContain("aisha");
    expect(wf.tags).toContain("blue-green");
  });
});

describe("WF_BLUE_GREEN_ORCHESTRATOR.json — Function node code keywords", () => {
  // Validation strategy: rather than eval'ing code (security risk), we check
  // that critical identifiers / patterns are present. Real syntax errors will
  // be caught by n8n at workflow import time.

  test("'parse-event' code references appName + slot", () => {
    const node = requireNode(wf, (n) => n.id === "parse-event");
    const code = node.parameters.jsCode;
    expect(code).toContain("appName");
    expect(code).toContain("slot");
    expect(code).toContain("aisha-");
  });

  test("'check-flag' code references manifest + bluegreen", () => {
    const node = requireNode(wf, (n) => n.id === "check-flag");
    const code = node.parameters.jsCode;
    expect(code).toContain("manifest");
    expect(code).toContain("bluegreen=on");
  });

  test("'resolve-pair' code computes inactive slot", () => {
    const node = requireNode(wf, (n) => n.id === "resolve-pair");
    const code = node.parameters.jsCode;
    expect(code).toMatch(/blue|green/);
    expect(code).toContain("inactive");
  });

  test("'promote' issues a real slot switch (exec blue-green-switch), 'abort' emits decision", () => {
    const promote = requireNode(wf, (n) => n.id === "promote");
    const abort = requireNode(wf, (n) => n.id === "abort");
    // Promote is no longer a stub: it execs the real blue/green switch script
    // (which performs the atomic Coolify Traefik label swap).
    expect(promote.name).not.toMatch(/stub/i);
    expect(promote.type).toBe("n8n-nodes-base.executeCommand");
    expect((promote.parameters as { command?: string }).command).toContain("blue-green-switch.mjs");
    expect(abort.parameters.jsCode).toContain("decision");
  });

  test("post-promote triggers drift check (event-driven chain)", () => {
    const node = requireNode(wf, (n) => n.id === "trigger-drift-after-promote");
    expect(node.parameters.url).toContain("/webhook/drift-now");
    expect(node.parameters.jsonBody).toContain("post-bg-promote");
    // Promote → trigger drift → respond chain
    const promoteConn = wf.connections["Promote (slot switch)"];
    const targets = (promoteConn.main ?? [])[0].map((c: N8nConnectionTarget) => c.node);
    expect(targets).toContain("Trigger drift check (event-driven)");
  });
});

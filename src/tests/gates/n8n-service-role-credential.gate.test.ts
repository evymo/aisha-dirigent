/**
 * Gate: the provisioned n8n service-role credential must authenticate.
 *
 * Eight workflows (WF_WEBDISPECINK_SYNC, WF_DIRIGENT_AGENT, WF_NIGHTLY_STORY_AUDIT,
 * WF_ALE_FEEDBACK_PROCESSOR, …) reference the httpHeaderAuth credential
 * "AISHA Gateway (Service Role)" by name; provision-credentials.mjs is the only
 * thing that ever creates it. Every call path it serves authenticates via
 * `Authorization: Bearer <POSTGREST_SERVICE_TOKEN>`:
 *
 *   • /rest/v1/*      — the gateway proxies to PostgREST, which reads ONLY the
 *                        Authorization header (services/gateway/src/routes/rest.ts
 *                        documents that an `apikey` header is passed through
 *                        untouched and ignored → the request runs as anon);
 *   • /functions/v1/* — the gateway forwards ONLY req.headers.authorization to
 *                        the target service (routes/functions.ts);
 *   • direct services — e.g. svc-webdispecink POST /sync verifies via
 *                        @aisha/security verifyServiceRole(authHeader, …), which
 *                        parses the Authorization header.
 *
 * A credential provisioned with any other header name (the 2026-07 audit found
 * `apikey`) therefore authenticates NOTHING while every scheduled tick "succeeds"
 * in n8n (HTTP nodes run with onError: continueRegularOutput) — a silently dead
 * comms wire. This gate pins the provisioned shape to the consumers' contract.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPT = "scripts/n8n/provision-credentials.mjs";

describe("n8n service-role credential contract", () => {
  const src = readFileSync(join(ROOT, SCRIPT), "utf8");

  // Isolate the DESIRED entry for the service-role credential: from its name
  // literal to the end of its data builder (the next `},` that closes the
  // object at entry level is enough — the builder is a single expression).
  const entryStart = src.indexOf('"AISHA Gateway (Service Role)"');
  test("credential is still provisioned (workflows reference it by name)", () => {
    expect(entryStart, `"AISHA Gateway (Service Role)" not found in ${SCRIPT}`).toBeGreaterThan(-1);
  });

  const entry = src.slice(entryStart, src.indexOf("data:", entryStart) + 400);

  test("data builder sets the Authorization header (not apikey or any custom header)", () => {
    const headerName = entry.match(/data:\s*\(\)\s*=>\s*\(\{\s*name:\s*"([^"]+)"/);
    expect(headerName, `could not parse the data builder header name in ${SCRIPT}`).not.toBeNull();
    expect(headerName![1]).toBe("Authorization");
  });

  test("header value is a Bearer token derived from POSTGREST_SERVICE_TOKEN", () => {
    const valueExpr = entry.match(/value:\s*(.+?)\s*\}\)/s);
    expect(valueExpr, `could not parse the data builder value in ${SCRIPT}`).not.toBeNull();
    expect(valueExpr![1]).toContain("Bearer ");
    expect(valueExpr![1]).toContain('env("POSTGREST_SERVICE_TOKEN")');
  });
});

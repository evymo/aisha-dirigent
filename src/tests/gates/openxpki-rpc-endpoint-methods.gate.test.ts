/**
 * OpenXPKI RPC Endpoint Methods Gate
 *
 * Enforces that every per-realm RPC endpoint YAML in
 * `openxpki-config/client.d/service/rpc/` defines the JSON-RPC method
 * blocks required by callers (`RequestCertificate`, `RevokeCertificate`,
 * `TestConnection`), not just a `global.realm` override.
 *
 * Why this gate exists (2026-05-11):
 *   OpenXPKI 3.x client routes `POST /rpc/<endpoint>/<method>` by
 *   loading `client.d/service/rpc/<endpoint>.yaml` and looking up
 *   `<method>:` as a top-level key in that file. If the per-realm
 *   endpoint YAML only defines `global.realm` (and lacks method
 *   blocks), every call returns HTTP 404 — with no useful error
 *   message back to the caller (just Apache's default 404 HTML).
 *
 *   Symptom that triggered this gate:
 *     pki-bridge → POST /rpc/orchestration-plane/RequestCertificate
 *     OpenXPKI client → HTTP 404 "Not Found" (HTML)
 *     pki-bridge → throws "OpenXPKI RPC RequestCertificate failed:
 *                          HTTP 404 — ..." → 500 to caller
 *     netbird pki-init → falls back to self-signed → mesh broken
 *
 *   The bug had been LATENT since svc-pki-bridge was created (commit
 *   82ca52ba). It was masked by earlier failures (SAN policy 403,
 *   HMAC empty-file 500) which never reached the OpenXPKI RPC call.
 *
 * What's checked:
 *   1. Enumerate all `*.yaml` under `openxpki-config/client.d/service/rpc/`
 *      (excluding `generic.yaml` which is the reference template).
 *   2. For each, assert it parses as YAML.
 *   3. Assert it defines `global.realm` (per-realm endpoint, not generic).
 *   4. Assert it defines the required JSON-RPC method blocks as
 *      top-level keys, each with at least a `workflow:` field.
 *
 *   Gate is meaningful as long as svc-pki-bridge keeps calling
 *   `/rpc/<realm>/<method>` URLs (see services/svc-pki-bridge/src/
 *   openxpki-rpc.ts::requestCertificate). If the URL scheme ever
 *   changes (e.g. moves to `/rpc/generic` with method in body), update
 *   this gate accordingly.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { load as yamlLoad } from "js-yaml";

const ROOT = process.cwd();
const RPC_DIR = join(ROOT, "openxpki-config/client.d/service/rpc");

// Upstream OpenXPKI sample endpoint files that reference the `democa`
// demo realm (no `config.d/realm/democa/` exists in AISHA setup, so any
// /rpc/<sample-name>/... call would fail with a "realm not found" error
// from the OpenXPKI server). Banned to prevent silent dead-code
// re-introduction. AISHA only ships per-plane endpoints.
const BANNED_SAMPLE_FILES = new Set<string>([
  "generic.yaml",
  "public.yaml",
]);

// AISHA realms that actually exist on the server side
// (config.d/realm/<name>/ must be present). Every per-realm endpoint
// YAML in client.d/service/rpc/ MUST declare one of these.
const VALID_REALMS = new Set<string>([
  "orchestration-plane",
  "identity-plane",
  "data-plane",
]);

// Methods that pki-bridge currently calls. If a new method is added to
// services/svc-pki-bridge/src/openxpki-rpc.ts, register it here too.
const REQUIRED_METHODS = ["RequestCertificate"];
// These are present in generic.yaml so we enforce them across all
// per-realm endpoints for parity — a missing method is a 404 in
// production for any caller that uses it.
const RECOMMENDED_METHODS = ["RevokeCertificate", "TestConnection"];

interface RpcEndpoint {
  global?: { realm?: string; servername?: string };
  [methodOrSection: string]: unknown;
}

function listAllYaml(): string[] {
  const stat = (() => {
    try {
      return statSync(RPC_DIR);
    } catch {
      return null;
    }
  })();
  if (!stat?.isDirectory()) return [];
  return readdirSync(RPC_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => join(RPC_DIR, f));
}

function isMethodBlock(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // A method block must reference a workflow — that's the OpenXPKI RPC
  // contract (URL method → workflow name).
  return typeof v.workflow === "string" && v.workflow.length > 0;
}

describe("OpenXPKI RPC Endpoint Methods — per-realm endpoints define their methods", () => {
  test("at least one per-realm endpoint YAML exists (gate is meaningful)", () => {
    const files = listAllYaml();
    expect(
      files.length,
      `Expected per-realm endpoint YAML(s) in ${RPC_DIR} — none found. If you removed all endpoints intentionally, also remove the svc-pki-bridge service.`,
    ).toBeGreaterThan(0);
  });

  test("no upstream OpenXPKI sample endpoint files (generic.yaml / public.yaml) present", () => {
    // These reference `realm: democa` (a demo realm that doesn't exist
    // in config.d/realm/), so any /rpc/generic/... or /rpc/public/...
    // request would fail with a "realm not found" error from the server.
    // AISHA setup ships ONLY per-plane endpoints (orchestration-plane,
    // identity-plane, data-plane). If a public certificate search API
    // is later needed, create `aisha-public.yaml` with `realm:
    // orchestration-plane` (or whichever plane queries it) — never
    // reintroduce `democa` since that realm isn't defined here.
    const present: string[] = [];
    for (const f of listAllYaml()) {
      const name = basename(f);
      if (BANNED_SAMPLE_FILES.has(name)) present.push(name);
    }
    expect(
      present,
      [
        "Upstream OpenXPKI sample endpoint file(s) present in client.d/",
        "service/rpc/ — these reference the `democa` demo realm that",
        "doesn't exist in AISHA's config.d/realm/ tree:",
        ...present.map((p) => `  - ${p}`),
        "",
        "Delete them. AISHA uses per-plane endpoints only.",
      ].join("\n"),
    ).toEqual([]);
  });

  test.each(listAllYaml())(
    "endpoint %s parses + has global.realm (valid AISHA plane) + defines required methods",
    (filePath) => {
      const name = basename(filePath);
      const raw = readFileSync(filePath, "utf-8");
      let parsed: RpcEndpoint;
      try {
        parsed = yamlLoad(raw) as RpcEndpoint;
      } catch (err) {
        throw new Error(`${name} failed to parse as YAML: ${err}`);
      }

      // Must declare a realm — that's the whole reason per-realm endpoints exist
      expect(
        parsed.global?.realm,
        `${name} must declare global.realm (per-realm endpoint config).`,
      ).toMatch(/^[a-z][a-z0-9-]*$/);

      // Realm MUST be one of the actual AISHA planes that exist in
      // config.d/realm/. Anything else (e.g. the upstream `democa`)
      // points at a server-side realm that doesn't exist → runtime
      // "realm not found" error on every call.
      expect(
        VALID_REALMS.has(parsed.global?.realm ?? ""),
        `${name} declares global.realm="${parsed.global?.realm}" which is NOT a valid AISHA plane. Use one of: ${[...VALID_REALMS].join(", ")}. If a new plane is needed, add it to config.d/realm/<name>/ first (full CA setup: profile, workflow, crypto).`,
      ).toBe(true);

      // Endpoint name should match realm name — AISHA convention for
      // cert-issuance endpoints. Keeps URL routing predictable:
      // /rpc/<plane>/... goes to <plane> realm.
      const endpointName = name.replace(/\.yaml$/, "");
      expect(
        parsed.global?.realm,
        `${name}'s global.realm should match the file name (endpoint name) — otherwise the URL routing (/rpc/${endpointName}/...) operates on a different realm than the file name suggests.`,
      ).toBe(endpointName);

      const missing: string[] = [];
      for (const method of REQUIRED_METHODS) {
        if (!isMethodBlock(parsed[method])) {
          missing.push(`${method} (REQUIRED — pki-bridge calls this)`);
        }
      }
      for (const method of RECOMMENDED_METHODS) {
        if (!isMethodBlock(parsed[method])) {
          missing.push(`${method} (recommended for parity across endpoints)`);
        }
      }

      expect(
        missing,
        [
          `${name} is missing OpenXPKI RPC method block(s):`,
          ...missing.map((m) => `  - ${m}`),
          "",
          "Each method block must be a top-level YAML key with a `workflow:`",
          "field (and typically input/output/env). Without these, the OpenXPKI",
          "client returns HTTP 404 for /rpc/<endpoint>/<method> calls.",
          "Copy the definitions from a peer endpoint (e.g. orchestration-",
          "plane.yaml) — only `global.realm` should differ between endpoints.",
        ].join("\n"),
      ).toEqual([]);
    },
  );
});

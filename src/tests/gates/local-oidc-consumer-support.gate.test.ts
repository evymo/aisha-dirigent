/**
 * Local-warmup OIDC consumer support boundary
 *
 * The model-driven resolver (PR #336) makes EXPLICIT-endpoint OIDC consumers work
 * locally (gateway/svc-* via KC_ISSUER+KC_JWKS_URL; oauth2-proxy via SKIP_DISCOVERY
 * + explicit URLs; svc-matrix via KEYCLOAK_URL). DISCOVERY-based consumers
 * (Langfuse/llm-gateway/openclaw NextAuth, Matrix Synapse) cannot complete login
 * under local-warmup's no-Traefik/no-/etc/hosts model — a fundamental single-host
 * constraint, codified here as a registry + a non-fatal generator warning + a doc,
 * so the boundary is explicit rather than a silent failure.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DISCOVERY_OIDC_CONSUMERS,
  findDiscoveryConsumersInStack,
} from "../../../scripts/lib/oidc-consumer-support.mjs";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

describe("Local-warmup OIDC consumer support boundary", () => {
  test("registry lists the known discovery-only consumers with reasons", () => {
    for (const cn of ["aisha-langfuse", "aisha-llm-gateway", "aisha-openclaw", "aisha-synapse"]) {
      expect(DISCOVERY_OIDC_CONSUMERS[cn], `${cn} must be registered with a reason`).toBeTruthy();
    }
  });

  test("findDiscoveryConsumersInStack matches original container_names, ignores explicit-endpoint ones", () => {
    const doc = {
      services: {
        langfuse: { container_name: "aisha-langfuse" },
        gateway: { container_name: "aisha-gateway" }, // explicit endpoints → not flagged
        matrix: { container_name: "aisha-svc-matrix" }, // explicit JWKS via KEYCLOAK_URL → not flagged
        synapse: { container_name: "aisha-synapse" },
      },
    };
    expect(findDiscoveryConsumersInStack(doc)).toEqual(["aisha-langfuse", "aisha-synapse"]);
    expect(findDiscoveryConsumersInStack({ services: {} })).toEqual([]);
  });

  test("generator warns (NON-FATAL) about discovery consumers, BEFORE namespacing", () => {
    const gen = read("scripts/local-compose-gen.mjs");
    expect(gen).toMatch(/findDiscoveryConsumersInStack\(merged\)/);
    expect(gen, "warning must be non-fatal (console.error, not process.exit)").toMatch(/discoveryConsumers\.length > 0[\s\S]*console\.error/);
    const idxWarn = gen.indexOf("findDiscoveryConsumersInStack(merged)");
    const idxNs = gen.indexOf("namespaceContainerNames(merged");
    expect(idxWarn, "detection present").toBeGreaterThan(-1);
    expect(idxNs, "must run BEFORE namespacing (which renames container_name)").toBeGreaterThan(idxWarn);
  });

  test("the support-matrix doc documents the boundary + every discovery consumer", () => {
    expect(existsSync(join(ROOT, "docs/LOCAL_WARMUP_OIDC_SUPPORT.md")), "doc must exist").toBe(true);
    const doc = read("docs/LOCAL_WARMUP_OIDC_SUPPORT.md");
    expect(doc, "explains the discovery constraint").toMatch(/discovery/i);
    expect(doc, "names the working path (Traefik/e2e)").toMatch(/Traefik|e2e/i);
    for (const cn of Object.keys(DISCOVERY_OIDC_CONSUMERS)) {
      expect(doc, `doc must list ${cn}`).toContain(cn);
    }
  });
});

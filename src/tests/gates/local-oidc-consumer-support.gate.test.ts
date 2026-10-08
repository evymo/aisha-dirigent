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
    for (const sluzba of ["langfuse", "llm-gateway", "openclaw"]) {
      expect(DISCOVERY_OIDC_CONSUMERS[sluzba], `${sluzba} must be registered with a reason`).toBeTruthy();
    }
    // Synapse bere explicitní endpointy (discover: false) — není discovery spotřebitel.
    expect(DISCOVERY_OIDC_CONSUMERS["synapse"]).toBeUndefined();
  });

  test("findDiscoveryConsumersInStack matches container_names of ANY instance identity, ignores explicit-endpoint ones", () => {
    // ⛔ Klíče registru byly doslovná jména `aisha-*`; po přechodu na jména z identity
    // instance (`local-*`) varování nenašlo nic (naměřeno 2026-10-08). Měří se proto
    // na prefixu, který NENÍ `aisha`.
    const doc = {
      services: {
        langfuse: { container_name: "zkouska-langfuse" },
        langfuseGw: { container_name: "zkouska-langfuse-gateway" }, // jiná služba → not flagged
        openclaw: { container_name: "zkouska-openclaw" },
        openclawAuth: { container_name: "zkouska-openclaw-auth" }, // oauth2-proxy, explicit → not flagged
        gateway: { container_name: "zkouska-gateway" }, // explicit endpoints → not flagged
        matrix: { container_name: "zkouska-svc-matrix" }, // explicit JWKS via KEYCLOAK_URL → not flagged
        synapse: { container_name: "zkouska-synapse" }, // discover: false + explicit endpoints → not flagged
      },
    };
    expect(findDiscoveryConsumersInStack(doc)).toEqual(["zkouska-langfuse", "zkouska-openclaw"]);
    expect(findDiscoveryConsumersInStack({ services: {} })).toEqual([]);
  });

  test("Synapse: discover: false + explicit endpoints from compose, realm delivered to the renderer", () => {
    const hs = read("coolify/synapse/homeserver.yaml");
    expect(hs).toMatch(/discover:\s*false/);
    for (const v of ["SYNAPSE_OIDC_ISSUER", "SYNAPSE_OIDC_AUTHORIZE_URL", "SYNAPSE_OIDC_TOKEN_URL", "SYNAPSE_OIDC_USERINFO_URL", "SYNAPSE_OIDC_JWKS_URL"]) {
      expect(hs, `homeserver.yaml musí brát ${v}`).toContain(`\${${v}}`);
    }
    // Šablona si realm neskládá sama: renderer (matrix-config-init) ho dřív nedostal
    // a envsubst dosadil prázdno → issuer `https://<auth>/realms/`.
    expect(hs).not.toMatch(/\$\{KEYCLOAK_REALM\}/);
    const compose = read("docker-compose.coolify-matrix.yml");
    expect(compose).toMatch(/SYNAPSE_OIDC_ISSUER=https:\/\/\$\{KEYCLOAK_DOMAIN_PUBLIC:\?[^}]*\}\/realms\/\$\{KEYCLOAK_REALM:\?[^}]*\}\s/);
    expect(compose).toMatch(/SYNAPSE_OIDC_JWKS_URL=https:\/\/\$\{KEYCLOAK_DOMAIN:\?[^}]*\}\/realms\/\$\{KEYCLOAK_REALM:\?[^}]*\}\/protocol\/openid-connect\/certs/);
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
    for (const sluzba of Object.keys(DISCOVERY_OIDC_CONSUMERS)) {
      expect(doc, `doc must list ${sluzba}`).toContain(sluzba);
    }
  });
});

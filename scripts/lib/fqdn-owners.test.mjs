/**
 * Unit tests for fqdn-owners — INTRA-PROJECT FQDN collision detection + host utilities.
 * Deterministic, no network. The caller always feeds PROJECT-SCOPED apps; a foreign-project
 * squatter is never seen or touched. Also pins the safety invariant that a shared git token
 * is NEVER an ownership signal (2026-07-05).
 */
import { describe, expect, it } from "vitest";
import {
  extractHost,
  parseDcdDomains,
  isUuidDefaultFqdn,
  buildOwnerIndex,
  identityAxes,
  findContractConflicts,
  replaceOwner,
} from "./fqdn-owners.mjs";

describe("extractHost", () => {
  it("strips scheme, port and path", () => {
    expect(extractHost("https://tenantcache.staging.example.com:5000")).toBe("tenantcache.staging.example.com");
    expect(extractHost("http://Cache.Aisha.Guru/v2/")).toBe("cache.aisha.guru");
  });
  it("tolerates junk", () => {
    expect(extractHost(null)).toBe("");
    expect(extractHost(123)).toBe("");
  });
});

describe("parseDcdDomains", () => {
  it("parses string, object and array forms", () => {
    expect(parseDcdDomains('{"registry_cache":{"domain":"https://a:5000"}}')).toEqual(["https://a:5000"]);
    expect(parseDcdDomains({ x: { domain: "https://b" } })).toEqual(["https://b"]);
    expect(parseDcdDomains([{ name: "n", domain: "https://c" }])).toEqual(["https://c"]);
    expect(parseDcdDomains(null)).toEqual([]);
    expect(parseDcdDomains("not json")).toEqual([]);
  });
});

describe("isUuidDefaultFqdn", () => {
  it("detects the Coolify uuid-default fqdn", () => {
    expect(isUuidDefaultFqdn("https://pgdro3fgrzee9eoq06fxe50r.example.com", "pgdro3fgrzee9eoq06fxe50r")).toBe(true);
    expect(isUuidDefaultFqdn("https://cache.aisha.guru", "rkkwkksw08c4g8s4ocs4ws4w")).toBe(false);
    expect(isUuidDefaultFqdn(null, "x")).toBe(false);
  });
});

describe("findContractConflicts — intra-project collision (caller feeds project-scoped apps only)", () => {
  const ours = {
    uuid: "pgdro3", name: "tenant-registry", environment_id: 15,
    git_repository: "https://forge.example.com/aisha/tenant-orchestrator.git",
    docker_compose_domains: '{"registry_cache":{"domain":"https://tenantcache.staging.example.com:5000"}}',
  };
  // A stale DUPLICATE of our own registry in our OWN project (a bad-deploy residue) that
  // collides on the same host. Its git url is cross-contaminated (creds + double-slash) to
  // exercise identityAxes hardening — but it is in-project, so the caller does see it.
  const staleDup = {
    uuid: "wyotm8", name: "tenant-registry", environment_id: 15,
    git_repository: "https://user:tok@forge.example.com//aisha/tenant-orchestrator.git",
    fqdn: "https://wyotm8.example.com",
    docker_compose_domains: '{"registry_cache":{"domain":"https://tenantcache.staging.example.com:5000"}}',
  };
  const other = {
    uuid: "rkk", name: "tenant-edge", environment_id: 15,
    docker_compose_domains: '{"edge":{"domain":"https://tenant.staging.example.com"}}',
  };

  it("flags two of the project's own apps claiming the same host", () => {
    const idx = buildOwnerIndex([ours, staleDup, other]);
    const conflicts = findContractConflicts(idx, ["tenantcache.staging.example.com"], "pgdro3");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].host).toBe("tenantcache.staging.example.com");
    expect(conflicts[0].claimants.map((c) => c.uuid).sort()).toEqual(["pgdro3", "wyotm8"]);
  });

  it("single-owned host yields no conflict", () => {
    const idx = buildOwnerIndex([other]);
    expect(findContractConflicts(idx, ["tenant.staging.example.com"], "rkk")).toEqual([]);
  });

  it("the same alias on different ingress servers is not a collision", () => {
    const frontend = {
      uuid: "front", destination: { server_id: 1 },
      docker_compose_domains: [{ name: "edge", domain: "https://mcp.example.com" }],
    };
    const backend = {
      uuid: "back", destination: { server_id: 2 },
      docker_compose_domains: [{ name: "oauth", domain: "https://mcp.example.com" }],
    };
    const idx = buildOwnerIndex([frontend, backend]);
    expect(findContractConflicts(idx, ["mcp.example.com"], frontend)).toEqual([]);
  });

  it("identityAxes strips git creds + double-slash and NEVER exposes a token as ownership", () => {
    const ax = identityAxes(staleDup);
    expect(ax.gitRepo).toBe("https://forge.example.com/aisha/tenant-orchestrator.git");
    expect(ax).not.toHaveProperty("token");
    expect(ax).not.toHaveProperty("gitToken");
    expect(ax.envId).toBe(15);
    expect(ax.fqdnIsUuidDefault).toBe(true);
  });
});

describe("replaceOwner — potvrzený zápis se promítne do indexu (doktor: uvolnění před převzetím)", () => {
  const server = { destination: { server_id: 7 } };
  const edge = { uuid: "edge1", ...server, docker_compose_domains: '{"edge_proxy":{"domain":"https://api.example.test"}}' };
  const core = { uuid: "core1", ...server, docker_compose_domains: '{"gateway":{"domain":"https://api.example.test:3001"}}' };

  it("před zápisem je jméno obsazené backendem na témž serveru — konflikt", () => {
    const index = buildOwnerIndex([edge, core]);
    expect(findContractConflicts(index, ["api.example.test"], edge)).toHaveLength(1);
  });

  it("po uvolnění (sentinel místo jména) konflikt zmizí a host patří jen edge", () => {
    const index = buildOwnerIndex([edge, core]);
    replaceOwner(index, { ...core, docker_compose_domains: '{"gateway":{"domain":"http://gateway-acme.edge-vlastni.invalid:80"}}' });
    expect(findContractConflicts(index, ["api.example.test"], edge)).toEqual([]);
    expect(index.get("api.example.test").map((a) => a.uuid)).toEqual(["edge1"]);
    expect(index.get("gateway-acme.edge-vlastni.invalid").map((a) => a.uuid)).toEqual(["core1"]);
  });

  it("host, který ztratil posledního vlastníka, z indexu zmizí", () => {
    const index = buildOwnerIndex([core]);
    replaceOwner(index, { ...core, docker_compose_domains: "{}" });
    expect(index.has("api.example.test")).toBe(false);
    expect(index.size).toBe(0);
  });

  it("aplikace bez uuid index nemění", () => {
    const index = buildOwnerIndex([edge, core]);
    replaceOwner(index, { docker_compose_domains: "{}" });
    expect(index.get("api.example.test")).toHaveLength(2);
  });
});

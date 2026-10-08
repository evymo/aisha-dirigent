import { describe, expect, test } from "vitest";
import { neutralizeMeshRouteForLocal, stripMeshRoute } from "./local-mesh-route.mjs";

// Přesný tvar po `docker compose config --format json` (dolar zdvojený).
const UNCONDITIONAL = [
  "set -eu",
  'ip route replace "$${NETBIRD_PEER_CIDR:?}" via "$${NETBIRD_DNS_IP:?}"',
  'echo "[mesh-route] $${NETBIRD_PEER_CIDR} via $${NETBIRD_DNS_IP}"',
  "exec su-exec node node dist/server.js",
  "",
].join("\n");

const CONDITIONAL = [
  "set -eu",
  'case "$$_mesh" in',
  "  true|1|yes|on)",
  '    if ip route replace "$${NETBIRD_PEER_CIDR}" via "$${NETBIRD_DNS_IP}" 2>&1; then',
  '      echo "[mesh-route] routa $${NETBIRD_PEER_CIDR} → $${NETBIRD_DNS_IP} (mesh-router) postavena"',
  "    fi",
  "    ;;",
  "esac",
  "exec node main.js",
].join("\n");

describe("local-mesh-route: lokální stack nevyžaduje NetBird mesh", () => {
  test("nepodmíněná routa i její echo zmizí, zbytek skriptu zůstane", () => {
    const r = stripMeshRoute(UNCONDITIONAL);
    expect(r.changed).toBe(true);
    expect(r.script).toBe("set -eu\nexec su-exec node node dist/server.js\n");
  });

  test("podmíněná routa (MESH_ENABLED) se nemění — rozhoduje sama", () => {
    expect(stripMeshRoute(CONDITIONAL)).toEqual({ script: CONDITIONAL, changed: false });
  });

  test("služba: entrypoint bez routy, dns bez mesh resolveru", () => {
    const svc = {
      entrypoint: ["/bin/sh", "-c", UNCONDITIONAL],
      dns: ["127.0.0.1"],
      dns_search: ["mesh.localhost"],
    };
    expect(neutralizeMeshRouteForLocal(svc, { meshDnsIp: "127.0.0.1" })).toBe(true);
    expect(svc.entrypoint[2]).not.toContain("ip route");
    expect(svc.entrypoint[2]).toContain("exec su-exec node node dist/server.js");
    expect(svc).not.toHaveProperty("dns");
    expect(svc.dns_search).toEqual(["mesh.localhost"]);
  });

  test("cizí DNS server zůstane, služba bez mesh se nezmění", () => {
    const svc = { command: ["node", "server.js"], dns: ["1.1.1.1", "127.0.0.1"] };
    expect(neutralizeMeshRouteForLocal(svc, { meshDnsIp: "127.0.0.1" })).toBe(true);
    expect(svc.dns).toEqual(["1.1.1.1"]);
    const plain = { command: ["node", "server.js"] };
    expect(neutralizeMeshRouteForLocal(plain, { meshDnsIp: "127.0.0.1" })).toBe(false);
    expect(plain).toEqual({ command: ["node", "server.js"] });
  });
});

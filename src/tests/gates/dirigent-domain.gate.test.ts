/**
 * Dirigent Domain Gate
 *
 * Asserts DIRIGENT_DOMAIN is wired up as a public alias for the n8n/MCP
 * orchestration service via the Frontend edge stack (split architecture):
 *   - mesh-router : NetBird agent + iptables DNAT. NO public listener.
 *                   Forwards :8080/:3001 → core peer mesh IP via wt0.
 *   - edge-proxy  : Plain caddy:2.8 listener on coolify network. Reverses
 *                   Host(MCP/API/DIRIGENT domains) → mesh-router DNAT
 *                   → mesh peer.
 *
 * Why split: NetBird agent + Caddy in same container makes the listener
 * invisible to Coolify Traefik provider (NetBird's INPUT-chain firewall
 * blocks coolify-network inbound to local listeners). Verified empirically.
 *
 * Coolify docker_compose_domains registers every real public hostname on
 * edge-proxy and keeps only mesh-router behind a per-instance .invalid
 * sentinel. Coolify then generates instance-scoped Traefik routers/services.
 *
 * Spouští se přes: npm run test:gates
 */

// Iter 15: config/domains.env is template-only (empty SoT). The reference
// deploy contract that THIS gate verifies lives in config/domains.env.example.
// Operators forking the repo populate their domains via .env-prod-backup;
// this gate enforces structural integrity of the AISHA reference deploy.

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function loadDomainsEnv(): Record<string, string> {
  const path = join(ROOT, "config/domains.env.example");
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let raw = m[2];
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      const hashIdx = raw.indexOf(" #");
      if (hashIdx >= 0) raw = raw.slice(0, hashIdx);
    }
    env[m[1]] = raw.trim().replace(/^['"]|['"]$/g, "");
  }
  for (const k of Object.keys(env)) {
    env[k] = env[k].replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => env[name] ?? "");
  }
  return env;
}

const PREBUILT = readFileSync(
  join(ROOT, "docker-compose.coolify-prebuilt.yml"),
  "utf-8",
);
const DOCTOR = readFileSync(
  join(ROOT, "scripts/coolify-domain-doctor.mjs"),
  "utf-8",
);
const SMOKE = readFileSync(
  join(ROOT, "scripts/smoke-routing.sh"),
  "utf-8",
);

describe("Dirigent domain — env declared", () => {
  const env = loadDomainsEnv();

  test("DIRIGENT_DOMAIN is declared as a public alias", () => {
    expect(env.DIRIGENT_DOMAIN, "DIRIGENT_DOMAIN missing").toBeTruthy();
    expect(env.DIRIGENT_DOMAIN.endsWith(`.${env.PUBLIC_TLD}`)).toBe(true);
  });
});

describe("Dirigent — split architecture (mesh-router + edge-proxy)", () => {
  test("docker-compose.coolify-prebuilt.yml has BOTH mesh-router and edge-proxy services", () => {
    expect(
      PREBUILT.includes("mesh-router:"),
      "edge compose must have mesh-router service (NetBird agent + iptables DNAT)",
    ).toBe(true);
    expect(
      PREBUILT.includes("edge-proxy:"),
      "edge compose must have edge-proxy service (naked Caddy listener)",
    ).toBe(true);
  });

  test("edge-proxy is on coolify network (own IP for Traefik discovery)", () => {
    // The previous design used `network_mode: service:netbird-edge` which
    // hid the listener from Coolify Traefik provider → routes 404. Both
    // containers in the split design have their own coolify network IPs.
    const m = /\n {2}edge-proxy:[\s\S]*?networks:\s*\n([\s\S]*?)(?=\n {4}[a-zA-Z]|\nvolumes:|\n {2}[a-z-]+:)/;
    const match = PREBUILT.match(m);
    expect(
      match && match[1].includes("coolify"),
      "edge-proxy must declare coolify network (no network_mode: service:X tricks)",
    ).toBe(true);
  });

  test("edge-proxy is naked Caddy (no NetBird agent inside it — that's mesh-router's job)", () => {
    // Empirical: NetBird agent + Caddy in same container makes the listener
    // invisible to Coolify Traefik (502 from coolify net). Split fixes it.
    const edgeProxyBlock = /\n {2}edge-proxy:[\s\S]*?(?=\n {2}[a-z-]+:|\nvolumes:|\nnetworks:|$)/;
    const block = PREBUILT.match(edgeProxyBlock)?.[0] ?? "";
    expect(
      /caddy:[\d.]+/.test(block),
      "edge-proxy must use a Caddy image (e.g. caddy:2.8.4-alpine)",
    ).toBe(true);
    expect(
      /NB_SETUP_KEY/.test(block),
      "edge-proxy must NOT have NetBird env (that belongs to mesh-router)",
    ).toBe(false);
  });

  test("mesh-router has NetBird agent (NB_SETUP_KEY env)", () => {
    const meshRouterBlock = /\n {2}mesh-router:[\s\S]*?(?=\n {2}[a-z-]+:|\nvolumes:|\nnetworks:|$)/;
    const block = PREBUILT.match(meshRouterBlock)?.[0] ?? "";
    expect(
      /NB_SETUP_KEY:/.test(block),
      "mesh-router must include NetBird setup key — joins mesh as own peer",
    ).toBe(true);
  });

  test("mesh-router has iptables DNAT for both n8n (:8080) and gateway (:3001)", () => {
    const meshRouterBlock = /\n {2}mesh-router:[\s\S]*?(?=\n {2}[a-z-]+:|\nvolumes:|\nnetworks:|$)/;
    const block = PREBUILT.match(meshRouterBlock)?.[0] ?? "";
    expect(
      /--dport 8080[\s\S]*?DNAT/.test(block),
      "mesh-router must DNAT --dport 8080 to mesh peer (for mcp.aisha.guru)",
    ).toBe(true);
    expect(
      /--dport 3001[\s\S]*?DNAT/.test(block),
      "mesh-router must DNAT --dport 3001 to mesh peer (for api/dirigent)",
    ).toBe(true);
  });

  test("edge-proxy Caddy reverse_proxies to env-driven UPSTREAM", () => {
    // Edge-proxy Caddyfile uses {MCP,API,DIRIGENT}_UPSTREAM env vars to
    // build reverse_proxy targets. Values are generated by the topology
    // resolver and synced to Coolify; compose must not carry hardcoded
    // production host fallbacks.
    expect(
      /reverse_proxy \$\$\{MCP_UPSTREAM\}/.test(PREBUILT),
      "edge-proxy Caddy must reverse_proxy mcp via $${MCP_UPSTREAM}",
    ).toBe(true);
    expect(
      /reverse_proxy \$\$\{API_UPSTREAM\}/.test(PREBUILT),
      "edge-proxy Caddy must reverse_proxy api via $${API_UPSTREAM}",
    ).toBe(true);
    expect(
      /reverse_proxy \$\$\{DIRIGENT_UPSTREAM\}/.test(PREBUILT),
      "edge-proxy Caddy must reverse_proxy dirigent via $${DIRIGENT_UPSTREAM}",
    ).toBe(true);
    expect(
      /reverse_proxy \$\$\{AUTH_UPSTREAM\}/.test(PREBUILT),
      "edge-proxy Caddy must reverse_proxy auth via $${AUTH_UPSTREAM}",
    ).toBe(true);

    // Required route values come from the topology/env contract; no compose
    // fallback may mask a missing or empty Coolify env value.
    expect(
      /MCP_UPSTREAM_PUBLIC:\s*\$\{MCP_UPSTREAM_PUBLIC:\?/.test(PREBUILT),
      "MCP_UPSTREAM_PUBLIC must be required from topology env",
    ).toBe(true);
    expect(
      /API_UPSTREAM_PUBLIC:\s*\$\{API_UPSTREAM_PUBLIC:\?/.test(PREBUILT),
      "API_UPSTREAM_PUBLIC must be required from topology env",
    ).toBe(true);
    expect(
      /DIRIGENT_UPSTREAM_PUBLIC:\s*\$\{DIRIGENT_UPSTREAM_PUBLIC:\?/.test(PREBUILT),
      "DIRIGENT_UPSTREAM_PUBLIC must be required from topology env",
    ).toBe(true);
    expect(
      /AUTH_UPSTREAM_PUBLIC:\s*\$\{AUTH_UPSTREAM_PUBLIC:\?/.test(PREBUILT),
      "AUTH_UPSTREAM_PUBLIC must be required from topology env",
    ).toBe(true);
  });

  test("edge-proxy does NOT publicly expose db.aisha.guru", () => {
    // Per scope decision (2026-05-07): pgAdmin is admin-only, accessed via
    // db.backend.id3a.cz direct route on aisha-core stack. db.aisha.guru must
    // NOT appear as a Traefik router on edge-proxy.
    const bad = /traefik\.http\.routers\.[\w-]+\.rule=Host\(`db\.aisha\.guru`\)/;
    expect(
      bad.test(PREBUILT),
      "edge-proxy must NOT have Traefik router for db.aisha.guru",
    ).toBe(false);
  });

  test("entrypoint heredocs escape $ as $$ (Compose substitution defense)", () => {
    // Docker Compose substitutes ${VAR} in YAML strings BEFORE the
    // container starts, looking in compose's own env (which doesn't have
    // CORE_MESH_IP, NB_HOSTNAME, etc.). Without `$$` escaping, all those
    // shell variables expand to empty strings → iptables/Caddy get blank
    // arguments → silent routing failure (verified empirically: 502 with
    // `dial tcp 192.0.2.4:3001: i/o timeout`).
    //
    // The shell variable references inside entrypoint heredocs MUST use
    // `$${VAR}` so Compose passes literal `$` to the container shell.

    // Detect plain ${...} inside entrypoint heredocs (after `entrypoint:` block).
    // Heuristic: look at the multi-line entrypoint blocks and check that
    // every shell-control variable reference INSIDE an entrypoint is `$${...}`
    // (escaped) — never a bare `${...}`. Domain placeholders may intentionally
    // remain bare in Caddy text/diagnostic output because they are supplied by
    // the Coolify env contract.
    const entrypointBlocks = [...PREBUILT.matchAll(/entrypoint:\s*\n\s*-\s*\/bin\/sh\s*\n\s*-\s*-c\s*\n\s*-\s*\|\s*\n([\s\S]*?)(?=\n {4}[a-zA-Z]|\n {2}[a-z-]+:|\n[a-z]+:)/g)];
    expect(
      entrypointBlocks.length,
      "expected at least one entrypoint heredoc in compose",
    ).toBeGreaterThan(0);

    for (const m of entrypointBlocks) {
      const body = m[1];
      // Look for unescaped ${VAR} where VAR is a known env var that
      // should be expanded by SHELL (not Compose).
      const offenders = [...body.matchAll(/(?<!\$)\$\{(CORE_MESH_IP|NB_HOSTNAME|NB_SETUP_KEY|NB_MANAGEMENT_URL|NB_FORCE_REENROLL)[^}]*\}/g)];
      expect(
        offenders,
        `entrypoint must escape \${VAR} as $${"{VAR}"} for shell-side env\n` +
          `unescaped: ${offenders.map((o) => o[0]).join(", ")}`,
      ).toEqual([]);
    }
  });

  test("edge-proxy depends_on mesh-router via service_started (not service_healthy)", () => {
    // service_healthy with short start_period killed the previous deploy
    // when NetBird took >60s to enroll. service_started only requires the
    // container to have started — DNAT rules are in place within seconds.
    const edgeProxyBlock = /\n {2}edge-proxy:[\s\S]*?(?=\n {2}[a-z-]+:|\nvolumes:|\nnetworks:|$)/;
    const block = PREBUILT.match(edgeProxyBlock)?.[0] ?? "";
    expect(
      /depends_on:[\s\S]*?mesh-router:[\s\S]*?condition: service_started/.test(block),
      "edge-proxy depends_on mesh-router must use condition: service_started",
    ).toBe(true);
    expect(
      /depends_on:[\s\S]*?mesh-router:[\s\S]*?condition: service_healthy/.test(block),
      "edge-proxy must NOT use condition: service_healthy (caused timeout regressions)",
    ).toBe(false);
  });
});

describe("Dirigent — domain doctor contract", () => {
  test("scripts/coolify-domain-doctor.mjs documents the dynamic routing source of truth", () => {
    expect(
      DOCTOR.includes("production routing source of truth") &&
        DOCTOR.includes("docker_compose_domains"),
      "domain doctor must document docker_compose_domains as production routing source of truth",
    ).toBe(true);
  });

  test("doctor registers edge-proxy real public hostnames; mesh-router stays sentinel", () => {
    // CORRECTED 2026-06-09 (verified in prod: auth.aisha.guru → HTTP 200):
    // edge-proxy is the Caddy LISTENER (port 80). Registering its real public
    // hostnames in docker_compose_domains makes Coolify auto-gen one Traefik
    // router per host + the matching loadbalancer service — the working path.
    // The earlier sentinel-only design relied on static ${VAR} Traefik labels,
    // which are DEAD on Coolify ($ → $$ escaping). So edge-proxy must carry
    // the dynamic public hostnames, NOT a sentinel.
    expect(
      // edge-proxy registers the dynamic public hostnames (auth/api/mcp/dirigent)
      // — either inline, or via the edgeProxyDomains() helper (refactored
      // 2026-06-16 to add AISHA_WEB_APEX_MODE serve/redirect handling). Both
      // forms must carry the four dynamic hostnames; the guarantee is unchanged.
      (/name:\s*"edge-proxy",\s*\n\s*domain:\s*edgeProxyDomains\(\)/.test(DOCTOR) &&
        /function edgeProxyDomains[\s\S]*?AUTH_DOMAIN_PUBLIC[\s\S]*?API_DOMAIN_PUBLIC[\s\S]*?MCP_DOMAIN[\s\S]*?DIRIGENT_DOMAIN/.test(
          DOCTOR,
        )) ||
        /name:\s*"edge-proxy",\s*\n\s*domain:\s*\[[\s\S]*?AUTH_DOMAIN_PUBLIC[\s\S]*?MCP_DOMAIN[\s\S]*?DIRIGENT_DOMAIN/.test(
          DOCTOR,
        ),
      "doctor must register edge-proxy with the dynamic public hostnames (auth/api/mcp/dirigent), not a sentinel",
    ).toBe(true);
    expect(
      DOCTOR.includes("edge-proxy-disabled.invalid"),
      "edge-proxy must NOT use the disabled sentinel — it's the real Caddy listener",
    ).toBe(false);
    // mesh-router has no public listener — it stays a sentinel so Coolify
    // doesn't try to register (and fail) a Traefik route for it.
    //
    // Assert the PROPERTY (a non-routable .invalid sentinel), not one literal
    // spelling. The sentinel must also be prefix-unique — Coolify validates
    // domain uniqueness ACROSS projects, so a shared literal 409s against every
    // co-tenant's edge on the same host (observed: tenant-studio-edge). Pinning
    // the old exact string here is what made that fix land red.
    expect(
      /mesh-router-[^"'`\s]*disabled\.invalid/.test(DOCTOR),
      "doctor must declare a mesh-router *.invalid sentinel (no public listener in this container)",
    ).toBe(true);
    expect(
      /mesh-router-\$\{[^}]*\}-disabled\.invalid|mesh-router-\$\{appPrefix\(\)\}-disabled\.invalid/.test(
        DOCTOR,
      ),
      "mesh-router sentinel must be prefix-unique (Coolify enforces domain uniqueness across projects — a shared literal 409s against co-tenants)",
    ).toBe(true);
  });
});

describe("Dirigent — shared-host Traefik isolation", () => {
  const COMPOSE = readFileSync(
    join(ROOT, "docker-compose.coolify-prebuilt.yml"),
    "utf-8",
  );

  test("edge-proxy has no custom Traefik HTTP routers or services", () => {
    const edgeProxyBlock = COMPOSE.match(
      /\n {2}edge-proxy:[\s\S]*?(?=\n {2}[a-z-]+:|\nvolumes:|\nnetworks:|$)/,
    )?.[0] ?? "";
    expect(
      edgeProxyBlock,
      "edge-proxy block must remain parseable",
    ).toBeTruthy();
    expect(
      edgeProxyBlock,
      "Coolify generates instance-scoped ingress from docker_compose_domains; custom HTTP labels collide across co-tenants",
    ).not.toMatch(/traefik\.http\.(?:routers|services)\./);
    expect(
      edgeProxyBlock,
      "edge-proxy remains explicitly Coolify-managed",
    ).toContain("coolify.managed=true");
  });

  test("domain doctor owns MCP/API/Dirigent/Auth public hosts", () => {
    expect(
      /function edgeProxyDomains[\s\S]*?AUTH_DOMAIN_PUBLIC[\s\S]*?API_DOMAIN_PUBLIC[\s\S]*?MCP_DOMAIN[\s\S]*?DIRIGENT_DOMAIN/.test(
        DOCTOR,
      ),
      "edgeProxyDomains must keep all mandatory edge routes in the Coolify domain contract",
    ).toBe(true);
  });
});

describe("Dirigent — smoke probe", () => {
  test("scripts/smoke-routing.sh probes the Dirigent domain", () => {
    expect(
      SMOKE.includes("dirigent.aisha.guru") || SMOKE.includes("DIRIGENT_DOMAIN"),
      "smoke-routing must include a Dirigent domain probe",
    ).toBe(true);
  });
});

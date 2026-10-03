/**
 * OAuth2 Proxy Configuration Gate
 *
 * Cross-checks OAuth2 Proxy environment variables against the Traefik
 * Host(...) labels and `docker_compose_domains` references they actually
 * serve. Prevents three failure modes:
 *
 * 1. **Cookie domain ≠ served domain**
 *    e.g. `OAUTH2_PROXY_COOKIE_DOMAINS=.aisha.guru` but proxy serves
 *    `n8n.backend.id3a.cz` direct → browser drops cookie → infinite auth loop.
 *
 * 2. **Missing defensive skip-auth routes**
 *    `/healthz` (or service-specific health) and `/.well-known/.*` should
 *    bypass auth so health probes and ACME challenges (if Traefik config
 *    ever delegates to upstream) keep working.
 *
 * 3. **Overly permissive skip-auth patterns**
 *    `^/api/.*` or `^/api/v1/.*` exposes admin APIs without auth — even if
 *    the upstream service has its own auth, defense-in-depth requires the
 *    proxy to enforce at the entrypoint.
 *
 * Plus a Synapse-specific check (registration_shared_secret consistency).
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function getComposeFiles(): { relPath: string; content: string }[] {
  const out: { relPath: string; content: string }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      if (name.includes("local")) continue;
      out.push({ relPath: name, content: readSafe(join(ROOT, name)) });
    }
  }
  return out;
}

interface OAuthProxy {
  file: string;
  service: string;
  cookieDomains: string;
  redirectUrl: string;
  skipAuthRoutes: string;
  oidcIssuerUrl: string;
  hostLabels: string[];
}

function extractServiceBlock(content: string, name: string): string | null {
  const lines = content.split("\n");
  let inServices = false;
  let capturing = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      if (capturing) break;
      inServices = false;
      continue;
    }
    const m = line.match(/^ {2}([a-zA-Z][\w-]*):/);
    if (m) {
      if (capturing) break;
      if (m[1] === name) { capturing = true; out.push(line); continue; }
    }
    if (capturing) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent <= 2 && line.trim() && /^\s{2}[a-zA-Z]/.test(line)) break;
      out.push(line);
    }
  }
  return out.length ? out.join("\n") : null;
}

function findOAuthProxies(): OAuthProxy[] {
  const proxies: OAuthProxy[] = [];
  for (const f of getComposeFiles()) {
    const lines = f.content.split("\n");
    let inServices = false;
    for (const line of lines) {
      if (/^services:\s*$/.test(line)) { inServices = true; continue; }
      if (!inServices) continue;
      const m = line.match(/^ {2}([a-zA-Z][\w-]*):/);
      if (!m) continue;
      const block = extractServiceBlock(f.content, m[1]);
      if (!block || !block.includes("oauth2-proxy")) continue;

      const env = (key: string): string => {
        const re = new RegExp(`OAUTH2_PROXY_${key}:\\s*(.+)`);
        const result = block.match(re);
        return result ? result[1].trim().replace(/^["']|["']$/g, "") : "";
      };
      // For VALUE comparisons (cookie_domains, redirect_url) we need to
      // resolve ${VAR:-default} → default for static analysis. For
      // TEMPLATING checks (oidcIssuerUrl) we want the raw form.
      const envResolved = (key: string): string => {
        let v = env(key);
        v = v.replace(/\$\{[^:}]+:-([^}]+)\}/g, "$1");
        v = v.replace(/\$\{[^}]+\}/g, "");
        return v;
      };

      const hostLabels = Array.from(
        new Set(
          [...block.matchAll(/Host\(`([^`]+)`\)/g)]
            .map((h) => h[1].replace(/\$\{[^:}]+:-([^}]+)\}/g, "$1").replace(/\$\{[^}]+\}/g, ""))
            .filter(Boolean),
        ),
      );

      proxies.push({
        file: f.relPath,
        service: m[1],
        cookieDomains: envResolved("COOKIE_DOMAINS"),
        redirectUrl: envResolved("REDIRECT_URL"),
        skipAuthRoutes: env("SKIP_AUTH_ROUTES"),
        oidcIssuerUrl: env("OIDC_ISSUER_URL"), // raw — templating check needs ${VAR}
        hostLabels,
      });
    }
  }
  return proxies;
}

const PROXIES = findOAuthProxies();

describe("OAuth2 Proxy — discovery", () => {
  test("at least 4 OAuth2 Proxy services discovered", () => {
    expect(PROXIES.length, `Found: ${PROXIES.map((p) => p.service).join(", ")}`).toBeGreaterThanOrEqual(4);
  });
});

describe("OAuth2 Proxy — OIDC issuer templating", () => {
  test("OIDC issuer URL is templated (not hardcoded)", () => {
    const violations = PROXIES.filter(
      (p) => p.oidcIssuerUrl && !p.oidcIssuerUrl.includes("${KEYCLOAK_DOMAIN") &&
             !p.oidcIssuerUrl.includes("${KC_URL"),
    );
    expect(
      violations.map((p) => `${p.file} ${p.service}: ${p.oidcIssuerUrl}`),
      "OIDC issuer URL should reference ${KEYCLOAK_DOMAIN} or ${KC_URL}, not be hardcoded",
    ).toEqual([]);
  });
});

describe("OAuth2 Proxy — cookie domain matches served hosts", () => {
  test("cookie_domains covers every Traefik Host(...) label served by the proxy", () => {
    const violations: string[] = [];
    for (const p of PROXIES) {
      if (!p.cookieDomains) continue;
      const allowedDomains = p.cookieDomains.split(",").map((d) => d.trim());

      for (const host of p.hostLabels) {
        const ok = allowedDomains.some((d) => host.endsWith(d) || host === d.replace(/^\./, ""));
        if (!ok) {
          violations.push(
            `${p.file} ${p.service}: serves Host(${host}) but cookie_domains=[${allowedDomains.join(",")}] does not cover it`,
          );
        }
      }
    }
    expect(
      violations,
      "Cookie domain mismatch with served Host labels — auth flows will loop on uncovered hosts",
    ).toEqual([]);
  });

  test("Frontend edge-proxy preserves public Host context for OAuth cookie selection", () => {
    const prebuilt = readSafe(join(ROOT, "docker-compose.coolify-prebuilt.yml"));
    const block = extractServiceBlock(prebuilt, "edge-proxy") ?? "";

    const violations: string[] = [];
    // Two valid forwarding strategies for OAuth context (depending on upstream):
    //   A) Direct mesh upstream (gateway accepts any Host):
    //      header_up Host {http.request.host}  → browser's *.aisha.guru
    //   B) Public-URL upstream (backend Traefik routes by Host):
    //      header_up Host = upstream's host (api.backend.id3a.cz)
    //      header_up X-Forwarded-Host = browser's *.aisha.guru
    //      OAuth2 Proxy cookie-scopes via X-Forwarded-Host (multi-zone
    //      COOKIE_DOMAINS — see feedback_oauth2_multi_zone_cookies).
    const usesBrowserHost = block.includes("header_up Host {http.request.host}");
    const usesUpstreamHostVar = /header_up Host \$\$\{[a-z_]+_host\}/.test(block);
    if (!usesBrowserHost && !usesUpstreamHostVar) {
      violations.push("edge-proxy: must forward Host (either {http.request.host} or upstream host var)");
    }
    if (!block.includes("header_up X-Forwarded-Host {http.request.host}")) {
      violations.push("edge-proxy: must preserve X-Forwarded-Host for OAuth cookie scoping");
    }
    // Healthcheck decoupled from upstream: a local `/__edge_health` Caddy
    // handle returns 200 without traversing the mesh — keeps edge `healthy`
    // even when upstream is briefly down, so Coolify Traefik keeps the
    // route bound and OAuth callbacks complete.
    if (!block.includes("/__edge_health")) {
      violations.push("edge-proxy: healthcheck must use local /__edge_health (decoupled from upstream)");
    }

    expect(
      violations,
      "Frontend edge-proxy must preserve OAuth context via Host or X-Forwarded-Host, and use a local edge healthcheck.",
    ).toEqual([]);
  });

  test("Backend OAuth routes are generated from the tenant domain contract", () => {
    const pgadmin = readSafe(join(ROOT, "docker-compose.coolify-pgadmin.yml"));
    const n8n = readSafe(join(ROOT, "docker-compose.coolify-n8n.yml"));
    const doctor = readSafe(join(ROOT, "scripts/coolify-domain-doctor.mjs"));

    expect(pgadmin).not.toContain("traefik.http.routers.");
    expect(n8n).not.toContain("traefik.http.routers.");
    expect(doctor).toMatch(
      /"aisha-pgadmin"[\s\S]{0,180}name: "pgadmin-auth", domain: `https:\/\/\$\{env\.STUDIO_DOMAIN_DIRECT\}:4180`/,
    );
    expect(doctor).toMatch(
      /"aisha-orchestration"[\s\S]{0,260}https:\/\/\$\{env\.MCP_DOMAIN\}:4180[\s\S]{0,100}https:\/\/\$\{env\.DIRIGENT_DOMAIN\}:4180/,
    );
  });

  test("n8n Keycloak client accepts operator-templated OAuth callbacks", () => {
    const realm = JSON.parse(readSafe(join(ROOT, "keycloak/aisha-realm.json")));
    const client = (realm.clients ?? []).find((candidate: { clientId?: string }) => candidate.clientId === "n8n-proxy");

    expect(client, "n8n-proxy client must exist").toBeTruthy();
    expect(client.redirectUris).toEqual(expect.arrayContaining([
      "https://${N8N_DOMAIN}/oauth2/callback",
      "https://${MCP_DOMAIN}/oauth2/callback",
      "https://${DIRIGENT_DOMAIN}/oauth2/callback",
    ]));
    expect(client.webOrigins).toEqual(expect.arrayContaining([
      "https://${N8N_DOMAIN}",
      "https://${MCP_DOMAIN}",
      "https://${DIRIGENT_DOMAIN}",
    ]));
  });

  test("n8n OAuth2 Proxy derives redirect URL from request Host", () => {
    const compose = readSafe(join(ROOT, "docker-compose.coolify-n8n.yml"));
    const deployInit = readSafe(join(ROOT, "scripts/coolify-deploy-init.sh"));
    const block = extractServiceBlock(compose, "n8n-auth") ?? "";

    expect(block).not.toContain("OAUTH2_PROXY_REDIRECT_URL");
    expect(block).toContain("OAUTH2_PROXY_REVERSE_PROXY: \"true\"");
    expect(
      deployInit,
      "coolify-deploy-init.sh must delete stale OAUTH2_PROXY_REDIRECT_URL from Coolify env; Coolify can still inject keys removed from compose.",
    ).toContain('delete_coolify_env "$local_uuid" "OAUTH2_PROXY_REDIRECT_URL"');
  });

  test("mcp/dirigent public aliases: edge forwards the BROWSER Host and backend registers alias routers", () => {
    // Verified in prod 2026-07-03: backend Traefik rewrites the untrusted
    // X-Forwarded-Host set by edge Caddy to the Host it received, so with
    // the old strategy (header_up Host = internal n8n host, XFH = public
    // alias) oauth2-proxy derived cookie Domain + redirect_uri from the
    // INTERNAL zone → the browser dropped the session cookie on
    // mcp.<public-zone> → infinite login loop. (Keycloak on the same chain
    // was unaffected only because KC_HOSTNAME pins its public issuer.)
    // Contract: edge @mcp/@dirigent forward {http.request.host} as Host,
    // and the orchestration app registers the public aliases in
    // docker_compose_domains so backend Traefik routes them to n8n-auth.
    const prebuilt = readSafe(join(ROOT, "docker-compose.coolify-prebuilt.yml"));
    for (const route of ["@mcp host", "@dirigent host"]) {
      const idx = prebuilt.indexOf(route);
      expect(idx, `${route} block must exist in edge-proxy Caddyfile`).toBeGreaterThan(0);
      // The handle block is a few lines; a bounded window after the matcher
      // is enough to capture its header_up directives.
      const block = prebuilt.slice(idx, idx + 400);
      expect(
        block,
        `${route} must forward the browser Host so oauth2-proxy scopes cookies to the public zone`,
      ).toContain("header_up Host {http.request.host}");
    }

    const doctor = readSafe(join(ROOT, "scripts/coolify-domain-doctor.mjs"));
    expect(doctor, "doctor must register the MCP alias on n8n-auth").toContain(
      "`https://${env.MCP_DOMAIN}:4180`",
    );
    expect(doctor, "doctor must register the DIRIGENT alias on n8n-auth").toContain(
      "`https://${env.DIRIGENT_DOMAIN}:4180`",
    );

    const deployInit = readSafe(join(ROOT, "scripts/coolify-deploy-init.sh"));
    expect(deployInit, "deploy-init must register the same alias contract").toContain(
      "n8n-auth=https://${N8N_DOMAIN}:4180,https://${MCP_DOMAIN:?MCP_DOMAIN required}:4180,https://${DIRIGENT_DOMAIN:?DIRIGENT_DOMAIN required}:4180",
    );
  });

  test("n8n public cookie domains reference OAUTH2_COOKIE_DOMAINS env (operator-set, no in-compose default per template-only directive)", () => {
    const compose = readSafe(join(ROOT, "docker-compose.coolify-n8n.yml"));
    const block = extractServiceBlock(compose, "n8n-auth") ?? "";

    // Per iter 10 cleanup, OAUTH2_PROXY_COOKIE_DOMAINS is bare-referenced from
    // env. Operator declares the comma-separated zones (e.g. `.app-domain.com,.internal.com`)
    // in .env-prod-backup so the OAuth2 Proxy issues cookies on every served
    // host. env-doctor maintains the contract entry for OAUTH2_COOKIE_DOMAINS.
    expect(block).toContain("OAUTH2_PROXY_COOKIE_DOMAINS: ${OAUTH2_COOKIE_DOMAINS}");
  });
});

describe("OAuth2 Proxy — skip-auth route hygiene", () => {
  test("no overly permissive `^/api/.*` or `^/api/v1/.*` skip-auth routes", () => {
    const violations: string[] = [];
    for (const p of PROXIES) {
      if (!p.skipAuthRoutes) continue;
      const broad = /\^\/api\/(?:v1\/)?\.\*[,$]?/;
      if (broad.test(p.skipAuthRoutes + ",")) {
        violations.push(
          `${p.file} ${p.service}: SKIP_AUTH_ROUTES contains broad pattern ^/api/.* or ^/api/v1/.* — exposes APIs to unauthenticated callers`,
        );
      }
    }
    expect(
      violations,
      "OAuth2 Proxy skip-auth must not bypass entire API surfaces — be specific",
    ).toEqual([]);
  });

  test("every proxy has a health-route bypass", () => {
    const violations: string[] = [];
    for (const p of PROXIES) {
      const hasHealth =
        /healthz|\/health|\/ping/.test(p.skipAuthRoutes) ||
        // Some proxies don't define skip_auth at all — check for /ping fallback
        p.skipAuthRoutes === "";
      if (!hasHealth && p.skipAuthRoutes !== "") {
        violations.push(`${p.file} ${p.service}: SKIP_AUTH_ROUTES="${p.skipAuthRoutes}" — no health bypass`);
      }
    }
    expect(violations, "Defensive: each OAuth2 Proxy should bypass auth on health endpoints").toEqual([]);
  });

  test("every proxy has /.well-known/* bypass (defensive for ACME and OIDC discovery)", () => {
    const violations: string[] = [];
    for (const p of PROXIES) {
      if (p.skipAuthRoutes === "") continue;
      // The YAML source has `\\.well-known` (escaped dot). At runtime the value
      // is `\.well-known`. Match either the literal substring "well-known"
      // anywhere in the route list — that's sufficient signal.
      const hasWellKnown = /well-known/.test(p.skipAuthRoutes);
      if (!hasWellKnown) {
        violations.push(
          `${p.file} ${p.service}: SKIP_AUTH_ROUTES does not include /.well-known/.* (defensive against ACME/OIDC discovery edge cases)`,
        );
      }
    }
    expect(
      violations,
      "Defensive: bypass /.well-known/* — covers ACME challenges and OIDC discovery if proxy ever sits in the cert path",
    ).toEqual([]);
  });
});

describe("Synapse — registration_shared_secret hygiene", () => {
  const homeserverPath = join(ROOT, "coolify/synapse/homeserver.yaml");

  test("registration_shared_secret is only allowed for internal svc-matrix token exchange", () => {
    expect(existsSync(homeserverPath), "coolify/synapse/homeserver.yaml not found").toBe(true);
    const content = readSafe(homeserverPath);
    const matrixCompose = readSafe(join(ROOT, "docker-compose.coolify-matrix.yml"));

    const enableMatch = content.match(/enable_registration:\s*(true|false)/);
    expect(enableMatch?.[1], "public Matrix registration must stay disabled").toBe("false");

    const sharedSecretMatch = content.match(/registration_shared_secret:\s*(.+)/);
    if (!sharedSecretMatch) return;
    const value = sharedSecretMatch[1].trim().replace(/^["']|["']$/g, "");

    if (!value) return;

    expect(value, "shared secret must come from Coolify env, never literal source").toBe("${SYNAPSE_REGISTRATION_SECRET}");
    expect(matrixCompose).toContain("svc-matrix:");
    expect(matrixCompose).toContain("- SYNAPSE_REGISTRATION_SECRET=${SYNAPSE_REGISTRATION_SECRET}");
    expect(matrixCompose).toContain("SYNAPSE_REGISTRATION_SECRET: ${SYNAPSE_REGISTRATION_SECRET}");
    // KEYCLOAK_DOMAIN_PUBLIC + KEYCLOAK_REALM come from Coolify env (env-doctor +
    // .env-prod-backup). Iter 10/11 stripped the in-compose deployment default
    // and the literal `aisha` realm to keep the repo template-only.
    // KEYCLOAK_DOMAIN_PUBLIC (auth.aisha.guru) is used — not the internal
    // KEYCLOAK_DOMAIN — because containers must reach the public canonical issuer.
    expect(matrixCompose).toContain("KEYCLOAK_ISSUER: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}");
  });
});

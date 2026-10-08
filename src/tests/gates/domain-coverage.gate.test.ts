/**
 * Domain Coverage Gate — closed loop between topology resolver and verifier,
 * plus the env-derived apex redirect contract.
 *
 * Origin (2026-06-12 post-wipe cold-start): the apex host (bare PUBLIC_TLD,
 * e.g. the operator's naked domain) returned an edge 404 while APP_DOMAIN
 * served fine. Two systemic gaps allowed it:
 *   1. The apex was absent from EVERY env-derived routing plane (Caddy
 *      template, Traefik labels, deploy-init docker_compose_domains, domain
 *      doctor contract) — nothing propagated it from env.
 *   2. scripts/cold-start-verify.mjs probes were 100% hand-maintained — a
 *      domain emitted by the topology resolver never automatically joined
 *      verification, so "publicly expected host is unrouted" had NO check.
 *
 * What this gate locks:
 *   A. CLOSED LOOP — every `*_DOMAIN` / `*_DOMAIN_PUBLIC` hostname emitted by
 *      `derive-domains.mjs --shell` (canonical scope + public faces; alias
 *      internal forms and `.invalid` sentinels excluded) appears in
 *      `cold-start-verify.mjs --print-coverage` output (curated or generic
 *      probe). Both sides are parsed programmatically — no hardcoded hosts.
 *   B. APEX CONTRACT — the resolver emits EDGE_APEX_DOMAIN per the env
 *      condition (redirect mode + PUBLIC_TLD set and != APP_DOMAIN → apex;
 *      else unroutable sentinel), the edge compose templates the conditional
 *      308 redirect, and deploy-init + domain doctor register the apex host
 *      under the same condition. In serve mode the apex belongs to the web
 *      container and DB branding_hostname_mapping chooses the GrapesJS page.
 *      Verified with the generic `.example` profile values only.
 *
 * Run via: npm run test:gates (offline — no HTTP probes are executed;
 * --print-coverage computes the probe plan without touching the network).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verejneDomenyWebu } from "../../../scripts/lib/domeny-webu.mjs";

const ROOT = process.cwd();
const DERIVE_SCRIPT = join(ROOT, "scripts/lib/derive-domains.mjs");
const VERIFY_SCRIPT = join(ROOT, "scripts/cold-start-verify.mjs");
const EDGE_COMPOSE = join(ROOT, "docker-compose.coolify-prebuilt.yml");

// Reference TLDs read DYNAMICALLY from the .example profile — the same source
// the resolver falls back to. The gate never hardcodes deployment hostnames
// (no-hardcoded-deployment-config stays authoritative).
const exampleProfile = JSON.parse(
  readFileSync(join(ROOT, "config/profiles/cloud-multi.json.example"), "utf-8"),
) as { domain: { public_tld: string; internal_tld: string; mesh_tld: string } };
const PUB = exampleProfile.domain.public_tld;

// Deterministic child env: minimal inherited vars + explicit reference TLDs so
// developer-machine exports (APP_DOMAIN etc.) can't leak into the computation.
const CHILD_ENV = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  AISHA_PROFILE: "cloud-multi",
  MESH_ENABLED: "false",
  PUBLIC_TLD: exampleProfile.domain.public_tld,
  INTERNAL_TLD: exampleProfile.domain.internal_tld,
  MESH_TLD: exampleProfile.domain.mesh_tld,
};

function parseEnvLines(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Resolver-side of the loop: routed domain contract (key → hostname). */
function resolverDomains(): Record<string, string> {
  const shell = execFileSync("node", [DERIVE_SCRIPT, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    env: CHILD_ENV,
  });
  const all = parseEnvLines(shell);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!/_DOMAIN$|_DOMAIN_(PUBLIC|INTERNAL)$/.test(key)) continue;
    // Alias-scope INTERNAL emissions of public-canonical services are
    // convenience forms no routing plane registers — not part of the
    // routed contract (mirror of cold-start-verify's enumeration).
    if (/_INTERNAL_DOMAIN$|_DOMAIN_INTERNAL$/.test(key)) continue;
    if (!value || value.endsWith(".invalid")) continue;
    out[key] = value;
  }
  return out;
}

interface CoveragePlan {
  profile: string;
  resolverError: string;
  apex: { enabled: boolean; domain: string; redirectTarget: string };
  checks: Array<{
    group: string;
    name: string;
    url: string;
    host: string;
    expect: number[];
    expectLocationPrefix?: string;
    genericCoverage?: boolean;
    domainKeys?: string[];
  }>;
  topologyDomains: Record<string, string>;
}

/** Verifier-side of the loop: the computed probe plan (offline). */
function coveragePlan(): CoveragePlan {
  const json = execFileSync("node", [VERIFY_SCRIPT, "--print-coverage"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    env: CHILD_ENV,
  });
  // Hledá se PRVNÍ `{`, od kterého zbytek parsuje jako JSON — před ním smí být
  // varování resolveru. Dřív tu stálo `{"profile":`, tedy pin na to, který klíč
  // je první; přidat do plánu cokoli před `profile` tuhle bránu shodilo, aniž
  // by se na plánu sond cokoli pokazilo. Pořadí klíčů není vlastnost, kterou má
  // tahle brána hlídat.
  let plan: CoveragePlan | null = null;
  for (let i = json.indexOf("{"); i >= 0; i = json.indexOf("{", i + 1)) {
    try {
      plan = JSON.parse(json.slice(i)) as CoveragePlan;
      break;
    } catch {
      /* další kandidát */
    }
  }
  expect(plan, "coverage printer must emit a JSON object").not.toBeNull();
  return plan as CoveragePlan;
}

describe("Domain coverage — resolver ⊆ cold-start-verify (closed loop)", () => {
  test("every routed *_DOMAIN the resolver emits has a probe (curated or generic)", () => {
    const domains = resolverDomains();
    const plan = coveragePlan();
    expect(plan.resolverError, "verify must resolve the topology").toBe("");

    const coveredHosts = new Set(plan.checks.map((check) => check.host));
    const uncovered = Object.entries(domains).filter(([, host]) => !coveredHosts.has(host));

    expect(
      uncovered.map(([key, host]) => `${key}=${host}`),
      "Topology emits domains that cold-start-verify would never probe — the " +
        "closed loop is broken (this is exactly how the unrouted apex escaped " +
        "on 2026-06-12). Extend the curated list or fix the generic enumeration " +
        "in scripts/cold-start-verify.mjs:\n" +
        uncovered.map(([key, host]) => `  ${key}=${host}`).join("\n"),
    ).toEqual([]);

    // Sanity floor: the curated list must not have been silently emptied in
    // favor of generic probes (curated checks carry precise paths/codes).
    const curated = plan.checks.filter((check) => !check.genericCoverage);
    expect(curated.length, "curated probe list collapsed").toBeGreaterThanOrEqual(10);
  });

  test("generic probes prove a route exists: tolerate auth walls, fail on edge-404", () => {
    const plan = coveragePlan();
    const generic = plan.checks.filter((check) => check.genericCoverage);
    expect(generic.length, "expected at least one generic coverage probe").toBeGreaterThan(0);
    for (const check of generic) {
      expect(check.expect, `${check.name}: 200 must prove the route`).toContain(200);
      expect(check.expect, `${check.name}: auth wall (401) must prove the route`).toContain(401);
      expect(check.expect, `${check.name}: auth wall (403) must prove the route`).toContain(403);
      expect(check.expect, `${check.name}: edge-404 must FAIL`).not.toContain(404);
      expect(check.url, `${check.name}: probes are HTTPS`).toMatch(/^https:\/\//);
    }
  });

  test("apex probe: 308 to APP_DOMAIN, present exactly when PUBLIC_TLD != APP_DOMAIN", () => {
    const plan = coveragePlan();
    // Reference profile: APP_DOMAIN = web.<PUBLIC_TLD> → apex rule applies.
    expect(plan.apex.enabled, "apex rule must apply for the reference profile").toBe(true);
    expect(plan.apex.domain).toBe(PUB);
    expect(plan.apex.redirectTarget).toBe(`https://web.${PUB}`);

    const apexChecks = plan.checks.filter((check) => check.host === PUB);
    expect(apexChecks.length, "exactly one apex probe").toBe(1);
    expect(apexChecks[0].expect, "apex must answer HTTP 308").toEqual([308]);
    expect(
      apexChecks[0].expectLocationPrefix,
      "apex redirect must target the canonical web host",
    ).toBe(`https://web.${PUB}`);
  });
});

describe("Apex redirect — env-derived contract (resolver + templates)", () => {
  test("resolver emits EDGE_APEX_DOMAIN=PUBLIC_TLD when the rule applies", () => {
    const shell = execFileSync("node", [DERIVE_SCRIPT, "--shell"], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      env: CHILD_ENV,
    });
    const all = parseEnvLines(shell);
    expect(all.EDGE_APEX_DOMAIN, "resolver must emit the apex routing key").toBe(PUB);
    expect(all.APP_DOMAIN).toBe(`web.${PUB}`);
  });

  test("deriveApexRedirect: sentinel (disabled) when PUBLIC_TLD unset or == APP_DOMAIN", async () => {
    const mod = await import(pathToFileURL(DERIVE_SCRIPT).href);
    const sentinel = mod.APEX_REDIRECT_DISABLED_SENTINEL as string;
    expect(sentinel, "sentinel must be unroutable (RFC 6761)").toMatch(/\.invalid$/);

    // Rule applies → apex domain = PUBLIC_TLD, redirect target = APP_DOMAIN.
    const enabled = mod.deriveApexRedirect(`${PUB}`, `web.${PUB}`);
    expect(enabled).toEqual({
      enabled: true,
      mode: "redirect",
      apexDomain: PUB,
      redirectTarget: `web.${PUB}`,
    });

    // Empty-safe: unset PUBLIC_TLD → disabled (community installs unaffected).
    expect(mod.deriveApexRedirect("", `web.${PUB}`).enabled).toBe(false);
    expect(mod.deriveApexRedirect("", `web.${PUB}`).apexDomain).toBe(sentinel);
    expect(mod.deriveApexRedirect(undefined, undefined).enabled).toBe(false);

    // Equal-safe: web app itself owns the apex → disabled (no redirect loop).
    const equal = mod.deriveApexRedirect(PUB, PUB);
    expect(equal.enabled).toBe(false);
    expect(equal.apexDomain).toBe(sentinel);

    // Serve mode: the apex is not an edge redirect; Coolify routes it to the
    // web container and DB branding_hostname_mapping resolves the page.
    const served = mod.deriveApexRedirect(PUB, `web.${PUB}`, "serve");
    expect(served).toEqual({
      enabled: false,
      mode: "serve",
      apexDomain: sentinel,
      redirectTarget: "",
    });
  });

  test("resolver emits serve-mode apex sentinel and carries the mode", () => {
    const shell = execFileSync("node", [DERIVE_SCRIPT, "--shell"], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      env: { ...CHILD_ENV, AISHA_WEB_APEX_MODE: "serve" },
    });
    const all = parseEnvLines(shell);
    expect(all.AISHA_WEB_APEX_MODE).toBe("serve");
    expect(all.EDGE_APEX_DOMAIN).toMatch(/\.invalid$/);
    expect(all.APP_DOMAIN).toBe(`web.${PUB}`);
  });

  test("edge compose templates the conditional apex 308 (path+query preserved)", () => {
    const compose = readFileSync(EDGE_COMPOSE, "utf-8");

    // Runtime condition in the edge-proxy entrypoint — both empty-safe and
    // equality-safe ($$-escaped so the container shell evaluates env).
    expect(compose, "empty-safe PUBLIC_TLD guard").toContain('[ -n "$${PUBLIC_TLD:-}" ]');
    expect(compose, "empty-safe APP_DOMAIN guard").toContain('[ -n "$${APP_DOMAIN:-}" ]');
    expect(compose, "apex must not fire when apex == APP_DOMAIN").toContain(
      '[ "$${PUBLIC_TLD}" != "$${APP_DOMAIN}" ]',
    );
    expect(compose, "serve mode must disable the edge apex redirect").toContain(
      '[ "$${apex_mode}" != "serve" ]',
    );

    // 308 redirect preserving path+query ({uri} carries both in Caddy).
    expect(compose, "Caddy redir must be 308 and preserve {uri}").toMatch(
      /redir https:\/\/%s\{uri\} 308/,
    );

    // The apex block lands inside the generated Caddyfile.
    expect(compose, "apex block placeholder must be in the Caddyfile heredoc").toContain(
      "$${apex_block}",
    );

    // env plumbing: per-app Coolify payload = .env.coolify ∩ compose ${VAR}
    // refs — the compose must reference both vars (empty-safe, no literal
    // fallback) for the sync filter to deliver them.
    expect(compose).toContain("PUBLIC_TLD: ${PUBLIC_TLD:-}");
    expect(compose).toContain("APP_DOMAIN: ${APP_DOMAIN:-}");
    expect(compose).toContain("AISHA_WEB_APEX_MODE: ${AISHA_WEB_APEX_MODE:-redirect}");

    // Traefik plane: Coolify generates the instance-scoped router from
    // docker_compose_domains. Custom mesh-apex labels are forbidden because
    // their global names collide when several instances share one host.
    expect(compose).not.toContain("traefik.http.routers.mesh-apex-");
  });

  test("optional edge-fronted public faces (live/gateway/companion) are registered by every production routing plane", () => {
    // Class lock (2026-07-03): the resolver emitted LIVE/GATEWAY/COMPANION
    // public hostnames but NO routing plane registered them → public 404 on
    // live.*, gateway.* (IDE ANTHROPIC_BASE_URL surface) and companion.*.
    // Every plane must carry the same guarded contract:
    //   resolver → *_UPSTREAM_PUBLIC emissions + `.invalid` sentinels,
    //   edge compose → env refs + conditional Caddy blocks,
    //   doctor + deploy-init → guarded edge-proxy docker_compose_domains.
    const FACES = ["LIVE_DOMAIN_PUBLIC", "GATEWAY_DOMAIN_PUBLIC", "COMPANION_DOMAIN_PUBLIC"] as const;

    const resolver = readFileSync(DERIVE_SCRIPT, "utf-8");
    expect(resolver).toContain("GATEWAY_UPSTREAM_PUBLIC=");
    expect(resolver).toContain("COMPANION_UPSTREAM_PUBLIC=");
    expect(resolver).toContain("gateway-disabled.invalid");
    expect(resolver).toContain("companion-disabled.invalid");

    const compose = readFileSync(EDGE_COMPOSE, "utf-8");
    for (const face of FACES) {
      expect(compose, `edge compose must reference ${face}`).toContain(`${face}: \${${face}:-}`);
    }
    expect(
      compose,
      "edge ingress must be generated by Coolify, not shared-name custom Traefik routers",
    ).not.toContain("traefik.http.routers.mesh-");
    expect(compose, "edge entrypoint must build the gateway block").toContain("gateway_block=");
    expect(compose, "edge entrypoint must build the companion block").toContain("companion_block=");

    const doctor = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf-8");
    expect(doctor, "doctor edge contract must include the guarded faces").toMatch(
      /\["KEYCLOAK_DOMAIN_PUBLIC", "LIVE_DOMAIN_PUBLIC", "GATEWAY_DOMAIN_PUBLIC", "COMPANION_DOMAIN_PUBLIC", "INGEST_DOMAIN_PUBLIC", "POTOK_DOMAIN_PUBLIC", "EXTRANET_DOMAIN_PUBLIC"\]/,
    );
    expect(doctor, "doctor must register the realtime internal face").toMatch(
      /"aisha-realtime"[\s\S]{0,220}name: "ws-gateway", domain: `https:\/\/\$\{env\.LIVE_DOMAIN\}:3002`/,
    );

    const deployInit = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf-8");
    expect(deployInit, "deploy-init must append the same guarded faces").toContain(
      "for _edge_face_var in KEYCLOAK_DOMAIN_PUBLIC LIVE_DOMAIN_PUBLIC GATEWAY_DOMAIN_PUBLIC COMPANION_DOMAIN_PUBLIC INGEST_DOMAIN_PUBLIC POTOK_DOMAIN_PUBLIC",
    );

    const coldStart = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
    for (const key of [
      "LIVE_UPSTREAM_PUBLIC=${LIVE_UPSTREAM_PUBLIC:-}",
      "GATEWAY_UPSTREAM_PUBLIC=${GATEWAY_UPSTREAM_PUBLIC:-}",
      "COMPANION_UPSTREAM_PUBLIC=${COMPANION_UPSTREAM_PUBLIC:-}",
      "GATEWAY_DOMAIN_PUBLIC=${GATEWAY_DOMAIN_PUBLIC}",
      "COMPANION_DOMAIN_PUBLIC=${COMPANION_DOMAIN_PUBLIC}",
    ]) {
      expect(coldStart, `.env.coolify heredoc must carry ${key.split("=")[0]}`).toContain(key);
    }
  });

  test("deploy-init and domain doctor register the apex under the same condition", () => {
    const deployInit = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf-8");
    // Režim apexu vykládá od 2026-10-05 jediný normalizátor (lib/domeny-webu.mjs →
    // derive-domains normalizeApexMode) — deploy-init ho dostane z CLI domova.
    expect(deployInit, "deploy-init čte režim apexu z domova").toContain('WEB_APEX_REZIM="$(node "$_di_dir/lib/domeny-webu.mjs" --rezim-apexu)"');
    expect(deployInit, "deploy-init routes apex to edge only in redirect mode").toContain(
      '[ "${WEB_APEX_REZIM}" != "serve" ] && [ -n "${PUBLIC_TLD:-}" ] && [ "${PUBLIC_TLD}" != "${APP_DOMAIN:-}" ]',
    );
    expect(deployInit, "deploy-init appends the apex to edge-proxy domains").toContain(
      'EDGE_PROXY_DOMAINS="${EDGE_PROXY_DOMAINS},https://${PUBLIC_TLD}"',
    );
    // Apex na WEB v režimu serve: od 2026-10-04 ho pro deploy-init i doktor skládá
    // JEDINÝ domov domén webu (lib/domeny-webu.mjs). Měří se proto chování domova
    // a to, že ho oba zapisovatelé volají (úplnou vlastnost hlídá
    // domeny-webu-jeden-domov.gate.test.ts).
    expect(deployInit, "deploy-init skládá web domény domovem").toContain('lib/domeny-webu.mjs" --csv');
    const vstup = { WEB_FQDNS: "", APP_DOMAIN: "web.zona.example", PUBLIC_TLD: "zona.example" };
    expect(verejneDomenyWebu({ ...vstup, AISHA_WEB_APEX_MODE: "serve" }), "serve: apex patří webu").toMatchObject({
      domeny: ["https://web.zona.example", "https://zona.example"],
    });
    expect(verejneDomenyWebu({ ...vstup, AISHA_WEB_APEX_MODE: "redirect" }), "redirect: apex webu nepatří").toMatchObject({
      domeny: ["https://web.zona.example"],
    });

    const doctor = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf-8");
    expect(doctor, "doctor contract carries the edge redirect mode condition").toMatch(
      /apexMode !== "serve"[\s\S]{0,240}https:\/\/\$\{env\.PUBLIC_TLD\}/,
    );
    expect(doctor, "doktor skládá kontrakt web domovem").toMatch(/verejneDomenyWebu\(env\)/);
  });

  test("apex mode keys are registered in both generated .env.coolify sources", () => {
    const coldStart = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
    expect(coldStart, "cold-start heredoc must carry the key").toContain(
      "EDGE_APEX_DOMAIN=${EDGE_APEX_DOMAIN}",
    );
    expect(coldStart, "cold-start heredoc must carry the apex mode").toContain(
      "AISHA_WEB_APEX_MODE=${AISHA_WEB_APEX_MODE}",
    );
    expect(coldStart, "cold-start heredoc must carry operator web aliases").toContain(
      "AISHA_WEB_PUBLIC_ALIASES=${AISHA_WEB_PUBLIC_ALIASES:-}",
    );
    const envDoctor = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf-8");
    expect(envDoctor, "env-doctor contract must self-heal the key").toContain(
      '["EDGE_APEX_DOMAIN", "required-static", topo("EDGE_APEX_DOMAIN")]',
    );
    expect(envDoctor, "env-doctor contract must self-heal the apex mode").toContain(
      '["AISHA_WEB_APEX_MODE", "required-static", topo("AISHA_WEB_APEX_MODE")]',
    );
    expect(envDoctor, "env-doctor contract must carry operator web aliases").toContain(
      '"AISHA_WEB_PUBLIC_ALIASES"',
    );
    expect(envDoctor, "operator web aliases must be sourced from env/prod backup").toContain(
      'process.env.AISHA_WEB_PUBLIC_ALIASES || prodEnv("AISHA_WEB_PUBLIC_ALIASES")',
    );
  });
});

/**
 * Topology Derivation — Integral Design Gate
 *
 * Enforces that the abstract service catalog + profile system can be
 * resolved deterministically into a concrete URL topology, and that
 * required services are present in every cloud profile.
 *
 * Why this gate:
 *   The project is moving from hardcoded `auth.backend.id3a.cz` literals
 *   sprinkled across compose files to a declarative model where domains
 *   are derived from (service, profile, mesh-mode) at deploy time.
 *
 *   This gate is the safety net during the transition — and the
 *   permanent guarantee afterward — that the resolver actually works
 *   for every supported profile.
 *
 * Profiles tested:
 *   - cloud-multi   (production: Frontend + Backend + Experimental)
 *   - cloud-single  (1-server Coolify deployment)
 *   - local-dev     (developer machine; *.local; mesh prepend rewrite)
 *
 * Contract enforced:
 *   1. config/services.json + config/profiles/*.json + scripts/lib/derive-domains.mjs exist
 *   2. Every profile passes derive-domains.mjs --check (depends_on resolves,
 *      no duplicate URLs, required services present)
 *   3. KC and core are present in every cloud profile (auth + data plane)
 *   4. Mesh ON rewrite applies the profile-specific pattern
 *      (cloud-multi: auth.<mesh_tld>; local-dev: mesh.auth.local)
 *   5. Public URLs never get the mesh prefix (web.<public_tld> stays public)
 *
 * Expected concrete hostnames are derived DYNAMICALLY from the reference
 * TLDs in config/profiles/cloud-multi.json.example (the resolver's no-env
 * fallback source) — the gate never hardcodes deployment domains.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SERVICES_JSON = join(ROOT, "config/services.json");
const DERIVE_SCRIPT = join(ROOT, "scripts/lib/derive-domains.mjs");
const PROFILES_DIR = join(ROOT, "config/profiles");

const PROFILES = ["cloud-multi", "cloud-single", "local-dev"];

// Reference TLDs from the .example profile — the same source the resolver
// falls back to when the operator supplies no TLD env. Keeps this gate in
// lock-step with the .example contents instead of hardcoding domains.
const EXAMPLE_PROFILE = JSON.parse(
  readFileSync(join(PROFILES_DIR, "cloud-multi.json.example"), "utf-8"),
) as { domain: { public_tld: string; internal_tld: string; mesh_tld: string } };
const REF_PUBLIC_TLD = EXAMPLE_PROFILE.domain.public_tld;
const REF_INTERNAL_TLD = EXAMPLE_PROFILE.domain.internal_tld;
const REF_MESH_TLD = EXAMPLE_PROFILE.domain.mesh_tld;

function deriveJSON(profileId: string, meshOn = false): {
  profile: string;
  mesh_enabled: boolean;
  services: Record<string, {
    role: string;
    tier: string;
    placement: string;
    urls: { internal?: Array<{ subdomain: string; url: string }>; public?: Array<{ subdomain: string; url: string }> };
  }>;
} {
  const out = execFileSync(
    "node",
    [DERIVE_SCRIPT, `--profile=${profileId}`, `--mesh=${meshOn ? "on" : "off"}`],
    { cwd: ROOT, encoding: "utf-8" },
  );
  return JSON.parse(out);
}

describe("Topology Derivation — config/services.json + profiles", () => {
  test("source files exist", () => {
    expect(existsSync(SERVICES_JSON), "config/services.json missing").toBe(true);
    expect(existsSync(DERIVE_SCRIPT), "scripts/lib/derive-domains.mjs missing").toBe(true);
    for (const p of PROFILES) {
      expect(existsSync(join(PROFILES_DIR, `${p}.json`)), `profile '${p}' missing`).toBe(true);
    }
  });

  test("services.json catalog has required services + role tagging", () => {
    const cat = JSON.parse(readFileSync(SERVICES_JSON, "utf-8"));
    const services = cat.services;

    // Auth + data are non-negotiable
    expect(services.keycloak, "catalog must define keycloak").toBeDefined();
    expect(services.keycloak.tier, "keycloak MUST be tier=required").toBe("required");
    expect(services.keycloak.role).toBe("auth");

    expect(services.core, "catalog must define core (data plane)").toBeDefined();
    expect(services.core.tier, "core MUST be tier=required").toBe("required");

    // Important services (per user's design intent)
    expect(services.pki, "catalog must define pki").toBeDefined();
    expect(["required", "important"]).toContain(services.pki.tier);

    expect(services.integration, "catalog must define integration (Ragnarok)").toBeDefined();
    expect(["required", "important"]).toContain(services.integration.tier);
  });

  // service_overrides.<id>.external_domain — a service deployed OFF this instance
  // (e.g. a shared central Keycloak that serves the whole fleet, on a different
  // TLD) must resolve to that fixed FQDN for every scope, NEVER a host derived
  // under the instance's own PUBLIC_TLD, while still participating in the
  // dependency graph.
  //
  // The fixture is SYNTHESISED into a throwaway instance overlay
  // (AISHA_INSTANCE_CONFIG_DIR/profiles/<id>.json — the channel the resolver
  // already prefers, derive-domains.mjs profileCandidates). Earlier this test
  // read a fork-shipped profile and `return`ed when absent, so upstream — the
  // template every instance is cut from — never exercised the mechanism at all
  // while still reporting green.
  test("external_domain override resolves verbatim (shared off-instance service)", () => {
    const EXTERNAL_FQDN = "auth.shared-fleet.example";
    const TLD = "example.test";
    const overlay = join(tmpdir(), `aisha-topo-overlay-${process.pid}`);
    const base = JSON.parse(readFileSync(join(PROFILES_DIR, "cloud-multi.json"), "utf-8"));
    base.service_overrides = {
      ...(base.service_overrides ?? {}),
      keycloak: { ...(base.service_overrides?.keycloak ?? {}), external_domain: EXTERNAL_FQDN },
    };
    mkdirSync(join(overlay, "profiles"), { recursive: true });
    writeFileSync(join(overlay, "profiles", "ext-domain-fixture.json"), JSON.stringify(base));
    try {
      // The overlay profile ships null TLDs (the operator supplies them via env);
      // provide them explicitly so the resolver can run. external_domain is
      // TLD-independent — that is precisely what this test pins.
      const out = execFileSync(
        "node",
        [DERIVE_SCRIPT, "--profile=ext-domain-fixture", "--mesh=off"],
        {
          cwd: ROOT,
          encoding: "utf-8",
          env: {
            ...process.env,
            AISHA_INSTANCE_CONFIG_DIR: overlay,
            PUBLIC_TLD: TLD,
            INTERNAL_TLD: TLD,
            MESH_TLD: `mesh.${TLD}`,
            OAUTH2_COOKIE_DOMAINS: `.${TLD}`,
            OAUTH2_WHITELIST_DOMAINS: `.${TLD}`,
          },
        },
      );
      const t = JSON.parse(out) as ReturnType<typeof deriveJSON>;
      const kc = t.services.keycloak;
      expect(kc, "keycloak must stay in the topology (dependency), even when external").toBeDefined();
      expect(kc.urls.public?.[0]?.url, "public scope must be the external FQDN").toBe(EXTERNAL_FQDN);
      expect(kc.urls.internal?.[0]?.url, "internal scope must be the external FQDN too").toBe(
        EXTERNAL_FQDN,
      );
      // A normal service still derives under the instance zone — the override is scoped.
      const other = t.services.orchestration ?? t.services.core;
      expect(other, "a non-overridden service must still be in the topology").toBeDefined();
      expect(other.urls.internal?.[0]?.url).not.toBe(EXTERNAL_FQDN);
      expect(
        other.urls.internal?.[0]?.url,
        "a non-overridden service derives under the instance's own zone",
      ).toContain(TLD);
    } finally {
      rmSync(overlay, { recursive: true, force: true });
    }
  });

  for (const profileId of PROFILES) {
    test(`profile '${profileId}' passes derive-domains --check`, () => {
      try {
        execFileSync("node", [DERIVE_SCRIPT, `--profile=${profileId}`, "--check"], {
          cwd: ROOT,
          stdio: "pipe",
        });
      } catch (e) {
        const errOutput = e instanceof Error ? e.message : String(e);
        throw new Error(`profile '${profileId}' check failed: ${errOutput}`);
      }
    });

    test(`profile '${profileId}' includes required services (keycloak + core)`, () => {
      const topo = deriveJSON(profileId, false);
      expect(topo.services.keycloak, `profile '${profileId}' must include keycloak`).toBeDefined();
      expect(topo.services.core, `profile '${profileId}' must include core`).toBeDefined();
    });
  }

  test("cloud-multi resolves keycloak to auth.backend.<internal_tld> (reference topology)", () => {
    const topo = deriveJSON("cloud-multi", false);
    const kc = topo.services.keycloak;
    expect(kc.placement, "keycloak placement is backend on cloud-multi").toBe("backend");
    const authEntry = (kc.urls.internal ?? []).find((e) => e.subdomain === "auth");
    expect(authEntry?.url).toBe(`auth.backend.${REF_INTERNAL_TLD}`);
  });

  test("local-dev resolves keycloak to auth.local", () => {
    const topo = deriveJSON("local-dev", false);
    const authEntry = (topo.services.keycloak.urls.internal ?? []).find((e) => e.subdomain === "auth");
    expect(authEntry?.url).toBe("auth.local");
  });

  test("local-dev + mesh ON follows the SAME suffix rule as cloud-multi (žádná druhá varianta)", () => {
    // ⛔ 2026-08-25: do dneška tu byly DVA tvary meshe — cloud-multi příponu
    // `auth.<mesh_tld>`, local-dev předponu `mesh.auth.local`. Lokální mesh je
    // podmínkou provozu AISHA stacků, takže se řídí týmž pravidlem jako cloud;
    // druhá varianta je rozdvojení, ne vlastnost. Test proto netvrdí literál,
    // ale SHODU pravidla — vrátí-li někdo předponu, spadne to tady.
    const topo = deriveJSON("local-dev", true);
    // mesh_tld se čte z PROFILU (SoT), ne z odvozeného výstupu — test tím
    // porovnává odvození proti zdroji, ne proti sobě samému.
    const localProfile = JSON.parse(
      readFileSync(join(PROFILES_DIR, "local-dev.json"), "utf-8"),
    ) as { domain: { mesh_tld: string } };
    const meshTld = localProfile.domain.mesh_tld;
    expect(meshTld, "local-dev musí mít vlastní mesh_tld").toBeTruthy();

    for (const [svc, sub] of [["keycloak", "auth"], ["orchestration", "n8n"]] as const) {
      const entry = (topo.services[svc]?.urls?.internal ?? []).find((e) => e.subdomain === sub);
      expect(entry?.url, `${sub} musí být '${sub}.${meshTld}' (přípona, ne předpona)`).toBe(
        `${sub}.${meshTld}`,
      );
      expect(entry?.url?.startsWith("mesh."), "předponový tvar 'mesh.<sub>' je zrušen").toBe(false);
    }
  });

  test("cloud-multi + mesh ON rewrites internal URLs to *.<mesh_tld>", () => {
    const topo = deriveJSON("cloud-multi", true);
    const authEntry = (topo.services.keycloak.urls.internal ?? []).find((e) => e.subdomain === "auth");
    expect(authEntry?.url).toBe(`auth.${REF_MESH_TLD}`);
  });

  test("public URLs never get mesh prefix even when MESH_ENABLED=true", () => {
    const topo = deriveJSON("cloud-multi", true);
    // edge.public should have web.<public_tld>, NOT mesh.web.<public_tld>
    const webPublic = (topo.services.edge?.urls?.public ?? []).find((e) => e.subdomain === "web");
    expect(webPublic?.url, "public URLs are mesh-agnostic — they always go via the public TLD").toBe(
      `web.${REF_PUBLIC_TLD}`,
    );
  });

  test("cloud-single excludes mesh + Experimental-specific services (netbird, ledger, exec)", () => {
    const topo = deriveJSON("cloud-single", false);
    expect(topo.services.netbird, "cloud-single MUST exclude netbird (no mesh need)").toBeUndefined();
    expect(topo.services.ledger, "cloud-single MUST exclude ledger (Experimental-only)").toBeUndefined();
    expect(topo.services.exec, "cloud-single MUST exclude exec (Experimental+Kata required)").toBeUndefined();
  });

  test("ledger (cosmos) is internal-only — never derives a public *.<public_tld> host", () => {
    // docker-compose.coolify-cosmos.yml declares the chain "NOT a public chain
    // — not exposed to internet", "Domain: None (internal-only, no Traefik)",
    // "No docker_compose_domains". The service catalog MUST agree: ledger is
    // public:false with no subdomain, so on cloud-multi (where it IS placed on
    // Experimental) it derives zero URLs — edge functions reach it via the
    // aisha-network Docker network / ledger.${MESH_TLD} mesh DNS, not a public
    // hostname. Regression guard for the prior cosmos.aisha.guru leak where
    // services.json said public:true.
    const cat = JSON.parse(readFileSync(SERVICES_JSON, "utf-8"));
    expect(cat.services.ledger.public, "ledger MUST be public:false (internal-only chain)").toBe(false);
    // Dřív se připínalo `subdomain === null`. Jenže komentář výš sám říká, že
    // ledger se dosahuje přes `ledger.${MESH_TLD}` mesh DNS — tedy přes jméno,
    // které bez subdomény vzniknout nemůže. Test tedy zakazoval to, co dokumentace
    // téhož testu předepisuje. Hlídá se proto VLASTNOST: nula veřejných URL.

    const topo = deriveJSON("cloud-multi", false);
    const ledger = topo.services.ledger;
    expect(ledger, "cloud-multi places ledger on Experimental").toBeDefined();
    expect(
      ledger.urls.public ?? [],
      "ledger must derive NO public host — it is not exposed to the internet",
    ).toHaveLength(0);
  });

  test("domain-doctor ⇄ services.json symmetry: public openclaw registered, internal ledger NOT", () => {
    // The Coolify domain registry (coolify-domain-doctor.mjs) must be symmetric
    // with services.json public flags: every public service with a real HTTP
    // listener has a docker_compose_domains entry; internal-only services do
    // NOT. openclaw (public:true, companion.${PUBLIC_TLD}) and ledger
    // (public:false, internal-only cosmos) are the two that exposed the gap.
    // openclaw's public face is fronted by the openclaw-auth OAuth2 proxy, so the
    // companion route is registered against aisha-openclaw-auth at the proxy port
    // 4180 (like n8n → n8n-auth), not the daemon's 5210 — the daemon carries no
    // public router, so nothing reaches it bypassing the OAuth gate.
    const doctor = readFileSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"), "utf-8");
    const cat = JSON.parse(readFileSync(SERVICES_JSON, "utf-8"));

    // openclaw is public → MUST be registered (env-guarded on COMPANION_DOMAIN),
    // now at the OAuth2-proxy port 4180 (openclaw-auth fronts the daemon).
    expect(cat.services.openclaw.public, "openclaw must stay public:true").toBe(true);
    expect(
      doctor,
      "coolify-domain-doctor.mjs must register aisha-openclaw on the OAuth2-proxy port (4180)",
    ).toMatch(/app:\s*["']aisha-openclaw["'][\s\S]*?COMPANION_DOMAIN[\s\S]*?:4180/);

    // ledger is internal-only → MUST NOT be registered as a public Coolify route.
    expect(cat.services.ledger.public, "ledger must stay public:false (internal-only)").toBe(false);
    expect(
      doctor,
      "coolify-domain-doctor.mjs must NOT register aisha-ledger (cosmos is internal-only)",
    ).not.toMatch(/app:\s*["']aisha-ledger["']/);
  });

  test("local-only services (vLLM) excluded from cloud profiles", () => {
    for (const p of ["cloud-multi", "cloud-single"]) {
      const topo = deriveJSON(p, false);
      expect(topo.services.vllm, `${p} must NOT include local-only vllm`).toBeUndefined();
    }
  });

  test("each profile declares OAuth2 cookie/whitelist domains (via live JSON or .example fallback)", () => {
    // OAuth2 Proxy needs comma-separated cookie/whitelist domains that scope
    // correctly to the profile's TLDs. Without this, post-login redirects
    // arrive at a domain the cookie doesn't cover → infinite re-auth loop.
    //
    // Iter 15: cloud-* profiles ship cookie_domains/whitelist_domains = null
    // (template-only SoT). The matching `.json.example` carries the reference
    // values for the AISHA deploy; resolver auto-falls-back when env is empty.
    // Gate accepts either source so operators can keep the cleaner null-SoT
    // shape AND we still verify the reference contract holds.
    for (const profileId of PROFILES) {
      const profilePath = join(PROFILES_DIR, `${profileId}.json`);
      const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
      const examplePath = join(PROFILES_DIR, `${profileId}.json.example`);
      const example = existsSync(examplePath) ? JSON.parse(readFileSync(examplePath, "utf-8")) : null;
      const cookieDomains   = profile.oauth2?.cookie_domains    ?? example?.oauth2?.cookie_domains;
      const whitelist       = profile.oauth2?.whitelist_domains ?? example?.oauth2?.whitelist_domains;
      expect(
        cookieDomains,
        `profile '${profileId}' must declare oauth2.cookie_domains (in JSON or .example)`,
      ).toBeTruthy();
      expect(
        whitelist,
        `profile '${profileId}' must declare oauth2.whitelist_domains (in JSON or .example)`,
      ).toBeTruthy();
    }
  });

  test("resolver emits OAUTH2_COOKIE_DOMAINS + OAUTH2_WHITELIST_DOMAINS", () => {
    const out = execFileSync(
      "node",
      [DERIVE_SCRIPT, "--profile=cloud-multi", "--shell"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    expect(out, "OAUTH2_COOKIE_DOMAINS must be emitted").toMatch(
      /^OAUTH2_COOKIE_DOMAINS=.+$/m,
    );
    expect(out, "OAUTH2_WHITELIST_DOMAINS must be emitted").toMatch(
      /^OAUTH2_WHITELIST_DOMAINS=.+$/m,
    );
  });

  test("výstup --shell JDE sourcovat (tři skripty ho `.`-sourcují)", () => {
    // Hlavička slibuje „bash-sourceable export lines" a aisha-cold-start.sh,
    // coolify-deploy-init.sh i lib/resolve-domains-env.sh se na to spoléhají.
    // Slib se rozbil, jakmile přibyly strukturované hodnoty
    // (`<ID>_MESH_INGRESS_ROUTES=port|host|kontejner:port;…`): shell přečetl
    // `|` jako rouru a pod `set -e` skript zemřel. Měřeno 2026-07-29 —
    // deploy-init --stack web spadl na „…mesh.riq.internal: command not found",
    // takže po nasazení nešlo synchronizovat env ani udělat cold start.
    //
    // Netestuje se PRAVOPIS (že jsou tam uvozovky), ale VLASTNOST: strom
    // hodnot přežije průchod skutečným shellem a dorazí nedotčený.
    const out = execFileSync(
      "node",
      [DERIVE_SCRIPT, "--profile=cloud-multi", "--shell"],
      { cwd: ROOT, encoding: "utf-8", env: { ...process.env, MESH_ENABLED: "true" } },
    );
    const routeKey = out.split("\n").find((l) => /^[A-Z_]+_MESH_INGRESS_ROUTES=/.test(l));
    expect(routeKey, "žádná strukturovaná hodnota — sonda přestala měřit tu rizikovou třídu")
      .toBeTruthy();
    const key = (routeKey as string).split("=")[0];

    const tmp = join(tmpdir(), `aisha-topo-gate-${process.pid}.env`);
    try {
      writeFileSync(tmp, out);
      // `set -e` + `set -a` = přesně režim, ve kterém to volají ostré skripty.
      const echoed = execFileSync(
        "bash",
        ["-c", `set -e; set -a; . "${tmp}"; set +a; printf '%s' "\${${key}}"`],
        { encoding: "utf-8" },
      );
      expect(echoed, `${key} se sourcováním poškodil nebo skript spadl`).toContain("|");
      expect(echoed.length, "hodnota po sourcování zmizela").toBeGreaterThan(10);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});

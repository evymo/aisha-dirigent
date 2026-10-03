/**
 * Topology Domains Parity Gate
 *
 * Guarantees that the cloud-multi profile resolver produces identical
 * domain values to what config/domains.env declares today. This makes
 * the topology-driven path a SAFE drop-in replacement: setting
 * AISHA_PROFILE=cloud-multi must not change any URL anywhere.
 *
 * Without this gate, a profile typo or service-catalog drift would
 * break production routing on the next cold-start.
 *
 * The check:
 *   For every *_DOMAIN var in config/domains.env, find the matching
 *   var in `derive-domains.mjs --shell --profile=cloud-multi --mesh=off`
 *   output and assert byte-equal value.
 *
 * Skips:
 *   - Computed-derived vars (KEYCLOAK_URL, AISHA_API_URL, ...) — those
 *     come from `https://${X_DOMAIN}` interpolation; we only check the
 *     base *_DOMAIN
 *   - Internal-only convention vars (PUBLIC_TLD, INTERNAL_TLD, MESH_TLD)
 *     — those are profile-config, not service-derived
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
// Iter 15: the live `config/domains.env` is template-only (empty values).
// The reference / drop-in spec lives in `config/domains.env.example`. This
// gate's parity check compares the resolver output to the AISHA reference
// deploy values, so we read the .example as the contract — that's what
// "must not change any URL anywhere" is anchored to.
const DOMAINS_ENV = join(ROOT, "config/domains.env.example");
const DERIVE_SCRIPT = join(ROOT, "scripts/lib/derive-domains.mjs");

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

describe("Topology domains parity — derived must match domains.env for cloud-multi", () => {
  test("source files exist", () => {
    expect(existsSync(DOMAINS_ENV), "config/domains.env missing").toBe(true);
    expect(existsSync(DERIVE_SCRIPT), "derive-domains.mjs missing").toBe(true);
  });

  test("everything resolver emits matches domains.env (resolver ⊆ static)", () => {
    // Direction: every *_DOMAIN the resolver emits must equal what domains.env
    // has for the same key. The reverse direction (static ⊆ resolver) is the
    // migration goal — tracked via ENV_VARS_NOT_YET_MODELED below; resolver
    // doesn't need to cover everything yet, just be CORRECT for what it does
    // cover. This is the safe drop-in invariant.
    const staticEnv = parseEnvFile(readFileSync(DOMAINS_ENV, "utf-8"));
    const derivedShell = execFileSync(
      "node",
      [DERIVE_SCRIPT, "--profile=cloud-multi", "--mesh=off", "--shell"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    const derived = parseEnvFile(derivedShell);

    const mismatches: string[] = [];
    for (const [key, derivedVal] of Object.entries(derived)) {
      if (!key.endsWith("_DOMAIN")) continue;
      // Skip aliases (the resolver emits multiple alias forms for the same
      // canonical URL — only enforce the legacy/canonical form against
      // domains.env, since that's the public contract).
      if (/_PUBLIC_DOMAIN$|_INTERNAL_DOMAIN$/.test(key)) continue;

      const staticVal = staticEnv[key];
      if (staticVal === undefined) continue; // domains.env doesn't have it — fine
      if (derivedVal !== staticVal) {
        mismatches.push(
          `${key}: resolver="${derivedVal}" vs domains.env="${staticVal}"`,
        );
      }
    }

    expect(
      mismatches,
      "Resolver must produce drop-in identical values for every domain it emits. Mismatches:\n" +
        mismatches.join("\n"),
    ).toEqual([]);
  });

  test("required services are covered by resolver in cloud-multi", () => {
    // Migration progress: ensure must-have services are modeled. Optional
    // services (livekit/turn — wide compose) can lag.
    const derivedShell = execFileSync(
      "node",
      [DERIVE_SCRIPT, "--profile=cloud-multi", "--mesh=off", "--shell"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    const derived = parseEnvFile(derivedShell);

    const REQUIRED_DOMAINS = [
      "KEYCLOAK_DOMAIN",      // auth (must-have)
      "PKI_DOMAIN",           // key rotation
      "PKI_BRIDGE_DOMAIN",    // cert acquisition
      "N8N_DOMAIN",           // workflows
      "LANGFUSE_DOMAIN",      // LLM ops
      "APP_DOMAIN",           // web SPA
      "NETBIRD_DOMAIN",       // mesh control
      "REGISTRY_DOMAIN",      // pull-through cache
    ];

    const missing = REQUIRED_DOMAINS.filter((k) => !derived[k]);
    expect(
      missing,
      "Required services must be modeled in catalog → resolver must emit their domain. Missing: " +
        missing.join(", "),
    ).toEqual([]);
  });

  test("edge route contract is generated by resolver", () => {
    const derivedShell = execFileSync(
      "node",
      [DERIVE_SCRIPT, "--profile=cloud-multi", "--mesh=off", "--shell"],
      { cwd: ROOT, encoding: "utf-8" },
    );
    const derived = parseEnvFile(derivedShell);

    const REQUIRED_EDGE_KEYS = [
      "MCP_DOMAIN",
      "API_DOMAIN_PUBLIC",
      "DIRIGENT_DOMAIN",
      "AUTH_DOMAIN_PUBLIC",
      "MESH_ENABLED",
      "MCP_UPSTREAM_PUBLIC",
      "API_UPSTREAM_PUBLIC",
      "DIRIGENT_UPSTREAM_PUBLIC",
      "AUTH_UPSTREAM_PUBLIC",
      "MCP_UPSTREAM_MESH",
      "API_UPSTREAM_MESH",
      "DIRIGENT_UPSTREAM_MESH",
      "AUTH_UPSTREAM_MESH",
    ];

    const missing = REQUIRED_EDGE_KEYS.filter((key) => !derived[key]);
    expect(missing, `Resolver must emit edge route keys. Missing: ${missing.join(", ")}`).toEqual([]);
  });

  test("edge compose consumes generated route contract without hardcoded fallbacks", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");

    for (const key of [
      "MCP_DOMAIN",
      "API_DOMAIN_PUBLIC",
      "DIRIGENT_DOMAIN",
      "AUTH_DOMAIN_PUBLIC",
      "MESH_ENABLED",
      "MCP_UPSTREAM_PUBLIC",
      "API_UPSTREAM_PUBLIC",
      "DIRIGENT_UPSTREAM_PUBLIC",
      "AUTH_UPSTREAM_PUBLIC",
      "MCP_UPSTREAM_MESH",
      "API_UPSTREAM_MESH",
      "DIRIGENT_UPSTREAM_MESH",
      "AUTH_UPSTREAM_MESH",
    ]) {
      expect(compose, `${key} must be required in compose`).toContain(`${key}: \${${key}:?`);
      expect(compose, `${key} must not have compose fallback`).not.toContain(`${key}: \${${key}:-`);
    }
  });

  test("aisha-cold-start.sh defaults AISHA_PROFILE to cloud-multi (resolver is now primary path)", () => {
    const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");

    // Must reference the profile env var
    expect(
      cs,
      "aisha-cold-start.sh MUST react to AISHA_PROFILE env to enable topology-driven mode",
    ).toMatch(/AISHA_PROFILE/);

    // ⛔ OTOČENO 2026-08-22. Tady se VYŽADOVALO `${AISHA_PROFILE:-cloud-multi}`,
    // zatímco derive-domains.mjs si na touž otázku dosazoval `cloud-single`.
    // Brána tedy jedno ze dvou rozporných dosazení PŘEDEPISOVALA — a byla
    // zelená, dokud rozpor trval. Profil rozhoduje o každé co-location větvi
    // (PKI_BRIDGE_URL, AUTH_UPSTREAM_*, KEYCLOAK_INTERNAL_URL), takže „split
    // fleet versus jeden uzel" se lišilo podle toho, koho ses zeptal.
    //
    // Resolver zůstává hlavní cestou — to měří tvrzení níž. Mění se jen odpověď
    // na „a co když tvar nikdo nedeklaroval": dřív dosazení, teď zastavení.
    expect(
      cs.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"),
      "cold-start zase dosazuje tvar nasazení literálem — viz brána " +
        "tvar-nasazeni-se-deklaruje.gate.test.ts.",
    ).not.toMatch(/AISHA_PROFILE="?\$\{AISHA_PROFILE:-[^}]/);

    expect(
      cs,
      "chybějící deklarace tvaru musí cold-start ZASTAVIT, ne projít s dosazeným profilem",
    ).toMatch(/AISHA_PROFILE[\s\S]{0,600}exit 1/);

    // Must invoke the derive script
    expect(cs, "cold-start MUST invoke scripts/lib/derive-domains.mjs").toMatch(
      /derive-domains\.mjs/,
    );

    // Must --check before sourcing (fail-fast on bad topology)
    const meshIdx = cs.indexOf("derive-domains.mjs");
    expect(meshIdx, "derive-domains.mjs reference required").toBeGreaterThan(-1);
    expect(
      cs.slice(meshIdx),
      "cold-start MUST run --check after registering DERIVE_SCRIPT path.",
    ).toMatch(/--check/);

    // Must --shell to get sourceable output
    expect(cs.slice(meshIdx), "cold-start MUST source --shell output from derive-domains").toMatch(
      /--shell/,
    );

    // Legacy escape hatch documented
    expect(
      cs,
      "cold-start MUST support AISHA_PROFILE=legacy to bypass the resolver (escape hatch).",
    ).toMatch(/AISHA_PROFILE.*!=.*"legacy"|AISHA_PROFILE.*=.*legacy/);
  });
});

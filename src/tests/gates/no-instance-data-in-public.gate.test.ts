/**
 * No private implementation / tenant data in public artifacts
 *
 * The public repo is fork-safe: shipped seed/config/deploy artifacts must not
 * carry instance-specific data or name a real tenant. Instance identity lives
 * ONLY in the private overlay repo (docs/onboarding/instance-data-template
 * documents its shape).
 *
 * Detection is STRUCTURAL — by shape, never by a committed list of real tenant
 * names. (A denylist of real customers in a PUBLIC repo would itself disclose
 * exactly who the tenants are — the leak this gate exists to prevent.) It flags:
 *   • Keycloak clients in the shipped realm outside the platform client set;
 *   • email / URL domains outside a safe allowlist (placeholders, platform,
 *     canonical infra) in curated config + deploy artifacts;
 *   • seed artifacts NOT compiled from a public-safe profile;
 *   • the externalized single-file instance seed reappearing;
 *   • tenant-named files in the migration / manifest scopes.
 *
 * Operators / CI hosts that hold the real roster may add an EXACT-name layer via
 * the gitignored config/tenant.json (or AISHA_TENANT_SENTINELS) — see
 * config/tenant.json.example + src/tests/gates/lib/tenant-leak-detect.ts. It is
 * absent in the public repo and in forks, where structure alone applies.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { execFileSync } from "node:child_process";
import { join } from "path";
import {
  findLeakedIdentities,
  loadTenantSentinels,
  nonPlatformKcClients,
  privateSentinelHits,
  seedProfile,
  PUBLIC_SAFE_SEED_PROFILES,
  PLATFORM_KC_CLIENTS,
} from "./lib/tenant-leak-detect";

const ROOT = process.cwd();

/** Optional operator-supplied exact tenant names (empty in the public repo). */
const SENTINELS = loadTenantSentinels();

/**
 * The tree's OWN implementation, if it has one.
 *
 * ODVOZENO z `instances/`, nevypsáno — týž vzor, jaký používá
 * `scripts/split-rule-gate.mjs` ("the identifiers come from the directories
 * under instances/"). Ve forku je tam jeho vlastní adresář, v upstreamu jen
 * `_default` ⇒ prázdný seznam ⇒ tahle vrstva je vypnutá. To je SPRÁVNÝ stav:
 * generická šablona žádného vlastního nájemníka nemá, a vypsat sem jméno
 * jednoho forku by z upstreamu udělalo jeho stopu.
 *
 * Vypnutí téhle vrstvy nic neschovává: strukturální vrstvy (seed profil,
 * ne-platformní KC klienti, únik e-mailů) i operátorské SENTINELS běží
 * NEZÁVISLE a bezpodmínečně — viz test „sonda má co měřit" níž.
 *
 * Vrstva se týká jen PUBLIC-SAFE artefaktů (ty, co tečou do zrcadel a PR),
 * doslovným podřetězcem — přísněji než URL/e-mail vrstva, protože ve vlastním
 * forku to jméno není tajemství —, a nikdy ne rozšířeného skenu dokumentace.
 */
const OWN_TENANT_SENTINELS: string[] = (() => {
  try {
    return readdirSync(join(ROOT, "instances"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name.toLowerCase());
  } catch {
    return [];
  }
})();

function ownTenantHits(content: string, sentinels: string[] = OWN_TENANT_SENTINELS): string[] {
  const lower = content.toLowerCase();
  return sentinels.filter((s) => lower.includes(s)).map((s) => `own-tenant:${s}`);
}

/** Seed artifacts — compiled from a public-safe (`platform`/`demo`) profile. */
const PUBLIC_SEED_ARTIFACTS = ["aisha/db/seed.compiled.sql", "aisha/db/seed.sql"];

/** The shipped Keycloak realm — its clients must all be platform clients. */
const REALM_ARTIFACT = "keycloak/aisha-realm.json";

/** Curated config / data artifacts that must carry no non-safe identity. */
const PUBLIC_CONFIG_ARTIFACTS = [
  REALM_ARTIFACT,
  "aisha/db/migrations/00000000000000_baseline.sql",
  "config/domains.env",
  "docker-compose.coolify-admin.yml",
  "docker-compose.coolify-cosmos.yml",
];

/**
 * Non-seed scopes where tenant artifacts have leaked before. Scanned over
 * GIT-TRACKED files only, so a local-only untracked artifact is ignored.
 */
const EXTENDED_TRACKED_GLOBS = [
  "coolify/manifests/*.manifest",
  "coolify/servers.json",
  "scripts/coolify-*.sh",
  "scripts/coolify-*.mjs",
  "docs/onboarding",
  "docs/deploy",
];

/**
 * Tracked-path scopes whose FILENAMES must not embed a tenant name. Migrations
 * are baseline-only; a new migration filename can land only in
 * `aisha/db/migrations` or a manifest.
 */
const FILENAME_SCOPES = ["aisha/db/migrations", "coolify/manifests"];

function read(rel: string): string {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

function trackedFiles(globs: string[]): string[] {
  try {
    return execFileSync("git", ["ls-files", "--", ...globs], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Structural (non-safe email) + optional-private (exact tenant) leaks. */
function leaksIn(rel: string, includeOwnTenant = false): string[] {
  const content = read(rel);
  if (!content) return [];
  const structural = findLeakedIdentities(content).map((h) => `identity:${h}`);
  const exact = privateSentinelHits(content, SENTINELS).map((s) => `tenant:${s}`);
  const own = includeOwnTenant ? ownTenantHits(content) : [];
  return [...structural, ...exact, ...own];
}

describe("No private implementation data in public seed artifacts", () => {
  for (const rel of PUBLIC_SEED_ARTIFACTS) {
    test(`${rel} is compiled from a public-safe profile and names no tenant`, () => {
      const content = read(rel);
      if (!content) return; // artifact absent (e.g. not yet compiled) — nothing to check
      // Structural: the compile-profile header must be public-safe. A seed built
      // from `instance` (or any private profile) cannot ship here by construction.
      const profile = seedProfile(content);
      expect(
        profile === null || PUBLIC_SAFE_SEED_PROFILES.includes(profile),
        `${rel} was compiled from a non-public profile "${profile}" — ` +
          "regenerate with `node scripts/db/compile-seed.mjs --profile=platform` (or =demo)",
      ).toBe(true);
      // Optional exact-name layer (operator hosts only) + this fork's own tenant.
      const exact = [...privateSentinelHits(content, SENTINELS), ...ownTenantHits(content)];
      expect(
        exact,
        `tenant reference(s) leaked into ${rel}: [${exact.join(", ")}] — ` +
          "regenerate the seed from a public-safe profile",
      ).toEqual([]);
    });
  }

  test("legacy single-file instance seed is externalized", () => {
    expect(existsSync(join(ROOT, "aisha/db/seed.instance.sql"))).toBe(false);
  });
});

describe("No private tenant data in public config artifacts", () => {
  test(`${REALM_ARTIFACT} ships only platform Keycloak clients (tenant clients belong in overlays)`, () => {
    const content = read(REALM_ARTIFACT);
    if (!content) return;
    const foreign = nonPlatformKcClients(content);
    expect(
      foreign,
      `non-platform Keycloak client(s) in ${REALM_ARTIFACT}: [${foreign.join(", ")}] — ` +
        "a tenant's OIDC clients belong in its private overlay (keycloak/*-client.json), " +
        "not the shipped platform realm. If this is a NEW platform client, add it to " +
        "PLATFORM_KC_CLIENTS in src/tests/gates/lib/tenant-leak-detect.ts.",
    ).toEqual([]);
  });

  for (const rel of PUBLIC_CONFIG_ARTIFACTS) {
    test(`${rel} carries no non-safe identity (instance clients/domains belong in overlays)`, () => {
      const leaked = leaksIn(rel, true);
      expect(
        leaked,
        `private-tenant reference leaked into ${rel}: [${leaked.join(", ")}] — ` +
          "remove the tenant client/domain (onboard it via an overlay), genericize the " +
          "comment, or regenerate the baseline from SoT (npm run db:init:generate). " +
          "A legitimate new platform domain goes in SAFE_DOMAINS " +
          "(src/tests/gates/lib/tenant-leak-detect.ts).",
      ).toEqual([]);
    });
  }
});

describe("No private tenant artifacts in non-seed public scopes", () => {
  test("tracked manifests / server catalog / coolify scripts / onboarding+deploy docs carry no non-safe identity", () => {
    const leaks: string[] = [];
    for (const rel of trackedFiles(EXTENDED_TRACKED_GLOBS)) {
      for (const hit of leaksIn(rel)) leaks.push(`${rel}:${hit}`);
    }
    expect(
      leaks,
      `private-tenant reference(s) leaked into a non-seed public scope:\n${leaks.join("\n")}\n` +
        "genericize the reference, or keep the per-tenant file local-only (git rm --cached + .gitignore).",
    ).toEqual([]);
  });

  test("no tracked file PATH under aisha/db/migrations or coolify/manifests embeds a tenant name", () => {
    const tracked = trackedFiles(FILENAME_SCOPES);
    // Structural: the migration scope is baseline-only — any extra migration file
    // is a candidate tenant/instance migration.
    const strayMigrations = tracked.filter(
      (p) => p.startsWith("aisha/db/migrations/") && !/\/0{14}_baseline\.sql$/.test(p),
    );
    // Optional exact-name layer over the tracked filenames + this fork's own tenant.
    const namedOffenders = tracked.filter(
      (p) =>
        (SENTINELS.length > 0 && privateSentinelHits(p, SENTINELS).length > 0) ||
        OWN_TENANT_SENTINELS.some((s) => p.toLowerCase().includes(s)),
    );
    const offenders = [...new Set([...strayMigrations, ...namedOffenders])];
    expect(
      offenders,
      `tenant/instance-named or non-baseline tracked file(s) — rename to a generic name, or untrack:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Detector self-tests — prove the structural + exact layers actually CATCH a
 * leak (so "no tenant names in the gate" did not become "no detection"). All
 * inputs here are synthetic; no real tenant name appears.
 */
describe("leak detectors catch synthetic leaks (coverage is not lost)", () => {
  test("findLeakedIdentities flags a non-safe email, passes safe ones", () => {
    expect(findLeakedIdentities("contact person@realcustomer.example-tenant.io here")).toEqual([
      "person@realcustomer.example-tenant.io",
    ]);
    expect(findLeakedIdentities("admin@example.com and support@platform.com and x@aisha.guru")).toEqual([]);
  });

  test("nonPlatformKcClients flags a foreign client, passes an all-platform realm", () => {
    const withForeign = JSON.stringify({
      clients: [{ clientId: "aisha-app" }, { clientId: "some-tenant-app" }],
    });
    expect(nonPlatformKcClients(withForeign)).toEqual(["some-tenant-app"]);
    const platformOnly = JSON.stringify({ clients: PLATFORM_KC_CLIENTS.map((clientId) => ({ clientId })) });
    expect(nonPlatformKcClients(platformOnly)).toEqual([]);
  });

  test("seedProfile parses the compile header; only public-safe profiles pass", () => {
    expect(seedProfile("-- Profile: demo\n-- ...")).toBe("demo");
    expect(PUBLIC_SAFE_SEED_PROFILES.includes(seedProfile("-- Profile: instance") ?? "")).toBe(false);
  });

  test("ownTenantHits flags an own tenant as a bare substring (not just URL/email)", () => {
    // Syntetické jméno, ne to skutečné: měří se MECHANISMUS, ne konkrétní
    // instance. Do 2026-08-11 tenhle test citoval reálného nájemníka, takže
    // (a) nesl jeho jméno v generickém stromu a (b) spadl v okamžiku, kdy se
    // seznam začal odvozovat z instances/ — trestal by tedy zobecnění.
    // Sesterská privateSentinelHits() to dělá takhle odjakživa.
    const own = ["acmefork"];
    expect(ownTenantHits("INSERT INTO expert_rules (slug) VALUES ('acmefork-decision-center')", own)).toEqual([
      "own-tenant:acmefork",
    ]);
    expect(ownTenantHits("nothing to see", own)).toEqual([]);
  });

  test("OWN_TENANT_SENTINELS se ODVOZUJE z instances/, nevypisuje", () => {
    // Sonda má co měřit: v upstreamu je pod instances/ jen `_default`, takže
    // prázdno je SPRÁVNÝ výsledek — generická šablona vlastního nájemníka nemá.
    // Ve forku tam jeho adresář je a vrstva se zapne sama. Kdyby se sem jméno
    // vrátilo natvrdo, tenhle test spadne.
    const jmenaVKodu = readFileSync(__filename ?? "", "utf8");
    expect(
      /const OWN_TENANT_SENTINELS[^=]*=\s*\[\s*"/.test(jmenaVKodu),
      "OWN_TENANT_SENTINELS je vypsaný literálem — má se odvozovat z instances/",
    ).toBe(false);
    for (const s of OWN_TENANT_SENTINELS) {
      expect(existsSync(join(ROOT, "instances", s)), `sentinel '${s}' nemá adresář v instances/`).toBe(true);
    }
  });

  test("privateSentinelHits substring-matches a name inside an email OR a URL", () => {
    const sentinels = ["acmetenant"];
    expect(privateSentinelHits("see https://acmetenant.com/app", sentinels)).toEqual(["acmetenant"]);
    expect(privateSentinelHits("mail ops@acmetenant.io now", sentinels)).toEqual(["acmetenant"]);
    expect(privateSentinelHits("nothing to see", sentinels)).toEqual([]);
  });
});

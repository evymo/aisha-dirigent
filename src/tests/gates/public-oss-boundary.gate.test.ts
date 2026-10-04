/**
 * Public OSS boundary gate
 *
 * The public main branch must not depend on private relative submodules or bake
 * private implementation data into committed seed artifacts.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadTenantSentinels,
  privateSentinelHits,
  seedProfile,
  PUBLIC_SAFE_SEED_PROFILES,
} from "./lib/tenant-leak-detect";

const ROOT = process.cwd();

function read(rel: string): string {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Relative submodule URLs are banned as a proxy for "private implementation
 * coupling" — EXCEPT for submodules explicitly on the OSS side of the boundary.
 * An OSS-side submodule (a public-intended fork living beside this repo, e.g.
 * packages/insight = MIT fork with the Czech-aware BM25) is deliberately
 * RELATIVE: git resolves it against the parent clone's remote INCLUDING
 * credentials, so Coolify's tokened clone / CI auth / local keychain inherit,
 * and a fork cloned from its own host gets ITS mirror. Incident 2026-07-04: an
 * absolute private URL broke every Coolify deploy at the anonymous submodule
 * clone, and org-level privacy hides even public repos — so absolute cannot
 * work pre-publication either. Instance/template relatives stay banned.
 */
const OSS_RELATIVE_SUBMODULES = [
  "../insight.git",
  // TENANT FORK GLUE (aisha/tenant-orchestrator only — never upstream): the private
  // implementation submodules are relative for the SAME reason as insight —
  // an absolute private URL makes Coolify's anonymous submodule clone fail
  // ("could not read Username"), while "../<repo>.git" resolves against the
  // fork's own tokened remote (repo.id3a.cz/aisha/*). These paths never exist
  // on upstream main, so on upstream this array is functionally just insight.
  // First-party APP submodules (2026-07-14): potok + local-ingest are our
  // own app repos vendored the insight way (relative → the fork's tokened remote;
  // private today, published like insight's mirror when they go public).
  "../potok.git",
  "../aisha-local-ingest.git",
  // Extranet SDK (2026-10-04): npm workspace ze zdroje místo balíku z privátního
  // zrcadla — build nesmí záviset na vlastním npm. Relativní ze stejného důvodu
  // jako insight (Coolify/CI dědí pověření rodičovského klonu).
  "../aisha-extranet-sdk.git",
];

/**
 * SATELITY FORKU — ODVOZENÉ, NE VYJMENOVANÉ.
 *
 * Fork veze vlastní privátní satelity (`../<fork>-implementation.git`,
 * `../<fork>-web.git`) ze stejného důvodu jako insight výše: relativní URL se
 * resolvuje proti tokenovanému remote forku, kdežto absolutní privátní rozbije
 * anonymní submodule clone v Coolify (incident 2026-07-04).
 *
 * ⛔ Vyjmenovat je natvrdo NELZE. Brána `stack-nesmi-znat-jmeno-instance`
 * (správně) zakazuje, aby kód stacku znal jméno konkrétní instance, a na
 * takovém seznamu zčervená — naměřeno 2026-09-01, když tu ta jména chvíli
 * stála. Identita forku se proto ODVODÍ z remote URL, TÝMŽ pravidlem jako
 * tam. Na upstreamu (žádný `<jméno>-orchestrator` remote kromě `evymo-ai`)
 * se neodvodí nic a allowlist zůstane tím, čím je dnes.
 */
function forkSatellitePrefixes(): string[] {
  let remotes: string[] = [];
  try {
    remotes = execFileSync("git", ["remote"], { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const r of remotes) {
    let url = "";
    try {
      url = execFileSync("git", ["remote", "get-url", r], { cwd: ROOT, encoding: "utf-8" });
    } catch {
      continue;
    }
    const m = url.match(/\/([a-z][a-z0-9-]*)-orchestrator(?:\.git)?\s*$/);
    if (m && m[1] !== "evymo-ai") names.add(m[1]);
  }
  return [...names];
}

function isForkSatellite(relativeUrl: string): boolean {
  const base = relativeUrl.replace(/^\.\.\//, "").replace(/\.git$/, "");
  return forkSatellitePrefixes().some((n) => base === n || base.startsWith(`${n}-`));
}

describe("public OSS boundary", () => {
  test(".gitmodules contains no private relative implementation/template submodules", () => {
    const gitmodules = read(".gitmodules");
    expect(gitmodules).toContain("packages/insight");
    expect(gitmodules).not.toMatch(/aisha\/db\/seed\/instance/);
    expect(gitmodules).not.toMatch(/domains\/templates\/aisha\.guru/);
    // Every RELATIVE url must be an allowlisted OSS-side submodule — anything
    // else is private-coupling smell (the original blanket ban, scoped to its
    // documented intent).
    const relativeUrls = [...gitmodules.matchAll(/url\s*=\s*(\.\.\/\S+)/g)].map((m) => m[1]);
    const offenders = relativeUrls.filter(
      (u) => !OSS_RELATIVE_SUBMODULES.includes(u) && !isForkSatellite(u),
    );
    expect(
      offenders,
      `relative submodule url(s) not on the OSS allowlist: ${offenders.join(", ")} — ` +
        "private implementation/template submodules must not be referenced relatively",
    ).toEqual([]);
  });

  test("private overlay/template paths are ordinary placeholder directories", () => {
    const instanceReadme = read("aisha/db/seed/instance/README.md");
    const templateReadme = read("domains/templates/aisha.guru/README.md");
    expect(instanceReadme).toMatch(/not included in the open-source distribution/i);
    expect(templateReadme).toMatch(/not included in the open-source distribution/i);
  });

  test("committed public seed artifacts are public-safe and name no tenant", () => {
    // Detection is by SHAPE (public-safe compile profile) + an OPTIONAL private
    // exact-name list (config/tenant.json / AISHA_TENANT_SENTINELS) — never a
    // committed denylist of real customers, which would itself disclose them.
    // See src/tests/gates/lib/tenant-leak-detect.ts.
    // Plus THIS fork's OWN tenant (deliberate deviation, WP-09): the instance
    // overlay is committed in-tree, but must never reach the compiled public
    // artifacts — own-tenant names are bare-substring-checked (stricter than
    // the URL/email-scoped private layer; the name is no secret in its own fork).
    const sentinels = loadTenantSentinels();
    // Odvozeno z instances/, nevypsáno — v upstreamu je tam jen `_default`, takže
    // prázdno; ve forku jeho vlastní adresář. Vypsat sem jméno jednoho forku by
    // z generické šablony udělalo jeho stopu.
    const ownTenant = (() => {
      try {
        return readdirSync(join(ROOT, "instances"), { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
          .map((e) => e.name.toLowerCase());
      } catch {
        return [] as string[];
      }
    })();
    const artifacts = ["aisha/db/seed.compiled.sql", "aisha/db/seed.sql"];
    const leaks: string[] = [];

    for (const rel of artifacts) {
      if (!existsSync(join(ROOT, rel))) continue;
      const content = read(rel);
      const profile = seedProfile(content);
      if (profile !== null && !PUBLIC_SAFE_SEED_PROFILES.includes(profile)) {
        leaks.push(`${rel}:non-public-profile(${profile})`);
      }
      for (const s of privateSentinelHits(content, sentinels)) leaks.push(`${rel}:${s}`);
      const lower = content.toLowerCase();
      for (const s of ownTenant.filter((name) => lower.includes(name))) leaks.push(`${rel}:own-tenant:${s}`);
    }

    expect(
      leaks,
      `public seed artifact is not public-safe: ${leaks.join(", ")} — ` +
        "recompile from a public-safe profile (npm run db:seed:compile)",
    ).toEqual([]);
  });

  test("config/profiles ships tenant-free TEMPLATES only", () => {
    // A profile describes the SHAPE of a deployment. The moment it names a real
    // one — its domains, the machines it runs on, the organization behind it —
    // it stops being a template and becomes instance data, which does not belong
    // in a public repository. Such a profile is loaded from the private overlay
    // instead (AISHA_INSTANCE_CONFIG_DIR, see config/profiles/README.md).
    //
    // Detected by SHAPE plus the same optional private sentinel list the seed
    // check uses — deliberately NOT a committed list of instance names, which
    // would disclose exactly what the boundary exists to keep out.
    const sentinels = loadTenantSentinels();
    const dir = join(ROOT, "config", "profiles");
    const leaks: string[] = [];

    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      if (!file.endsWith(".json")) continue; // .json.example are reference values
      const rel = `config/profiles/${file}`;
      const raw = read(rel);

      // `server_bindings` maps a role to a NAMED machine in someone's Coolify.
      // A template cannot know that name, so its presence is instance data by
      // construction — no list of names required to tell.
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        leaks.push(`${rel}:unparsable`);
        continue;
      }
      if (parsed.server_bindings && Object.keys(parsed.server_bindings).length > 0) {
        leaks.push(`${rel}:server_bindings names real machines`);
      }
      for (const s of privateSentinelHits(raw, sentinels)) leaks.push(`${rel}:${s}`);
    }

    expect(
      leaks,
      `instance data in a public profile: ${leaks.join(", ")} — ` +
        "move it to the private overlay's profiles/ directory (config/profiles/README.md); " +
        "config/profiles ships templates only",
    ).toEqual([]);
  });

  test("platform core seed excludes removed production ERP files", () => {
    const coreDir = join(ROOT, "aisha/db/seed/core");
    const files = readdirSync(coreDir);
    expect(files.filter((file) => /^1[678]_production_erp/.test(file))).toEqual([]);
  });
});

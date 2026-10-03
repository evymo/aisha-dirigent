/**
 * Gate: resolved-deploy carries no placeholder value
 *
 * The 2026-06-30 prod cold-start --wipe incident took prod fully DOWN because
 * the RESOLVED deploy env carried REGISTRY_PROXY=cache.aisha.example.com/ —
 * derive-domains.mjs silently fell back to a *.json.example when operator TLDs
 * were absent, and nothing inspected the resolved VALUES (env checks were
 * presence/shape only; `docker compose config` treats an example hostname as a
 * valid image ref). REGISTRY_PROXY prefixes every image, so 100% of pulls failed.
 *
 * Prevention (this gate + scripts/lib/placeholder-scan.mjs + a cold-start
 * pre-wipe guard):
 *   - the scanner derives its denylist from internet STANDARDS (RFC2606
 *     example.{com,net,org}/.test + placeholder words) augmented at runtime from
 *     tracked *.example files — NOT a maintained allow-list of our infra;
 *   - it excludes the RFC6761 sentinels we deliberately ship (*.invalid/*.local);
 *   - cold-start runs it on the fully-resolved .env.coolify BEFORE the deferred
 *     wipe, refusing the destroy while the old apps still exist.
 *
 * This gate verifies the scanner's red/green behaviour and that the cold-start
 * wiring stays in place.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM helper, no types
import { scanEnv, isPlaceholder } from "../../../scripts/lib/placeholder-scan.mjs";

const ROOT = process.cwd();

describe("resolved-deploy placeholder guard", () => {
  test("scanEnv FLAGS placeholder/example values (the exact prod-killer set)", () => {
    const offenders = scanEnv(
      [
        "REGISTRY_PROXY=cache.aisha.example.com/",
        "PUBLIC_TLD=aisha.example.com",
        "API_DOMAIN_PUBLIC=api.aisha.example.com",
        "MESH_TLD=mesh.example.net",
      ].join("\n"),
    );
    const keys = offenders.map((o: { key: string }) => o.key);
    expect(keys).toContain("REGISTRY_PROXY");
    expect(keys).toContain("PUBLIC_TLD");
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  test("severity: hostname/registry placeholders BLOCK; email placeholders are COSMETIC; .invalid is ignored", () => {
    // The pre-wipe guard must HARD-FAIL only on deploy-breaking placeholders
    // (hostnames/registry/domains that break image pulls or routing) — an
    // admin@example.com login email is a placeholder worth fixing but must NOT
    // abort a prod wipe (real finding 2026-06-30: 3 admin emails in the live
    // .env.coolify would have false-positive-blocked the next --wipe).
    const hosts = scanEnv("REGISTRY_PROXY=cache.aisha.example.com/\nAPI_DOMAIN=api.aisha.example.com");
    expect(hosts.length).toBe(2);
    expect(hosts.every((o: { severity: string }) => o.severity === "blocking")).toBe(true);

    const emails = scanEnv("LANGFUSE_ADMIN_EMAIL=admin@example.com\nPGADMIN_EMAIL=admin@example.com");
    expect(emails.length).toBe(2);
    expect(emails.every((o: { severity: string }) => o.severity === "cosmetic")).toBe(true);

    // The .invalid sentinel default (generate-secrets fallback) is NOT a placeholder.
    expect(scanEnv("ADMIN_EMAIL=admin@example.invalid")).toEqual([]);

    // A leaked inline comment as a value (`# https://...`) is structurally invalid
    // → BLOCKING (2026-06-30: AISHA_INSTANCE_DATA_GIT_URL captured a .example
    // trailing comment, shadowing the real URL → overlay never applied).
    const leak = scanEnv("AISHA_INSTANCE_DATA_GIT_URL=# https://oauth2:x@h/o/r.git#main");
    expect(leak.length).toBe(1);
    expect(leak[0].severity).toBe("blocking");
    // A real color value (#FF6A1A — hash, no space) is NOT a leak.
    expect(scanEnv("BRAND_EMBER=#FF6A1A")).toEqual([]);
  });

  test("scanEnv PASSES real operator values, RFC6761 sentinels, and secret-named keys", () => {
    const offenders = scanEnv(
      [
        "PUBLIC_TLD=aisha.guru",
        "INTERNAL_TLD=internal.aisha.network",
        "REGISTRY_PROXY=cache.aisha.guru/",
        "API_DOMAIN_PUBLIC=api.aisha.guru",
        "EDGE_APEX_REDIRECT=apex-redirect-disabled.invalid", // RFC6761 sentinel
        "SOME_LOCAL_HOST=svc.local", // local-dev sentinel
        "DB_PASSWORD=examplexyz12345", // secret-named → skipped (random value)
      ].join("\n"),
    );
    expect(offenders, `unexpected offenders: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  test("isPlaceholder: standards true, real + sentinels false", () => {
    expect(isPlaceholder("cache.aisha.example.com")).toBe(true);
    expect(isPlaceholder("foo.test")).toBe(true);
    expect(isPlaceholder("changeme")).toBe(true);
    expect(isPlaceholder("your-domain.tld")).toBe(true);
    expect(isPlaceholder("aisha.guru")).toBe(false);
    expect(isPlaceholder("api.aisha.network")).toBe(false);
    expect(isPlaceholder("apex-redirect-disabled.invalid")).toBe(false); // sentinel
  });

  test("cold-start runs placeholder-scan on the resolved env BEFORE the deferred wipe", () => {
    const cs = readFileSync(join(ROOT, "scripts", "aisha-cold-start.sh"), "utf-8");
    // The scanner is invoked on .env.coolify…
    expect(cs).toMatch(/placeholder-scan\.mjs"?\s+"?\$(?:\{)?ENV_COOLIFY/);
    // …as a HARD refuse (exit 1), not advisory, and BEFORE the destroy call.
    const guardIdx = cs.indexOf("PRE-WIPE PLACEHOLDER GUARD");
    // `wipe_orphan_apps\nelse` byl doslovný pin — rozbil ho fail-closed `|| exit 1`,
    // který je naopak posílení. Kotví se na volání, ne na jeho okolí.
    // Kotví se na VOLÁNÍ, ne na definici (`wipe_orphan_apps() {` je v souboru dřív)
    // a ne na jeho okolí: doslovný pin `wipe_orphan_apps\nelse` tu rozbil fail-closed
    // `|| exit 1`, který je naopak posílení (2026-08-13).
    const wipeIdx = cs.search(/^\s*wipe_orphan_apps(?:\s*\|\|[^\n]*)?\s*$/m);
    expect(guardIdx, "PRE-WIPE PLACEHOLDER GUARD missing from cold-start").toBeGreaterThan(0);
    if (wipeIdx > 0) expect(guardIdx).toBeLessThan(wipeIdx);
  });
});

/**
 * License Consistency Gate
 *
 * Asserts that all licensing SoT files and human-readable docs agree on
 * Elastic License 2.0, and that stale "Private" / "UNLICENSED" / "Apache"
 * markers have been removed.
 *
 * Files checked:
 *   LICENSE          — must contain ELv2 canonical text
 *   NOTICE           — must reference ELv2
 *   package.json     — "license" field must be "Elastic-2.0"
 *   README.md        — ## License section must state ELv2
 *   README.<lang>.md — every language version must have a ## License section stating ELv2
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();

function read(rel: string): string {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return "";
  return readFileSync(abs, "utf-8");
}

/** Extract the content of a ## Heading section (up to the next ## heading or EOF). */
function extractSection(content: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const match = re.exec(content);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeading = rest.search(/^##\s/m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

// ─── LICENSE file ─────────────────────────────────────────────────────────────

describe("LICENSE", () => {
  const content = read("LICENSE");

  it("exists", () => {
    expect(existsSync(join(ROOT, "LICENSE"))).toBe(true);
  });

  it("contains 'Elastic License 2.0'", () => {
    expect(content).toContain("Elastic License 2.0");
  });

  it("does not contain Apache License text", () => {
    expect(content).not.toMatch(/Apache License/i);
  });

  it("contains the key hosted-service limitation", () => {
    expect(content).toMatch(/hosted or managed\s+service/i);
  });
});

// ─── NOTICE file ──────────────────────────────────────────────────────────────

describe("NOTICE", () => {
  const content = read("NOTICE");

  it("exists", () => {
    expect(existsSync(join(ROOT, "NOTICE"))).toBe(true);
  });

  it("references Elastic License 2.0", () => {
    expect(content).toContain("Elastic License 2.0");
  });

  it("does not reference Apache License 2.0 as the project license", () => {
    // Third-party deps listed in NOTICE may be Apache-2.0 (Keycloak, Docker, etc.)
    // — we only forbid the project's own license line still saying Apache.
    expect(content).not.toMatch(/Licensed under the Apache License/i);
  });
});

// ─── package.json ─────────────────────────────────────────────────────────────

describe("package.json", () => {
  const pkg = JSON.parse(read("package.json") || "{}");

  it("has a 'license' field", () => {
    expect(pkg).toHaveProperty("license");
  });

  it("'license' field is 'Elastic-2.0' (SPDX)", () => {
    expect(pkg.license).toBe("Elastic-2.0");
  });
});

// ─── README.md ────────────────────────────────────────────────────────────────

describe("README.md — License section", () => {
  const content = read("README.md");
  const section = extractSection(content, "License");

  it("has a ## License section", () => {
    expect(section).not.toBe("");
  });

  it("section contains 'Elastic License 2.0'", () => {
    expect(section).toContain("Elastic License 2.0");
  });

  it("section does not contain 'Private'", () => {
    expect(section).not.toMatch(/Private\s*—/);
  });

  it("section does not contain 'UNLICENSED'", () => {
    expect(section).not.toMatch(/UNLICENSED/i);
  });
});

// ─── README.<lang>.md — every language version ───────────────────────────────
// 2026-10-03: README.md became the English primary and the Czech version moved to
// README.cs.md (generated from it). The gate used to name README.en.md; naming one
// language file would go blind the day the set of languages changes, so it now
// measures the PROPERTY: every README language version states ELv2.

describe("README.<lang>.md — License section in every language version", () => {
  const languageReadmes = readdirSync(ROOT).filter((f) => /^README\.[a-z]{2}(-[A-Z]{2})?\.md$/.test(f)).sort();

  it("at least one language version exists (README.cs.md)", () => {
    expect(languageReadmes).toContain("README.cs.md");
  });

  for (const file of languageReadmes) {
    const section = extractSection(read(file), "License");

    it(`${file} has a ## License section`, () => {
      expect(section).not.toBe("");
    });

    it(`${file} section contains 'Elastic License 2.0'`, () => {
      expect(section).toContain("Elastic License 2.0");
    });
  }
});

// ─── Publishable workspace packages — license uniformity ───────────────────────
// The root license field/text was the only thing the gate originally checked,
// so a member package could (and did: n8n-nodes-aisha was MIT) drift. Every
// PUBLISHABLE member must declare Elastic-2.0 AND its tarball must carry the
// license text — guaranteed either by a committed LICENSE file or by the
// publish script staging the root LICENSE (scripts/aisha-packages-publish.mjs
// stageLicense()). 2026-06-10.
describe("publishable workspace packages license uniformity", () => {
  /** A workspace member is publishable when it is NOT private and either has a
   *  publishConfig or an @aisha/-style scoped name with a build script. */
  function listPublishable(): { dir: string; pkg: Record<string, unknown> }[] {
    const out: { dir: string; pkg: Record<string, unknown> }[] = [];
    for (const base of ["packages", "extensions"]) {
      const baseDir = join(ROOT, base);
      if (!existsSync(baseDir)) continue;
      for (const name of readdirSync(baseDir)) {
        const memberDir = join(baseDir, name);
        if (!statSync(memberDir).isDirectory()) continue;
        const pj = join(memberDir, "package.json");
        if (!existsSync(pj)) continue;
        let pkg: Record<string, unknown>;
        try { pkg = JSON.parse(readFileSync(pj, "utf-8")); } catch { continue; }
        const isPrivate = pkg.private === true;
        const scripts = (pkg.scripts ?? {}) as Record<string, string>;
        const publishable = !isPrivate && (Boolean(pkg.publishConfig) || (typeof pkg.name === "string" && scripts.build !== undefined));
        // n8n-nodes-aisha publishes via its own flow (no publishConfig but a real publish target)
        const isN8n = typeof pkg.name === "string" && pkg.name.includes("n8n-nodes");
        if (publishable || (isN8n && !isPrivate)) out.push({ dir: memberDir, pkg });
      }
    }
    return out;
  }

  const members = listPublishable();

  it("discovers the publishable members", () => {
    expect(members.length).toBeGreaterThanOrEqual(8);
  });

  for (const { dir, pkg } of members) {
    const rel = relative(ROOT, dir);
    it(`${pkg.name} declares Elastic-2.0`, () => {
      expect(pkg.license, `${rel}/package.json license must be Elastic-2.0`).toBe("Elastic-2.0");
    });
  }

  it("publish script stages the root LICENSE into each package tarball", () => {
    const src = read("scripts/aisha-packages-publish.mjs");
    expect(src, "aisha-packages-publish.mjs must copy the root LICENSE into the publish dir").toMatch(/stageLicense|copyFileSync\([^)]*LICENSE/);
  });
});

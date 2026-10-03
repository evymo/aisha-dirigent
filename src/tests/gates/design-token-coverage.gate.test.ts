import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every design token a surface READS must be DEFINED by the design language.
 *
 * A `var(--x)` whose name nobody declares does not fail loudly — it silently
 * takes the fallback written next to it, or renders nothing when there is none.
 * That is how a surface drifts out of the language while still looking plausible:
 * the fallback is a literal, so it stops tracking the brand and stops flipping
 * between themes, and no test notices.
 *
 * Measured on the fork main 2026-08-01, before this gate: 11 names were read and
 * declared nowhere — not by the library, not by the instance overlay.
 *   --color-primary  fell back to #4f8cff — a BLUE, in an Ignition-orange product
 *   --font-body      fell back to system-ui, so Inter never applied to that rule
 *   --border-strong  fell back to var(--accent), itself undeclared → to nothing
 *   --accent         had no fallback at all, so the declaration simply dropped
 * All eleven were consumer typos for names the language already had
 * (--primary, --font-sans, --primary-accent …), not gaps in the language.
 *
 * The gate pins the PROPERTY — read ⊆ declared — and finds both sets by reading
 * the files, never from a list kept here. A new token, a new stylesheet or a new
 * surface is therefore covered the moment it exists; a list would have to be
 * remembered, and the thing this gate guards against is precisely forgetting.
 */
const ROOT = join(__dirname, "../../..");

/** Stylesheets that COMPOSE a customer-facing surface (they read tokens). */
function surfaceStylesheets(): string[] {
  const found: string[] = [];
  const lib = join(ROOT, "packages/design-language/src/styles.css");
  if (existsSync(lib)) found.push(lib);
  const apps = join(ROOT, "apps");
  if (existsSync(apps)) {
    for (const e of readdirSync(apps, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const css = join(apps, e.name, "src/styles.css");
      if (existsSync(css)) found.push(css);
    }
  }
  return found;
}

/**
 * Files that DECLARE tokens: the language plus every instance overlay. An
 * overlay may legitimately introduce a name of its own (a sector tint, a
 * sub-brand), so it counts as a declaration site — the rule is that SOMEONE
 * declares it, not that the library does.
 */
function declarationSources(): string[] {
  const out: string[] = [];
  const lib = join(ROOT, "packages/design-language/src/styles.css");
  if (existsSync(lib)) out.push(lib);
  const instances = join(ROOT, "instances");
  if (existsSync(instances)) {
    for (const e of readdirSync(instances, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const css = join(instances, e.name, "public/tokens.css");
      if (existsSync(css)) out.push(css);
    }
  }
  return out;
}

const names = (files: string[], re: RegExp): Set<string> => {
  const s = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(re)) s.add(m[1]);
  }
  return s;
};

describe("design token coverage (every token a surface reads is declared)", () => {
  const sheets = surfaceStylesheets();

  it("finds the stylesheets to check (an empty universe would pass vacuously)", () => {
    expect(sheets.length, "no surface stylesheet found — the gate would assert nothing").toBeGreaterThan(0);
  });

  it("every surface stylesheet parses as CSS", async () => {
    // The token rules below read the file as TEXT, so a stylesheet can satisfy them
    // while being unparseable — and then only the vite build says so, minutes later
    // and in another job. Measured here first: a `*/` inside a comment (written in
    // prose like "--space-*/--radius-*") closes the comment early and turns the next
    // declarations into stray words. Cheap to check, so check it where it is cheap.
    //
    // parse(), not process(): with no plugins a LazyResult never actually parses, so
    // `process(css).async()` resolves happily on a file that cannot be compiled — a
    // green check over an assertion that never ran.
    const { parse } = await import("postcss");
    for (const f of sheets) {
      const css = readFileSync(f, "utf8");
      expect(() => parse(css, { from: f }), `${f.replace(ROOT + "/", "")} does not parse as CSS`).not.toThrow();
    }
  });

  it("every var(--token) read by a surface is declared somewhere", () => {
    const read = names(sheets, /var\(\s*(--[a-z0-9-]+)/g);
    const declared = names(declarationSources(), /(--[a-z0-9-]+)\s*:/g);
    expect(read.size, "no tokens read — check the regex, not the code").toBeGreaterThan(10);

    const missing = [...read].filter((t) => !declared.has(t)).sort();
    expect(
      missing,
      `read but never declared: ${missing.join(", ")}\n` +
        "A name nobody declares takes its literal fallback: it stops following the brand " +
        "and stops flipping between carbon/daylight. Use the name the language already has " +
        "(see packages/design-language/src/styles.css) rather than declaring a synonym.",
    ).toEqual([]);
  });

  it("a surface never hardcodes a brand colour it could read from a token", () => {
    // Fallback literals are the loophole the rule above closes from the other side:
    // `var(--x, #abc)` keeps the gate green while pinning a colour. Only the
    // LANGUAGE may carry hex; a surface consumes.
    const offenders: string[] = [];
    for (const f of sheets) {
      if (f.endsWith("packages/design-language/src/styles.css")) continue; // the language owns values
      for (const m of readFileSync(f, "utf8").matchAll(/var\(\s*--[a-z0-9-]+\s*,\s*(#[0-9a-fA-F]{3,8})/g)) {
        offenders.push(`${f.replace(ROOT + "/", "")}: ${m[1]}`);
      }
    }
    expect(
      offenders,
      `hex fallback in a surface stylesheet: ${offenders.join(" · ")}\n` +
        "A fallback colour is a second source of truth that never flips theme. " +
        "Read the token without a fallback — if it is missing, the gate above says so.",
    ).toEqual([]);
  });
});

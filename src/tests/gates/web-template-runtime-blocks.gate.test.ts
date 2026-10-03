/**
 * Gate: dynamic-template runtime-block integrity.
 *
 * Self-contained demo templates under `domains/templates/<name>/` can embed live
 * data via `<div data-runtime-block="<id>">` placeholders that PageRenderer swaps
 * for React components at render. Two production-safety invariants nothing else
 * enforced:
 *
 *  1. RUNTIME-BLOCK ID INTEGRITY — every `data-runtime-block` id authored in a
 *     template must be a REGISTERED block id, and the three hand-maintained id
 *     lists must not drift: the render registry
 *     (src/lib/builder/runtimeBlockRegistry.ts), the ingest detector's
 *     KNOWN_BLOCKS (services/svc-web-artifact/src/lib/runtimeBlockDetector.ts),
 *     and that detector's docstring. A typo'd id (`product-catolog`) otherwise
 *     passes every other gate and renders silently null in production.
 *
 *  2. THEME-TOKEN COHERENCE — a template that embeds a runtime block must define
 *     the runtime-consumed shadcn tokens (`--primary`/`--card`/`--muted-foreground`)
 *     in its tokens.css as BARE-HSL triplets ("H S% L%"), not hex. The blocks read
 *     `hsl(var(--token))`; a hex value would yield invalid `hsl(#...)` and silently
 *     fall back to the global app brand — the exact regression this gate prevents.
 *
 * All checks are static (file reads + regex) so the gate runs offline in the
 * gate suite and never imports across the services/ package boundary.
 *
 * @module
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const TEMPLATES_DIR = join(ROOT, "domains/templates");
const REGISTRY = join(ROOT, "src/lib/builder/runtimeBlockRegistry.ts");
const DETECTOR = join(ROOT, "services/svc-web-artifact/src/lib/runtimeBlockDetector.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

/** Registered ids — the id literal after `registerRuntimeBlock(`. */
function registryIds(): string[] {
  return [...read(REGISTRY).matchAll(/registerRuntimeBlock\(\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .sort();
}

/** The detector's KNOWN_BLOCKS Set literal ids. */
function detectorKnownBlocks(): string[] {
  const block = read(DETECTOR).match(/const KNOWN_BLOCKS = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** The detector's "Known block types" docstring text. */
function detectorDocstring(): string {
  const m = read(DETECTOR).match(/Known block types[\s\S]*?\*\//);
  return m ? m[0] : "";
}

/** Every `data-runtime-block` id authored across all template pages. */
function templateBlockRefs(): Array<{ tpl: string; page: string; id: string }> {
  const out: Array<{ tpl: string; page: string; id: string }> = [];
  if (!existsSync(TEMPLATES_DIR)) return out;
  for (const d of readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(TEMPLATES_DIR, d.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const html = read(join(dir, f));
      for (const m of html.matchAll(/data-runtime-block="([^"]+)"/g)) {
        out.push({ tpl: d.name, page: f, id: m[1] });
      }
    }
  }
  return out;
}

describe("runtime-block id integrity gate", () => {
  const reg = registryIds();

  it("the render registry actually declares blocks", () => {
    expect(reg.length).toBeGreaterThanOrEqual(12);
  });

  it("registry ids and the ingest detector KNOWN_BLOCKS are identical (no drift)", () => {
    expect(detectorKnownBlocks()).toEqual(reg);
  });

  it("the detector docstring lists every registered block id (doc mirror)", () => {
    const doc = detectorDocstring();
    const missing = reg.filter((id) => !doc.includes(id));
    expect(missing, `docstring missing ids: ${missing.join(", ")}`).toEqual([]);
  });

  it("every data-runtime-block id authored in a template is registered", () => {
    const registered = new Set(reg);
    const unregistered = templateBlockRefs().filter((b) => !registered.has(b.id));
    expect(
      unregistered,
      `unregistered runtime-block ids: ${unregistered.map((b) => `${b.tpl}/${b.page}:${b.id}`).join(", ")}`,
    ).toEqual([]);
  });

  it("would reject a typo'd id (negative control)", () => {
    expect(new Set(reg).has("product-catolog")).toBe(false);
  });
});

describe("deepened-template theme-token gate", () => {
  // Runtime React blocks consume these shadcn tokens via hsl(var(--token)).
  const RUNTIME_TOKENS = ["--primary", "--card", "--muted-foreground"];
  // Bare-HSL triplet: "H S% L%" (fractional allowed). NOT hsl(), NOT #hex.
  const BARE_HSL = /^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/;

  // A template is "deepened" iff it embeds at least one runtime block.
  const deepened = [...new Set(templateBlockRefs().map((b) => b.tpl))].sort();

  it("sanity: BARE_HSL accepts a triplet and rejects hex / hsl()", () => {
    expect(BARE_HSL.test("33 56% 51%")).toBe(true);
    expect(BARE_HSL.test("#c98a3d")).toBe(false);
    expect(BARE_HSL.test("hsl(33 56% 51%)")).toBe(false);
  });

  it("there are deepened templates to enforce (no silent-empty)", () => {
    expect(deepened.length).toBeGreaterThanOrEqual(4);
  });

  it.each(deepened)(
    "%s/tokens.css defines the runtime-consumed shadcn tokens as bare-HSL",
    (tpl) => {
      const css = read(join(TEMPLATES_DIR, tpl, "tokens.css"));
      const problems: string[] = [];
      for (const tok of RUNTIME_TOKENS) {
        // The bare token declaration only — `--color-primary:` won't match `--primary:`.
        const m = css.match(new RegExp(`(?:^|\\n)\\s*${tok}:\\s*([^;]+);`));
        if (!m) {
          problems.push(`${tok} not declared`);
          continue;
        }
        const value = m[1].trim();
        if (!BARE_HSL.test(value)) problems.push(`${tok} not bare-HSL: "${value}"`);
      }
      expect(problems, `${tpl}: ${problems.join("; ")}`).toEqual([]);
    },
  );
});

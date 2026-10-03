import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every client must draw the WHOLE mask catalogue.
 *
 * `block_type` is the closed side of the surface contract precisely because it
 * names a renderer the client has to ship. A client that knows fewer types than
 * the contract does not fail loudly — it renders a bare title while another
 * client shows content, so the same layout silently means different things on
 * different devices. Measured 2026-07-27: mobile-app knew 6 of 9 types, and two
 * of those six (`document_register`, `obligation_queue`) were not types at all
 * but RPC NAMES — dead branches that could never fire, mistaken for coverage.
 *
 * The gate pins the PROPERTY (every catalogue entry is drawable everywhere),
 * not the spelling of any one type — adding a type to the contract fails this
 * until each renderer grows a branch for it, which is the intended pressure.
 */
const ROOT = join(__dirname, "../../..");

const CONTRACT = join(ROOT, "packages/surface-blocks/src/types.ts");

/**
 * `declares` names a SECOND list of block types the renderer keeps about itself
 * (the mobile card decides its "unknown type" notice from one). Such a list is
 * invisible to `pattern` — it does not sit in a `block_type ===` test — so it
 * could rot while this gate stayed green, and did: measured 2026-08-03, seven
 * types drew their content AND the "unknown type" notice, while two RPC names
 * left over from the 2026-07-27 fix still counted as coverage. A renderer may
 * hold such a list, but it must equal what the renderer actually draws.
 */
const RENDERERS = [
  {
    file: "mobile-app/src/extranet/BlockRenderer.tsx",
    pattern: /block_type === "([a-z_]+)"/g,
    declares: /const DRAWN_TYPES = new Set<string>\(\[([\s\S]*?)\]\)/,
  },
  { file: "apps/workbench-shell/src/components/blocks.tsx", pattern: /case '([a-z_]+)':/g },
];

function catalogue(): Set<string> {
  const src = readFileSync(CONTRACT, "utf8");
  // Od 2026-08-17 katalog NENÍ literální unie, ale `BLOCK_TYPES as const` —
  // jediný zapisovatel, ze kterého se odvozuje TS unie i runtime enum ve
  // schematech. Brána čte TENTÝŽ zdroj. (Starý regex na unii tu po refaktoru
  // našel jednořádkové `(typeof BLOCK_TYPES)[number]`, nula literálů — a guard
  // níž správně shodil běh místo vakuově zelených tvrzení.)
  const decl = /export const BLOCK_TYPES = \[([\s\S]*?)\] as const;/.exec(src);
  expect(decl, "BLOCK_TYPES const not found in the contract").toBeTruthy();
  const types = new Set([...decl![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  // A catalogue that parsed as empty would make every assertion below vacuous.
  expect(types.size).toBeGreaterThan(5);
  return types;
}

describe("surface renderer parity (every client draws the whole mask catalogue)", () => {
  const types = catalogue();

  for (const { file, pattern, declares } of RENDERERS) {
    it(`${file} draws every block type`, () => {
      const src = readFileSync(join(ROOT, file), "utf8");
      const drawn = new Set([...src.matchAll(pattern)].map((m) => m[1]));
      const missing = [...types].filter((t) => !drawn.has(t)).sort();
      expect(missing, `${file} cannot draw: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${file} draws nothing outside the catalogue`, () => {
      const src = readFileSync(join(ROOT, file), "utf8");
      const drawn = [...src.matchAll(pattern)].map((m) => m[1]);
      // Renderers switch on other things too (chart kinds, review intents); only
      // flag values that LOOK like block types — i.e. sit in a block_type test —
      // yet are absent from the catalogue. An RPC name mistaken for a type is
      // exactly this shape, and it is dead code that reads as coverage.
      const strays = [...new Set(drawn)].filter((d) => !types.has(d)).sort();
      expect(strays, `${file} branches on non-types: ${strays.join(", ")}`).toEqual([]);
    });

    if (declares) {
      it(`${file} says about itself exactly what it draws`, () => {
        const src = readFileSync(join(ROOT, file), "utf8");
        const block = declares.exec(src);
        expect(block, `${file}: self-described catalogue not found`).toBeTruthy();
        const declared = new Set([...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
        const drawn = new Set([...src.matchAll(pattern)].map((m) => m[1]));

        // Both directions, and both against the contract: a type left out of the
        // list prints "unknown type" under its own content, one added without a
        // branch renders a bare title and says nothing is wrong.
        expect([...declared].sort(), `${file}: declared ≠ drawn`).toEqual([...drawn].sort());
        expect([...declared].sort(), `${file}: declared ≠ catalogue`).toEqual([...types].sort());
      });
    }
  }
});

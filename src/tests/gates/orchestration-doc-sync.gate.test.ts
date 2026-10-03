/**
 * Gate — orchestration docs must match the current E1/E3 implementation status.
 *
 * The orchestration docs are used as SoT during planning. When implementation
 * lands, stale "proposal/missing" text is dangerous: it causes duplicate work or
 * hides real gaps. This gate locks the current split:
 *   - ToT v1 and direct_llm/openclaw/hermes RuntimeAdapter flow are on main.
 *   - ToT fleet, close_story driver, and CLI adapter remain backlog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("orchestration docs sync", () => {
  const totDoc = read("docs/proposals/TREE_OF_THOUGHTS_REFLECTION.md");
  const zadani = read("docs/proposals/AISHA_ORCHESTRATION_ZADANI.md");

  it("TREE_OF_THOUGHTS marks shipped ToT v1 and names the code SoT", () => {
    expect(totDoc).toContain("Implementation sync 2026-06-21");
    expect(totDoc).toContain("reasoning-tree-reflect.json");
    expect(totDoc).toContain("tot_planner");
    expect(totDoc).toContain("tot_expand");
    expect(totDoc).toContain("tot_evaluate");
    expect(totDoc).toContain("tot_search");
    expect(totDoc).toContain("tot_action='expand'|'evaluate'|'search'|'done'");
  });

  it("ZADANI marks E1 ToT and E3 RuntimeAdapter flow as merged, with the remaining backlog explicit", () => {
    expect(zadani).toContain("E1/E3 execution layer (`[merged]` on `main`");
    expect(zadani).toContain("Single-run ToT v1:");
    expect(zadani).toContain("RuntimeAdapter registry:");
    expect(zadani).toContain("### E1 — Single-run ToT `[merged]`");
    expect(zadani).toContain("### E3 — Hermes / runtime adapters `[partial merged]`");
    expect(zadani).toContain("`[missing]` generic CLI driver");
    expect(zadani).toContain("`[missing]` Distributed child-run fleet");
    expect(zadani).toContain("`[missing]` `close_story` driver");
  });

  it("ZADANI does not regress to obsolete missing-status claims for shipped pieces", () => {
    expect(zadani).not.toContain("[missing] RuntimeAdapter interface + Hermes adapter + generic CLI driver");
    expect(zadani).not.toContain("### 3.2 RuntimeAdapter interface `[missing]`");
    expect(zadani).not.toContain("### E1 — Single-run ToT `[wire-up]`");
    expect(zadani).not.toContain("`ToTState` / `ThoughtNode` / `ToTPolicy` | `[missing]`");
  });
});

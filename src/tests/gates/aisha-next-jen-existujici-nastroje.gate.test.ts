/**
 * Brána: `/aisha-next` a výzva SessionStart volají jen nástroje MCP, které server nabízí,
 * a jen s argumenty z jejich schématu.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (F9, tři lidé ve třech IDE): `/aisha-next` stál na nástroji
 *    `suggest_next_step`, který svc-mcp-knowledge nikdy nenabízel — příkaz tak v žádném IDE
 *    nefungoval a nikdo si toho nevšiml, protože text příkazu nic neměřilo.
 *
 * Měří se nad zdrojem (žádná třetí tabulka):
 *   - jména nástrojů = `tool('…')` v services/svc-mcp-knowledge/src/routes/mcp.ts;
 *   - argumenty a hodnoty výčtů = zod schémata (lib/knowledge-tool-inputs.ts);
 *   - kódy chyb = lib/chyba-nastroje-prace.ts.
 * Každý identifikátor v `kódu` příkazu ve tvaru snake_case musí být jedno z toho.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_TOOL_INPUTS } from "../../../services/svc-mcp-knowledge/src/lib/knowledge-tool-inputs";
import { KODY_CHYBY_PRACE } from "../../../services/svc-mcp-knowledge/src/lib/chyba-nastroje-prace";

const ROOT = process.cwd();
const cti = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

const NASTROJE = new Set([...cti("services/svc-mcp-knowledge/src/routes/mcp.ts").matchAll(/\btool\('([a-z0-9_]+)'/g)].map((m) => m[1]));

/** Argumenty všech znalostních nástrojů + hodnoty jejich výčtů (zod v4: shape / options). */
function argumentyAVycty(): Set<string> {
  const ven = new Set<string>();
  for (const schema of Object.values(KNOWLEDGE_TOOL_INPUTS)) {
    for (const [klic, pole] of Object.entries((schema as unknown as { shape: Record<string, unknown> }).shape)) {
      ven.add(klic);
      let typ = pole as { options?: unknown; unwrap?: () => unknown; def?: { innerType?: unknown } };
      for (let i = 0; i < 4 && !Array.isArray(typ.options); i++) {
        const vnitrni = typ.def?.innerType ?? (typeof typ.unwrap === "function" ? typ.unwrap() : undefined);
        if (!vnitrni) break;
        typ = vnitrni as typeof typ;
      }
      if (Array.isArray(typ.options)) for (const v of typ.options) ven.add(String(v));
    }
  }
  return ven;
}

/** snake_case identifikátory v `kódu` — tvar jmen nástrojů, argumentů a kódů. */
const identifikatory = (text: string) => [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);

describe("/aisha-next a SessionStart volají jen existující nástroje MCP", () => {
  const povolene = new Set<string>([...NASTROJE, ...argumentyAVycty(), ...KODY_CHYBY_PRACE]);

  it("kotva: měřidlo vidí nástroje, argumenty i kódy", () => {
    expect(NASTROJE.size).toBeGreaterThan(20);
    for (const n of ["my_next_steps", "complete_step", "report_progress", "get_story_context"]) expect(NASTROJE.has(n), n).toBe(true);
    expect(povolene.has("step_id")).toBe(true);
    expect(povolene.has("architecture_decision"), "hodnota výčtu kind").toBe(true);
    expect(povolene.has("suggest_next_step"), "fantom nesmí být povolený").toBe(false);
  });

  it("/aisha-next: každý nástroj, argument a kód existuje", () => {
    const prikaz = cti(".claude/commands/aisha-next.md");
    const nezname = identifikatory(prikaz).filter((id) => !povolene.has(id));
    expect(nezname, "neexistující nástroj nebo argument v /aisha-next").toEqual([]);
    for (const n of ["my_next_steps", "get_story_context", "report_progress", "complete_step"]) {
      expect(prikaz, `/aisha-next má volat ${n}`).toContain(`\`${n}\``);
    }
  });

  it("SessionStart vyzve ke stažení práce existujícími nástroji", () => {
    const nastaveni = JSON.parse(cti(".claude/settings.json")) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    const prikazy = nastaveni.hooks.SessionStart.flatMap((s) => s.hooks.map((h) => h.command)).join("\n");
    const zminene = [...prikazy.matchAll(/\b([a-z]+(?:_[a-z]+){1,3})\b/g)].map((m) => m[1]).filter((id) => /_(steps?|context|progress)$/.test(id));
    expect(zminene).toEqual(expect.arrayContaining(["my_next_steps", "get_story_context"]));
    expect(zminene.filter((id) => !NASTROJE.has(id)), "SessionStart zmiňuje neexistující nástroj").toEqual([]);
  });
});

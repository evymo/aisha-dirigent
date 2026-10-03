/**
 * Brána: v SoT nesmí PŘIBÝT volání pg_net (`net.http_*`) — rohatka dluhu, jen ubývá.
 *
 * ⛔ PROČ (naměřeno 2026-09-26): pg_net v obrazu DB není. `net.http_post` v těle funkce
 * proto nikdy nic nedoručí, ale čtenář kódu vidí „tady se posílá“ — a dispečer akcí po
 * události tak dva měsíce „posílal“ do n8n, zatímco běhy ležely pending. Nová cesta
 * doručení = zápis do outboxu (`ai_proactive_runs`) a executor v event-workeru.
 *
 * Vlastnost, ne pravopis: hledá se VOLÁNÍ ve skutečném SQL — komentáře (`--`, blokové)
 * se před hledáním odstraní, takže poznámka „bez pg_net“ bránu nespustí, ale volání
 * schované za ní ano. Rohatka je oboustranná (vzor cislo-z-prostredi-ma-straz).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SOT = join(process.cwd(), "aisha/db/sql");
const baseline = JSON.parse(
  readFileSync(join(__dirname, "sot-bez-pg-net.baseline.json"), "utf8"),
) as { soubory: string[] };

function sqlSoubory(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...sqlSoubory(p));
    else if (e.endsWith(".sql")) out.push(p);
  }
  return out;
}

/** SQL bez komentářů. Řetězce se nechávají — volání v dynamickém SQL je pořád volání. */
export function bezKomentaru(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function volaPgNet(sql: string): boolean {
  return /\bnet\s*\.\s*http_[a-z_]+\s*\(/i.test(bezKomentaru(sql));
}

const nalezy = sqlSoubory(SOT)
  .filter((p) => volaPgNet(readFileSync(p, "utf8")))
  .map((p) => relative(SOT, p))
  .sort();

describe("SoT bez pg_net — rohatka dluhu", () => {
  it("detektor rozliší volání od zmínky v komentáři (kontrolní vzorek)", () => {
    expect(volaPgNet("PERFORM net.http_post(url := 'x');")).toBe(true);
    expect(volaPgNet("PERFORM net . http_get (url := 'x');")).toBe(true);
    expect(volaPgNet("-- dřív net.http_post(...)\nSELECT 1;")).toBe(false);
    expect(volaPgNet("/* net.http_post( */ SELECT 1;")).toBe(false);
    expect(nalezy.length, "měřidlo nic nenašlo — rohatka by nic neznamenala").toBeGreaterThan(0);
  });

  it("⛔ volání pg_net nesmí PŘIBÝT", () => {
    const nove = nalezy.filter((f) => !baseline.soubory.includes(f));
    expect(
      nove,
      "nové volání net.http_* v SoT — pg_net v DB není, doruč přes outbox ai_proactive_runs + executor v event-workeru",
    ).toEqual([]);
  });

  it("⛔ rohatka je oboustranná: co zmizelo ze SoT, musí zmizet i z baseline", () => {
    const splaceno = baseline.soubory.filter((f) => !nalezy.includes(f));
    expect(
      splaceno,
      "tyhle soubory už pg_net nevolají — smaž je ze sot-bez-pg-net.baseline.json, jinak se smí vrátit",
    ).toEqual([]);
  });
});

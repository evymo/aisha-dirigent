/**
 * Role volajícího se nečte PO ŘÁDCÍCH (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-29 na produkci. `li_doc_slugs_claimed_by` (volá ji politika
 * registru dokladů, tedy KAŽDÉ čtení registru běžným uživatelem) měla v předfiltru
 *
 *     OR (s.assigned_role IS NOT NULL AND public.has_role(p_uid, s.assigned_role))
 *
 * — dotaz na roli VOLAJÍCÍHO, položený znovu pro každý krok procesu (6 330×).
 * Samotný předfiltr stál 4 908 ms; role načtené jednou do pole 80 ms, výsledek
 * shodný. Tatáž lekce už jednou padla u vazeb účtu (2026-09-10, „vazba je
 * vlastnost VOLAJÍCÍHO, ne kroku"), jen se nepřenesla na role.
 *
 * Pravidlo: `has_role(<kdo>, <sloupec řádku>)` znamená „má volající roli, kterou
 * nese tenhle řádek?" — odpověď na to se nemění s řádkem, mění se jen otázka.
 * Správně je role volajícího jednou (pole / CTE `scope`) a porovnání se sloupcem:
 * `s.assigned_role = any(v_roles)`. Volání s literálem (`has_role(uid, 'admin')`)
 * je v pořádku — to se ptá jednou.
 *
 * Brána čte KÓD, ne komentáře: vysvětlivka s tímhle vzorem (jako výš) se nepočítá.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "aisha/db/sql");
const DIRS = ["functions", "policies", "views"];

/**
 * `has_role(<kdo>, <alias>.<sloupec>[::typ])` — `<kdo>` smí nést závorky do dvou
 * úrovní (`(select auth.uid())`), aby tvar s poddotazem neproklouzl.
 */
const PER_ROW_ROLE =
  /\bhas_role\s*\((?:[^,()]|\((?:[^()]|\([^()]*\))*\))+,\s*[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*(?:::[a-z_]+)?\s*\)/i;

function sqlFiles(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    const dir = join(ROOT, d);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const f of readdirSync(dir)) if (f.endsWith(".sql")) out.push(join(d, f));
  }
  return out;
}

/** Kód bez řádkových komentářů. */
function code(src: string): string[] {
  return src.split("\n").map((l) => {
    const i = l.indexOf("--");
    return i >= 0 ? l.slice(0, i) : l;
  });
}

describe("role volajícího se nečte po řádcích (gate)", () => {
  test("brána vůbec něco čte (ochrana proti prázdnému vstupu)", () => {
    expect(sqlFiles().length).toBeGreaterThan(100);
  });

  test("žádná funkce ani politika neptá has_role(…) se SLOUPCEM řádku", () => {
    const offenders: string[] = [];
    for (const rel of sqlFiles()) {
      code(readFileSync(join(ROOT, rel), "utf8")).forEach((line, i) => {
        if (PER_ROW_ROLE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "role volajícího se ptá pro každý řádek — načti role jednou (pole nebo CTE `scope`) " +
        "a porovnej sloupec: `s.assigned_role = any(v_roles)`:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  test("detektor chytí tvar, který 2026-09-29 stál 4,9 s (mutace)", () => {
    const bad = [
      "  OR (s.assigned_role IS NOT NULL AND public.has_role(p_uid, s.assigned_role)))",
      "  and has_role((select auth.uid()), s.assigned_role)",
      "  and public.has_role(v_uid, k.role::text)",
    ];
    const ok = [
      "  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));",
      "  IF p_assigned_role IS NOT NULL AND public.has_role(p_uid, p_assigned_role) THEN",
    ];
    for (const l of bad) expect(PER_ROW_ROLE.test(l), l).toBe(true);
    for (const l of ok) expect(PER_ROW_ROLE.test(l), l).toBe(false);
  });
});

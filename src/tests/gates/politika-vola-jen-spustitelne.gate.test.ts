/**
 * RLS politika smí volat jen funkci, kterou ta role SMÍ SPUSTIT — třídní brána
 *
 * ⛔ NAMĚŘENÁ VADA (2026-08-12, na živé cestě).
 *
 * PostgreSQL při dotazu vyhodnocuje USING/WITH CHECK výrazy VŠECH použitelných
 * politik — ne jen té, která by řádek povolila. Když kterákoli z nich odkazuje
 * funkci, na niž volající role nemá EXECUTE, celý dotaz skončí chybou
 *
 *     ERROR: permission denied for function <jméno>
 *
 * a to i tehdy, když jiná politika volajícímu data povoluje.
 *
 * Konkrétně: `is_consultant_for_user` neměla ANI JEDEN grant. Volá ji devět
 * politik na tabulkách se zdravotními daty. Gateway razí `authenticated`, takže
 * ta role na cestě JE — a člen si tím pádem nepřečetl ani svoje vlastní
 * `health_data`, `lab_results`, `dosing_logs`… Nešlo o „nevidí cizí", nevidí
 * ani svoje.
 *
 * Druhá polovina téže třídy: politiky `TO public` se vyhodnocují i pro `anon`.
 * Bez grantu pro anon vrátí PostgreSQL chybu místo prázdné množiny — a tím
 * zablokuje i politiku, která anonymu data povoluje („Anyone can read
 * published news").
 *
 * INVARIANT, který to vylučuje:
 *
 *     pro každou politiku a každou roli, na kterou dopadá,
 *     musí být každá volaná funkce pro tu roli spustitelná
 *
 * Brána ho odvozuje z BASELINE — nevypisuje seznam funkcí ani tabulek. Nová
 * politika s novou funkcí je pokrytá automaticky.
 *
 * ⚠️ Proč nad baseline a ne nad `aisha/db/sql/`: granty a politiky žijí
 * v různých souborech a část jich přibývá až v migracích. Baseline je jediné
 * místo, kde je vidět VÝSLEDNÝ stav, který se opravdu nasadí.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");

/**
 * Role, na kterou se nárok vztahuje.
 *
 * JEN `authenticated` — a je to vědomé zúžení, ne opomenutí:
 *
 *   • `authenticated` je PROKAZATELNĚ na živé cestě: gateway ji razí i pro
 *     nepřihlášeného návštěvníka (services/gateway/src/auth/postgrest-jwt.ts).
 *     Chybějící EXECUTE tady shodí dotaz skutečnému uživateli.
 *
 *   • `anon` sem NEPATŘÍ. U citlivých funkcí je „permission denied" fail-CLOSED,
 *     tedy správné chování — a `security.gate.test.ts` naopak VYŽADUJE, aby
 *     citlivé funkce anon grant NEMĚLY. Kdyby tahle brána anon nárokovala,
 *     obě brány by si odporovaly a jedna by musela vyhrát nad pravdou.
 *     Anonymní rozměr vlastní ta bezpečnostní.
 */
const VNEJSI_ROLE = ["authenticated"] as const;

type Politika = { tabulka: string; jmeno: string; role: Set<string>; funkce: Set<string> };

function nactiBaseline(): string {
  return readFileSync(BASELINE, "utf-8");
}

/** funkce → role, které na ni mají EXECUTE (podle GRANT řádků v baseline). */
function grantyFunkci(sql: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const g of sql.matchAll(
    // Prefix `public.` je VOLITELNÝ na OBOU stranách — grant i volání se píše
    // obojím způsobem. Nesymetrický regex dělá falešné poplachy (funkce grant
    // MÁ, jen bez prefixu) i falešné zeleně. Naměřeno na get_jwt_role.
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*TO\s+([^;]+);/gi,
  )) {
    const role = g[2].split(",").map((r) => r.trim().toLowerCase());
    const set = m.get(g[1]) ?? new Set<string>();
    role.forEach((r) => set.add(r));
    m.set(g[1], set);
  }
  return m;
}

/**
 * Funkce, které baseline SÁM definuje.
 *
 * ⚠️ Odvozuje se z CREATE FUNCTION, NE z mapy grantů. Kdyby se braly z grantů,
 * funkce BEZ JEDINÉHO grantu by v seznamu nebyla — filtr by ji zahodil a brána
 * by byla slepá přesně na tu vadu, kvůli které vznikla (`is_consultant_for_user`
 * neměla ani jeden grant). Odhaleno mutací, ne čtením.
 */
function definovaneFunkce(sql: string): Set<string> {
  return new Set(
    [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi)].map(
      (m) => m[1],
    ),
  );
}

/**
 * Politiky s rolemi a voláními funkcí.
 *
 * Bere jen funkce z `public.` schématu, které baseline SÁM definuje — vestavěné
 * (`auth.uid()`, `now()`, `current_setting`) mají EXECUTE pro všechny a do
 * rozpočtu nepatří.
 */
function politiky(sql: string, znameFunkce: Set<string>): Politika[] {
  const out: Politika[] = [];
  const re =
    /CREATE\s+POLICY\s+"?([^"\n]+?)"?\s+ON\s+public\.(\w+)([\s\S]*?)(?=\nCREATE\s|\nDROP\s|\n--\s---|\n?$)/g;
  for (const m of sql.matchAll(re)) {
    const telo = m[3];
    // ⚠️ Třída znaků NESMÍ obsahovat \s: to zahrnuje nový řádek, takže
    //    `TO public\n  USING (...)` se zachytilo jako role "public\n  USING"
    //    a test `role.has("public")` byl VŽDY nepravdivý — brána zeleně slepá.
    //    Odhaleno mutací, ne čtením; sanity test počítal politiky a funkce,
    //    roli nekontroloval.
    const roleM = /\bTO\s+([a-z_][a-z_, ]*)/i.exec(telo);
    if (!roleM) continue;
    const role = new Set(
      roleM[1]
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean),
    );
    // `TO public` = všechny role, tedy i anon i authenticated
    if (role.has("public")) VNEJSI_ROLE.forEach((r) => role.add(r));
    // ⚠️ Volání se píše OBOJÍM způsobem: `public.is_admin_or_staff()` i holé
    //    `is_admin_or_staff()` (search_path). Filtr, který vyžadoval prefix
    //    `public.`, viděl jen zlomek — a brána byla zeleně slepá. Odhaleno
    //    mutací (odebraný grant neprošel jako vada), ne čtením.
    const funkce = new Set(
      [...telo.matchAll(/(?:\bpublic\.)?\b(\w+)\s*\(/g)]
        .map((f) => f[1])
        .filter((f) => znameFunkce.has(f)),
    );
    out.push({ tabulka: m[2], jmeno: m[1].trim(), role, funkce });
  }
  return out;
}

/**
 * DOLOŽENÁ VÝJIMKA, ne přehlédnutí.
 *
 * `is_consultant_for_user` tu byla do 2026-10-05 jako živá vada čekající na
 * rozhodnutí, kde má žít kontrola souhlasu. Rozhodnuto: přímo ve funkci; grant
 * pro authenticated dostala a ze seznamu vypadla (měří
 * konzultant-jen-se-souhlasem.runtime.test.ts).
 *
 * ⛔ Tenhle seznam NESMÍ růst mlčky: test níž hlídá, že má právě jednu položku.
 *    Další výjimka = vědomé rozhodnutí, ne tichý přírůstek.
 */
const CEKA_NA_ROZHODNUTI = new Set(["is_story_partner"]);

describe("RLS politika volá jen funkce spustitelné danou rolí", () => {
  test("seznam výjimek nenaroste mlčky", () => {
    expect(
      [...CEKA_NA_ROZHODNUTI].sort(),
      "Každá výjimka je otevřený nález s doloženým důvodem. Přibyla-li nová, " +
        "patří k ní rozhodnutí, ne řádek v seznamu.",
    ).toEqual(["is_story_partner"]);
  });
  const sql = nactiBaseline();
  const granty = grantyFunkci(sql);
  const zname = definovaneFunkce(sql);
  const pol = politiky(sql, zname);

  test("sonda má co měřit — baseline obsahuje politiky i granty", () => {
    expect(sql.length, "baseline je prázdná").toBeGreaterThan(100_000);
    expect(granty.size, "žádné GRANT EXECUTE — brána by tvrdila prázdno").toBeGreaterThan(50);
    expect(zname.size, "žádná definovaná funkce — brána by tvrdila prázdno").toBeGreaterThan(200);
    // Pojistka proti návratu té slepoty: definic MUSÍ být víc než funkcí
    // s grantem, jinak se seznam zase odvozuje z oprávnění.
    expect(zname.size, "seznam funkcí se zřejmě odvozuje z grantů").toBeGreaterThan(granty.size);
    expect(pol.length, "žádné politiky — brána by tvrdila prázdno").toBeGreaterThan(200);
    const sFunkci = pol.filter((p) => p.funkce.size > 0).length;
    expect(sFunkci, "žádná politika nevolá známou funkci").toBeGreaterThan(50);
  });

  test("každá funkce v politice je pro dotčené role spustitelná", () => {
    const vady: string[] = [];
    for (const p of pol) {
      for (const fn of p.funkce) {
        if (CEKA_NA_ROZHODNUTI.has(fn)) continue;
        const povoleno = granty.get(fn) ?? new Set<string>();
        // `TO PUBLIC` u grantu = kdokoli
        if (povoleno.has("public")) continue;
        for (const role of p.role) {
          if (!VNEJSI_ROLE.includes(role as (typeof VNEJSI_ROLE)[number])) continue;
          if (povoleno.has(role)) continue;
          vady.push(
            `${p.tabulka} · politika "${p.jmeno.slice(0, 44)}" · role ${role} ` +
              `nesmí spustit public.${fn}() [má: ${[...povoleno].join(",") || "NIKDO"}]`,
          );
        }
      }
    }
    expect(
      [...new Set(vady)].sort(),
      "PostgreSQL vyhodnocuje VŠECHNY použitelné politiky. Chybějící EXECUTE " +
        "shodí CELÝ dotaz chybou „permission denied for function“ — i tam, kde " +
        "jiná politika data povoluje. Doplň GRANT EXECUTE v aisha/db/sql/functions/.",
    ).toEqual([]);
  });

  test("žádná funkce volaná politikou nezůstala úplně bez grantu", () => {
    // Zvláštní případ, na kterém to prasklo: REVOKE ALL … FROM PUBLIC a pak
    // už žádný GRANT. Funkce existuje, politika ji volá, spustit ji nesmí NIKDO.
    const bezGrantu = new Set<string>();
    for (const p of pol) {
      for (const fn of p.funkce) {
        if (CEKA_NA_ROZHODNUTI.has(fn)) continue;
        if ((granty.get(fn)?.size ?? 0) === 0) bezGrantu.add(fn);
      }
    }
    expect(
      [...bezGrantu].sort(),
      "Funkci volá RLS politika, ale nemá ani jeden GRANT EXECUTE — " +
        "nespustí ji ani service_role. Každý dotaz na dotčenou tabulku spadne.",
    ).toEqual([]);
  });
});

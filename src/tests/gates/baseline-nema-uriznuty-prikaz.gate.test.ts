import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findStatementEnd,
  splitSqlStatements,
} from "../../../scripts/db/generate-init-migration-from-sources.mjs";

/**
 * ⛔ NAMĚŘENO 2026-09-03 — proč tahle brána existuje.
 *
 * Generátor baseline hledal konec příkazu regexem `/CREATE\s+POLICY[\s\S]*?;/`,
 * tedy „k PRVNÍMU středníku". Policy `li_source_registry_read` má v těle český
 * komentář končící „…jsou přitom na dokladu;" — a přesně tam ji uřízl. Do
 * baseline prošlo 24 řádků z 92, včetně OTEVŘENÉ závorky `USING (`.
 *
 * Nic nezčervenalo: generátor doběhl, ohlásil `policies=839`, brány byly zelené.
 * Vada se projevila až pokusem o přehrání do skutečné databáze — a to hlášením
 * `syntax error at or near "DROP"` na POSLEDNÍM řádku souboru, o 9 000 řádků
 * dál, protože parser hlásí, kde mu došlo, ne kde je vada. Padly na tom tři
 * úlohy CI naráz (cold-start, kontrakt bloků, PostgREST integrace).
 *
 * Brána proto měří VLASTNOST VÝSTUPU, ne mechanismus: uříznutý příkaz má
 * nevyvážené závorky. Je jedno, co ho urízne — regex, špatný skener, cokoli
 * příštího. A ⭐ všimni si, že měří i sám sebe: kdyby byl skener rozbitý,
 * rozdělí soubor špatně a nevyváženost se ukáže.
 */

const REPO = resolve(__dirname, "../../..");

/**
 * ⭐ VLASTNÍ, NEZÁVISLÝ SKENER — schválně NE ten z generátoru.
 *
 * Naměřeno při dokazování téhle brány mutací: když si test skener IMPORTUJE
 * z generátoru, pak mutace generátoru zmutuje i měřidlo. Rozbitý generátor
 * uřízl 331 řádků a test na závorky přesto prošel — dělil týmž rozbitým
 * skenerem, takže „nevyváženost" nikde neuviděl. Brána nesmí sdílet přístroj
 * s tím, co měří. Tady je zdvojení tvrzení ZÁMĚR, ne kopie navíc.
 */
function rozdelPrikazy(sql: string): string[] {
  const out: string[] = [];
  let i = 0;
  let start = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let d = 1;
      i += 2;
      while (i < sql.length && d > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { d += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { d -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z_]\w*\$|^\$\$/);
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) break;
        i = close + tag.length;
        continue;
      }
    }
    if (ch === ";") {
      out.push(sql.slice(start, i + 1));
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start));
  return out;
}

/** Spočítá závorky mimo komentáře, řetězce a dolarové uvozovky. */
function parenBalance(sql: string): number {
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let d = 1;
      i += 2;
      while (i < sql.length && d > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { d += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { d -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z_]\w*\$|^\$\$/);
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) break;
        i = close + tag.length;
        continue;
      }
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    i += 1;
  }
  return depth;
}

describe("baseline nemá uříznutý příkaz", () => {
  it("skener nekončí příkaz na středníku v komentáři, řetězci ani dolarových uvozovkách", () => {
    // Přesně ten tvar, který vadu způsobil.
    const vKomentari = "CREATE POLICY p ON t USING (\n  -- pozor na dokladu;\n  a = 1\n);\nDROP POLICY q;";
    expect(vKomentari.slice(0, findStatementEnd(vKomentari, 0)).trim())
      .toBe("CREATE POLICY p ON t USING (\n  -- pozor na dokladu;\n  a = 1\n);");

    const vRetezci = "SELECT 'a;b';\nDROP TABLE t;";
    expect(vRetezci.slice(0, findStatementEnd(vRetezci, 0)).trim()).toBe("SELECT 'a;b';");

    const vDolarech = "DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;\nDROP TABLE t;";
    expect(vDolarech.slice(0, findStatementEnd(vDolarech, 0)).trim())
      .toBe("DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;");

    const vBloku = "CREATE POLICY p ON t USING (/* ; */ a = 1);\nDROP POLICY q;";
    expect(vBloku.slice(0, findStatementEnd(vBloku, 0)).trim())
      .toBe("CREATE POLICY p ON t USING (/* ; */ a = 1);");
  });

  it("rozdělení je bezeztrátové — spojením úseků vznikne původní text", () => {
    const sql = readFileSync(resolve(REPO, "aisha/db/migrations/00000000000000_baseline.sql"), "utf8");
    expect(splitSqlStatements(sql).map((c: { text: string }) => c.text).join("")).toBe(sql);
  });

  // ⭐ Detektor se musí sám prokázat. Naměřeno při mutačním důkazu: scan přes
  // baseline prošel i tehdy, když generátor uřízl 331 řádků — tvrzení, které
  // nikdy nespadne, dává jen falešný klid. Proto nejdřív ukážeme, že detektor
  // uříznutý příkaz POZNÁ, a teprve pak ho pouštíme na skutečný artefakt.
  it("detektor pozná uříznutý příkaz (na známém vzorku)", () => {
    const uriznute = [
      "CREATE POLICY p ON t",
      "  FOR SELECT TO authenticated",
      "  USING (",
      "    (SELECT public.is_admin_or_staff())",
      "    -- Materiál a množství jsou přitom na dokladu;",
    ].join("\n");
    expect(parenBalance(uriznute)).toBeGreaterThan(0);

    const cele = `${uriznute}\n  );`;
    expect(parenBalance(cele)).toBe(0);
  });

  it("žádný příkaz v baseline nemá nevyvážené závorky", () => {
    const sql = readFileSync(resolve(REPO, "aisha/db/migrations/00000000000000_baseline.sql"), "utf8");
    const rozbite: string[] = [];

    for (const raw of rozdelPrikazy(sql)) {
      const body = raw.trim();
      if (!body) continue;
      const d = parenBalance(body);
      if (d !== 0) {
        const prvni = (body.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) ?? body).slice(0, 110);
        rozbite.push(`${d > 0 ? "chybí" : "přebývá"} ${Math.abs(d)}× závorka: ${prvni}`);
      }
    }

    expect(
      rozbite,
      `Uříznutý příkaz v generovaném baseline — nevyvážené závorky.\n` +
        `Takhle vypadá policy, které generátor sebral tělo na středníku v komentáři.\n` +
        rozbite.slice(0, 5).join("\n"),
    ).toEqual([]);
  });
});

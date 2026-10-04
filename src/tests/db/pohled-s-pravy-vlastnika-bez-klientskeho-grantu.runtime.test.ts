/**
 * Pohled s právy vlastníka nesmí mít přímý grant klientské roli.
 *
 * Pohled bez `security_invoker` se čte (a u auto-updatable pohledu i zapisuje)
 * právy VLASTNÍKA — tedy mimo RLS podkladových tabulek. Přímý grant pro
 * `anon`/`authenticated` z něj proto dělá zadní vrátka kolem všech policies
 * i kolem stráží DEFINER funkcí, které ho mají číst za klienta.
 *
 * ⛔ NAMĚŘENO 2026-10-04 na čisté DB (baseline + heals): 21 takových pohledů
 * bylo čitelných klientskou rolí, 9 z nich i bez přihlášení. Měří se katalog
 * živé databáze, ne SoT soubory — granty přicházejí i z heals a z ALTER
 * DEFAULT PRIVILEGES, které statická brána nevidí.
 */
import { describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { fixtura } from "./sonda-identity";

/** Pohledy a mat. pohledy v public bez security_invoker, s právy rolí. */
function pohledySPravyVlastnika(): Array<{ jmeno: string; prava: string }> {
  const radky = fixtura(`
    SELECT c.relname || '|' || concat_ws(',',
             CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon:SELECT' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated:SELECT' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') THEN 'anon:DML' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') THEN 'authenticated:DML' END)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), 'false') <> 'true'
     ORDER BY c.relname`);
  return radky
    .split("\n")
    .filter(Boolean)
    .map((r) => {
      const [jmeno, prava = ""] = r.split("|");
      return { jmeno, prava };
    });
}

describe.skipIf(!isPgReachable())("pohled s právy vlastníka: bez přímého grantu klientům", () => {
  it("⛔ audience_admin_*_v klient přímo nečte (jen přes DEFINER blokové funkce)", () => {
    const audience = pohledySPravyVlastnika().filter((p) => /^audience_admin_[a-z0-9_]+_v$/.test(p.jmeno));
    expect(audience.length, "žádný audience_admin_*_v pohled — měřidlo měří nad ničím").toBeGreaterThan(10);

    const sKlientskymPravem = audience.filter((p) => p.prava !== "").map((p) => `${p.jmeno} (${p.prava})`);
    expect(sKlientskymPravem, "pohled s právy vlastníka má přímý grant klientské roli").toEqual([]);
  });
});

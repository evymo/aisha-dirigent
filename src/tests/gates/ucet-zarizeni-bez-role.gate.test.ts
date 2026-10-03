/**
 * Brána: účet zařízení (tablet, F2) nedostane roli a pozná se JEN podle strany serveru.
 *
 * ⛔ PROČ (2026-09-29, revize Aisha Guru): handle_new_user dával KAŽDÉMU novému účtu roli
 * `member`. Tablet není člověk — role by mu otevřela všechno, co vidí člen. Výjimka ale
 * nesmí stát na `raw_user_meta_data`: tu nastaví klient už při registraci, takže příznak
 * „jsem zařízení“ v metadatech by si mohl dát kdokoli (a buď ztratit `member`, nebo — kdyby
 * na něj slyšela i pátá cesta viditelnosti — získat pohled tabletu). Příznak proto nese
 * server: `knock_device_credentials.ucet_id`, kterou zapíše JEN definer při schválení
 * tabletu, a to DŘÍV, než uživatele vloží.
 *
 * Brána drží TVAR (chování ověřuje runtime test kiosk-f2a):
 *  1. handle_new_user se na účet zařízení ptá přes knock_device_credentials.ucet_id
 *     a `member` vkládá jen mimo účty zařízení;
 *  2. handle_new_user o zařízení NEROZHODUJE podle raw_user_meta_data;
 *  3. zaloz_ucet_zarizeni_interni nemá grant pro klienty a vazbu zapíše PŘED vložením uživatele;
 *  4. pátá cesta predikátu stojí PŘED twin větví (ta vrací výsledek hned);
 *  5. (F2-B/C) vydání relace a projekce jsou jen pro server; čtení JEDNOHO kroku předává
 *     predikátu kód kroku a účtu zařízení vydá jen projekci (kiosk_projekce), nikdy
 *     output_data (přebírající, podpis) ani název běhu (subject_label nese odběratele).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FN = join(process.cwd(), "aisha/db/sql/functions");
const bezKomentaru = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const cti = (f: string) => bezKomentaru(readFileSync(join(FN, f), "utf8"));
/**
 * Komu SoT soubor uděluje EXECUTE — čte se seznam za `TO`, ne celý příkaz: `PUBLIC` bez
 * rozlišení velikosti by se jinak chytil na `public.` ve jménu funkce (falešný nález).
 */
const grantovano = (sql: string): string[] =>
  [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[^;]*?\s+TO\s+([^;]+);/gi)]
    .flatMap((m) => m[1].split(",").map((x) => x.trim().toLowerCase()));
const KLIENTI = ["anon", "authenticated", "public"];

describe("účet zařízení: bez role, příznak na straně serveru", () => {
  const hnu = cti("handle_new_user.sql");

  it("handle_new_user vkládá `member` jen mimo účty zařízení (podle knock_device_credentials.ucet_id)", () => {
    const iPodminka = hnu.search(/IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.knock_device_credentials\s+\w+\s+WHERE\s+\w+\.ucet_id\s*=\s*NEW\.id\s*\)\s*THEN/i);
    const iMember = hnu.search(/'member'::app_role/);
    expect(iPodminka, "chybí podmínka na vazbu účtu zařízení").toBeGreaterThanOrEqual(0);
    expect(iMember, "member se vkládá mimo podmínku").toBeGreaterThan(iPodminka);
  });

  it("⛔ handle_new_user nerozhoduje o zařízení podle raw_user_meta_data", () => {
    expect(hnu).not.toMatch(/raw_user_meta_data\s*->>?\s*'(druh|zarizeni|device|kind|is_device)'/i);
  });

  it("zaloz_ucet_zarizeni_interni: žádný grant klientům a vazba PŘED vložením uživatele", () => {
    const z = cti("zaloz_ucet_zarizeni_interni.sql");
    expect(grantovano(z).filter((g) => KLIENTI.includes(g))).toEqual([]);
    const iVazba = z.search(/UPDATE\s+public\.knock_device_credentials\s+SET\s+ucet_id/i);
    const iUzivatel = z.search(/INSERT\s+INTO\s+aisha_auth\.users/i);
    expect(iVazba, "vazba ucet_id se nezapisuje").toBeGreaterThanOrEqual(0);
    expect(iUzivatel, "uživatel se nevkládá").toBeGreaterThan(iVazba);
  });

  it("pátá cesta predikátu (účet zařízení) stojí PŘED twin větví", () => {
    const p = cti("workflow_step_visible_to.sql");
    const iPata = p.search(/je_ucet_zarizeni_platny\(p_uid\)/);
    const iTwin = p.search(/p_input\s*\?\s*'authorized_twin_id'/);
    expect(iPata, "pátá cesta chybí").toBeGreaterThanOrEqual(0);
    expect(iPata, "pátá cesta za twin větví by se nikdy neuplatnila u kroků předání").toBeLessThan(iTwin);
    expect(p, "pátá cesta bez kódu kroku z řádku neplatí").toMatch(/p_step_code\s+IS\s+NOT\s+NULL\s+AND\s+public\.je_ucet_zarizeni_platny/i);
  });

  it.each(["kiosk_vydej_relaci.sql", "kiosk_projekce.sql"])("⛔ %s nemá grant klientům", (f) => {
    const g = grantovano(cti(f));
    expect(g, "měřidlo nic nenašlo — soubor bez GRANT by prošel naprázdno").toContain("service_role");
    expect(g.filter((x) => KLIENTI.includes(x))).toEqual([]);
  });

  it("detail kroku: predikát dostane kód kroku a tablet jen projekci", () => {
    const d = cti("get_workflow_step_detail.sql");
    const volani = d.match(/workflow_step_visible_to\([^;]*?\)/gs) ?? [];
    expect(volani.length, "detail volá predikát dvakrát (rozsah + is_mine)").toBe(2);
    for (const v of volani) expect(v, "volání predikátu bez kódu kroku").toMatch(/v_s\.step_code\s*\)$/);
    expect(d).toMatch(/WHEN\s+v_zarizeni\s+THEN\s+public\.kiosk_projekce\(v_s\.step_code,\s*v_s\.input_data\)/i);
    expect(d).toMatch(/WHEN\s+v_zarizeni\s+THEN\s+NULL\s+ELSE\s+v_s\.output_data/i);
    expect(d).toMatch(/WHEN\s+v_zarizeni\s+THEN\s+NULL\s+ELSE\s+v_b\.product_name/i);
    // Příznak účtu zařízení nese server (vazba průkazu), ne metadata účtu.
    expect(d).toMatch(/v_zarizeni\s*:=\s*EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.knock_device_credentials/i);
  });

  it("rozvozy tabletu berou řidiče i vozidlo z PROJEKCE, ne ze syrového input_data", () => {
    const r = cti("get_kiosk_rozvozy.sql");
    expect(r).toMatch(/public\.kiosk_projekce\(k\.step_code,\s*k\.input_data\)\s+AS\s+proj/i);
    expect(r).not.toMatch(/input_data->>'(driver_name|vehicle_registration)'/);
    expect(r).toMatch(/public\.workflow_step_visible_to\(v_me,[^)]*k\.step_code\)/);
  });
});

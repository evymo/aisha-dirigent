/**
 * Brána: dlaždice čísla (`get_audience_view_kpi_block`) měří to, co deklaruje —
 * a když měřit nemůže, řekne to místo aby vymyslela nulu.
 *
 * ⛔ PROČ VZNIKLA: čísla o komunitě šla spočítat i přinést zvenčí, ale na ploše
 * nebylo KUDY je ukázat — nad jedním číslem neměla žádná maska producenta.
 * Statistika, kterou nikdo nevidí, je stejně užitečná jako ta, co neexistuje.
 *
 * CO SE MĚŘÍ:
 *   1. agregace: `count` počítá řádky, `where_src/where_val` je zúží;
 *   2. `value: null` u KAŽDÉHO důvodu, proč se měřit nedá (bez práva, špatná
 *      konfigurace, cizí pohled, neexistující sloupec) — nula by tvrdila
 *      měření, které nikdo neprovedl;
 *   3. jmenný prostor: pohled mimo `audience_admin_*_v` se nepustí, i kdyby
 *      existoval — jinak by dlaždice byla druhá cesta, jak číst cizí tabulku;
 *   4. neznámá agregace i stav DEGRADUJÍ na výchozí, ne na pád: nová deklarace
 *      nesmí shodit starší databázi.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const ADMIN = "d1000000-1111-4000-8000-00000000ad01";
const PLAIN = "d1000000-2222-4000-8000-00000000pl01".replace("pl01", "b101");

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${ADMIN}', 'kpi-admin@test.local'), ('${PLAIN}', 'kpi-plain@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES
  ('${ADMIN}', 'kpi-admin@test.local'), ('${PLAIN}', 'kpi-plain@test.local')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;
`;

const asUser = (sub: string) => `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;

const kpi = (params: string) =>
  `public.get_audience_view_kpi_block('${params}'::jsonb)`;

describe("dlaždice čísla: měří deklaraci, jinak řekne NEMĚŘENO", () => {
  beforeAll(() => reportTestCapabilities("kpi block contract"));

  it.skipIf(!dbAvailable)("počítá, filtruje, a neznámou agregaci degraduje místo pádu", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'vse=' || (${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id"}')}->'data'->>'value') AS out;
-- filtr zúží tutéž dlaždici; kdyby ho funkce ignorovala, čísla by se rovnala
SELECT 'filtr=' || coalesce((${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id","where_src":"twin_status","where_val":"zadny-takovy-stav"}')}->'data'->>'value'), 'NULL') AS out;
-- neznámá agregace i stav = výchozí, ne pád (nová deklarace nesmí shodit starou DB)
SELECT 'degradace=' || (${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id","agg":"neznama","state":"neznamy"}')}->'data'->>'value')
    || '/' || (${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id","agg":"neznama","state":"neznamy"}')}->'data'->>'state') AS out;
ROLLBACK;
`);
    // měřidlo má co měřit: bez řádků by prošlo i chování, které nic nepočítá
    const vse = Number(/vse=(\d+)/.exec(out)?.[1] ?? "0");
    expect(vse, "fixtura nevyrobila žádné dvojče — test by neměl co měřit").toBeGreaterThan(0);
    expect(out, "filtr na neexistující stav musí dát 0, ne celkový počet").toContain("filtr=0");
    expect(out).toContain(`degradace=${vse}/ok`);
  });

  it.skipIf(!dbAvailable)("NEMĚŘENO místo vymyšlené nuly: bez práva, cizí pohled, špatný sloupec", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(PLAIN)}
SELECT 'bez_prava=' || coalesce((${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"view":"audience_admin_twin_directory_v","value_src":"twin_id"}')}->'provenance'->>'trace_id') AS out;
RESET ROLE;
${asUser(ADMIN)}
SELECT 'cizi_pohled=' || coalesce((${kpi('{"view":"pg_class","value_src":"oid"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"view":"pg_class","value_src":"oid"}')}->'provenance'->>'trace_id') AS out;
SELECT 'spatny_sloupec=' || coalesce((${kpi('{"view":"audience_admin_twin_directory_v","value_src":"neexistuje"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"view":"audience_admin_twin_directory_v","value_src":"neexistuje"}')}->'provenance'->>'trace_id') AS out;
ROLLBACK;
`);
    expect(out, "bez práva NESMÍ vrátit 0 — to by tvrdilo měření").toContain("bez_prava=NULL/audience-kpi:unauthorized");
    expect(out, "pohled mimo jmenný prostor se nepustí, i když existuje").toContain("cizi_pohled=NULL/audience-kpi:missing_config");
    expect(out).toContain("spatny_sloupec=NULL/audience-kpi:bad_config");
  });
});

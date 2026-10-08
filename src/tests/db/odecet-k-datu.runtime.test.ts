/**
 * Odečet měřidla je HODNOTA K DATU; roli (konec období, předání…) odvozuje ten, kdo se ptá,
 * podle PRAVIDLA, které je data — nad SKUTEČNOU DB (G3, majitel 2026-10-04).
 *
 * Do 2026-10-04 bilance četla jen odečty s nálepkou `period`/`kind` (import sešitu); terénní
 * odečet ji nenese, takže do bilance nikdy nevstoupil. Teď se stav k hranici odvodí z odečtů
 * k datu (meter_usage_between): přesný odečet má přednost, jinak pravidlo
 * 'linearne' (výchozí) | 'posledni_pred' | 'presny'; mimo rozsah se neextrapoluje; výměna
 * měřidla (kind 'pocatek' uprostřed řady) není spotřeba.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const ZDROJ = `test-k-datu-${RUN}`;
const SLUZBA = `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n`;

function sql(q: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${q};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}
const jako = (uid: string, q: string) =>
  sql(`\\o /dev/null
SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: uid })}';
SET ROLE authenticated;
\\o
${q}`);

let U = "";
/** Měřidlo s odečty [datum ISO UTC, hodnota, druh?]. Vrací id. */
function meridlo(odecty: Array<[string, number, string?]>): string {
  const id = randomUUID();
  const radky = odecty
    .map(([kdy, v, druh], i) =>
      `('meter_reading', '${id}', '${kdy}', jsonb_build_object('value', ${v}, 'unit', 'kWh'${druh ? `, 'kind', '${druh}'` : ""}), '${ZDROJ}', '${ZDROJ}:${id}:${i}')`)
    .join(", ");
  sql(`${SLUZBA}insert into public.twin_entities (id, entity_type, label, metadata) values ('${id}', 'meter', 'M-${RUN}', '{}');
       insert into public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) values ${radky}`);
  return id;
}
const pouziti = (id: string, od: string, do_: string, pravidlo: string) =>
  JSON.parse(jako(U, `select public.meter_usage_between('${id}', '${od}', '${do_}', '${pravidlo}')::text`)) as {
    spotreba: number | null; odhad: boolean; chybi: boolean;
  };

beforeAll(() => {
  if (!dbAvailable) return;
  U = randomUUID();
  sql(`SET session_replication_role = replica;
       insert into aisha_auth.users (id) values ('${U}');
       insert into public.user_roles (user_id, role) values ('${U}', 'admin');
       SET session_replication_role = origin`);
});

describe("odečet k datu — pravidla odvození stavu (DB naostro)", () => {
  it.skipIf(!dbAvailable)("přesný odečet k okamžiku má přednost u každého pravidla — a není to odhad", () => {
    const m = meridlo([["2026-01-01T00:00:00Z", 100], ["2026-01-21T00:00:00Z", 120], ["2026-02-10T00:00:00Z", 160]]);
    for (const p of ["presny", "posledni_pred", "linearne"]) {
      expect(pouziti(m, "2026-01-01T00:00:00Z", "2026-01-21T00:00:00Z", p), p).toMatchObject({ spotreba: 20, odhad: false, chybi: false });
    }
  });

  it.skipIf(!dbAvailable)("bez odečtu k hranici: 'linearne' poměrem času, 'posledni_pred' starší stav, 'presny' chybí", () => {
    const m = meridlo([["2026-01-01T00:00:00Z", 100], ["2026-01-21T00:00:00Z", 120], ["2026-02-10T00:00:00Z", 160]]);
    // 1. 2. leží 11 dní za 21. 1. z 20 dní do 10. 2.: 20 + 40 × 11/20 = 42
    expect(pouziti(m, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: 42, odhad: true, chybi: false });
    expect(pouziti(m, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "posledni_pred")).toMatchObject({ spotreba: 20, odhad: true });
    expect(pouziti(m, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "presny")).toMatchObject({ spotreba: null, chybi: true });
  });

  it.skipIf(!dbAvailable)("⛔ mimo rozsah odečtů se NEEXTRAPOLUJE — chybí, nikdy vymyšlené číslo", () => {
    const m = meridlo([["2026-01-01T00:00:00Z", 100], ["2026-02-01T00:00:00Z", 130]]);
    expect(pouziti(m, "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: null, chybi: true });
    expect(pouziti(m, "2025-12-01T00:00:00Z", "2026-02-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: null, chybi: true });
  });

  it.skipIf(!dbAvailable)("výměna měřidla: skok přes nový počátek NENÍ spotřeba; přes výměnu bez konce starého se neinterpoluje", () => {
    // Konec starého (80) a počátek nového (0) v témž okamžiku: 30 + 30 = 60.
    const n = meridlo([["2026-01-01T00:00:00Z", 50], ["2026-02-01T00:00:00Z", 80, "konec"], ["2026-02-01T00:00:00Z", 0, "pocatek"], ["2026-03-01T00:00:00Z", 30]]);
    expect(pouziti(n, "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: 60, odhad: false });
    // Nový počátek bez stavu starého k výměně: stav mezi 1. 1. a výměnou nejde odvodit.
    const q = meridlo([["2026-01-01T00:00:00Z", 50], ["2026-02-15T00:00:00Z", 0, "pocatek"], ["2026-03-01T00:00:00Z", 10]]);
    expect(pouziti(q, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: null, chybi: true });
    expect(pouziti(q, "2026-02-15T00:00:00Z", "2026-03-01T00:00:00Z", "linearne")).toMatchObject({ spotreba: 10, odhad: false });
  });

  it.skipIf(!dbAvailable)("neznámé pravidlo = chyba nahlas", () => {
    const m = meridlo([["2026-01-01T00:00:00Z", 1]]);
    expect(() => pouziti(m, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "prumer")).toThrow(/neznámé pravidlo/);
  });
});

describe("bilance z odečtů k datu — terénní odečet bez nálepky období (G3)", () => {
  it.skipIf(!dbAvailable)("⛔ terénní odečet uprostřed měsíce vstoupí do bilance jako ODHAD; pravidlo je data", () => {
    // Hlavní H naměřilo za únor 30; podružné P: 1. 2. = 100 (přesně), terénní 20. 2. = 120, 10. 3. = 138.
    // Stav k 1. 3. lineárně: 120 + 18 × 9/18 = 129 → únor 29 (odhad), rozdíl 1.
    const P = meridlo([["2026-02-01T00:00:00Z", 100], ["2026-02-20T00:00:00Z", 120], ["2026-03-10T00:00:00Z", 138]]);
    const H = randomUUID();
    sql(`${SLUZBA}insert into public.twin_entities (id, entity_type, label, metadata) values ('${H}', 'meter', 'H-${RUN}', '{}');
         insert into public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from)
           values ('${P}', '${H}', 'submeter_of', '2026-01-01T00:00:00Z');
         insert into public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) values
           ('meter_consumption', '${H}', '2026-03-01T00:00:00Z', jsonb_build_object('period', '2026-02', 'value', 30, 'unit', 'kWh'), '${ZDROJ}', '${ZDROJ}:H:2026-02')`);
    const blok = (extra: string) =>
      JSON.parse(jako(U, `select public.get_meter_balance_block('{"twin_id":"${H}","relation_kind":"submeter_of","consumption_event":"meter_consumption"${extra}}'::jsonb)::text`)) as {
        data: { rows: Record<string, unknown>[] }; provenance: { trace_id: string };
      };
    const unor = (b: ReturnType<typeof blok>) => b.data.rows.find((x) => x.obdobi === "2026-02");

    expect(unor(blok(""))).toMatchObject({ hlavni: 30, podruzne: 29, rozdil: 1, chybi: 0, odhad: 1, stav: "app.meters.balance.state.estimated" });
    expect(unor(blok(`,"reading_rule":"presny"`))).toMatchObject({ chybi: 1, odhad: 0, stav: "app.meters.balance.state.missing_readings" });
    expect(unor(blok(`,"reading_rule":"posledni_pred"`))).toMatchObject({ podruzne: 20, odhad: 1 });
    // Pravidlo nebo pásmo v datech, které nejde použít = vadná konfigurace, ne tichý výchozí.
    expect(blok(`,"reading_rule":"prumer"`).provenance.trace_id).toBe("meter-balance:bad_config");
    expect(blok(`,"tz":"Mars/Olympus"`).provenance.trace_id).toBe("meter-balance:bad_config");
  });
});

/**
 * Fronta předání čte ŽIVÝ STAV ZE ZDROJE, ne zmrazenou kopii.
 *
 * ⛔ PROČ TENHLE TEST EXISTUJE (naměřeno na produkci)
 * ---------------------------------------------------
 * `settled` se do `input_data` kroku zkopírovalo při zakládání běhu a obnova
 * předmětu v `ensure_workflow_run_for_subject` slévá `p_subject || input_data`,
 * kde vyhrává PRAVÁ strana — umí tedy klíč DOPLNIT, ne ZMĚNIT. Doklad vyřízený
 * až po založení běhu proto v kopii zůstal „nevyřízený" napořád:
 *   · 2026-08-31 — ze 40 863 „pending" předání mělo 20 070 doklad settled=True,
 *     skutečně otevřených bylo 522;
 *   · 2026-09-01 — ze 400 otevřených jich fronta ukazovala 196 a o 204 mlčela,
 *     protože `input_match` je OBSAŽENÍ a řádek bez klíče nevyhoví nikdy.
 * Dispečink tak nabízel práci uzavřenou v účetnictví a první stránka byly
 * doklady z roku 2020.
 *
 * Pinuje se CHOVÁNÍ, ne pravopis: co se z fronty ztratí, co v ní zůstane a
 * proč — včetně toho, že se nesmí ztratit nic, o čem zdroj MLČÍ.
 *
 * ⭐ IDENTITA VE ZDROJI JE PARAMETR (`source_state.stable_key`, 2026-09-26).
 * Fixtury ji záměrně nesou pod NEUTRÁLNÍM jménem `zdroj_id`: kdyby funkce
 * znala jméno pole konkrétní instance natvrdo, tyhle testy by neprošly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

function psql(claims: string | null, sql: string): string {
  const pre = claims === null ? "" : `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n`;
  return execFileSync(
    "psql",
    // `-q`: bez něj psql za výsledek `INSERT … RETURNING id` připíše značku
    // příkazu („INSERT 0 1“) a ta se stane součástí vráceného id.
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { encoding: "utf8", input: `${pre}${sql};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

const RUN = randomUUID().slice(0, 8);
const RIDIC = randomUUID();
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
const jako = (sql: string) => psql(`{"role":"authenticated","sub":"${RIDIC}"}`, sql);

/** Konfigurace bloku — TÁŽ, jakou nese instanční overlay pro dispečerskou frontu. */
const PARAMS = JSON.stringify({
  step_code: "predani",
  source_state: { field: "settled", closed_when: "True", stable_key: "zdroj_id", label_key: "app.wf.source.settled" },
  limit: 200,
  title_src: "input:counterparty",
});

function fronta(extra: Record<string, unknown> = {}): string[] {
  const params = JSON.stringify({ ...JSON.parse(PARAMS), ...extra });
  const out = jako(
    `select coalesce(string_agg(i->>'title', ',' order by i->>'title'), '')
       from jsonb_array_elements(
         public.get_workflow_my_steps_block('${params}'::jsonb) -> 'data' -> 'items') i`,
  );
  return out === "" ? [] : out.split(",");
}

beforeAll(async () => {
  await reportTestCapabilities("fronta-predani-zdroj");
  if (!dbAvailable) return;

  // Registr: pět dokladů, čtyři situace. `doc-D` je STARÁ verze (superseded),
  // platná `doc-D2` nese totéž `zdroj_id` a říká „vyřízeno" — tím se ověřuje,
  // že se laterál dostane na aktuální verzi i tehdy, když ukazatel míří na
  // překonanou (registr je content-addressed, změna dokladu = nový doc_slug).
  // `E` je případ dedupu: stará generace v registru NENÍ VŮBEC (odstranil ji
  // `li_dedupe_source_registry`), platná `doc-E2` nese totéž `zdroj_id`.
  svc(`insert into public.li_source_registry (source_sha256, doc_slug, doc_type, status, fields)
       values ('sha-A-${RUN}', 'doc-A-${RUN}', 'delivery_note', 'AUTO_PASS',
               '{"settled":{"value":"True"},"zdroj_id":{"value":"ZID-A-${RUN}"}}'::jsonb),
              ('sha-B-${RUN}', 'doc-B-${RUN}', 'delivery_note', 'AUTO_PASS',
               '{"settled":{"value":"False"},"zdroj_id":{"value":"ZID-B-${RUN}"}}'::jsonb),
              ('sha-D2-${RUN}', 'doc-D2-${RUN}', 'delivery_note', 'AUTO_PASS',
               '{"settled":{"value":"True"},"zdroj_id":{"value":"ZID-D-${RUN}"}}'::jsonb),
              ('sha-E2-${RUN}', 'doc-E2-${RUN}', 'delivery_note', 'AUTO_PASS',
               '{"settled":{"value":"True"},"zdroj_id":{"value":"ZID-E-${RUN}"}}'::jsonb)`);
  svc(`insert into public.li_source_registry
         (source_sha256, doc_slug, doc_type, status, fields, superseded_by)
       values ('sha-D-${RUN}', 'doc-D-${RUN}', 'delivery_note', 'AUTO_PASS',
               '{"settled":{"value":"False"},"zdroj_id":{"value":"ZID-D-${RUN}"}}'::jsonb,
               'doc-D2-${RUN}')`);

  for (const [znacka, subject] of [
    ["A", `{"settled":"False","doc_slug":"doc-A-${RUN}","zdroj_id":"ZID-A-${RUN}","counterparty":"A-${RUN}"}`],
    ["B", `{"settled":"False","doc_slug":"doc-B-${RUN}","zdroj_id":"ZID-B-${RUN}","counterparty":"B-${RUN}"}`],
    ["C", `{"settled":"False","counterparty":"C-${RUN}"}`],
    ["D", `{"settled":"False","doc_slug":"doc-D-${RUN}","zdroj_id":"ZID-D-${RUN}","counterparty":"D-${RUN}"}`],
    ["E", `{"settled":"False","doc_slug":"doc-E-${RUN}","zdroj_id":"ZID-E-${RUN}","counterparty":"E-${RUN}"}`],
  ] as const) {
    const batch = svc(
      `insert into public.production_batches (batch_code, product_name, production_date)
       values ('expedice:${znacka}-${RUN}', 'Test ${znacka}', current_date) returning id`,
    );
    svc(`insert into public.production_workflow_steps
           (batch_id, step_name, step_order, step_code, status, assigned_user_id, input_data)
         values ('${batch}', 'Předání', 1, 'predani', 'pending', '${RIDIC}', '${subject}'::jsonb)`);
  }
});

describe("get_workflow_my_steps_block × source_state", () => {
  it.skipIf(!dbAvailable)("doklad vyřízený U ZDROJE z fronty odejde, i když kopie tvrdí opak", () => {
    const tituly = fronta();
    // Všechny čtyři kroky mají v `input_data` settled="False" — kdyby se fronta
    // ptala kopie (dřívější `input_match`), byly by tu všechny čtyři.
    expect(tituly).not.toContain(`A-${RUN}`);
    expect(tituly).toContain(`B-${RUN}`);
  });

  it.skipIf(!dbAvailable)("ukazatel na PŘEKONANOU verzi dohledá platnou přes stable_key", () => {
    // Bez druhého dotazu přes identitu by join na `doc_slug` + superseded_by is
    // null nenašel nic a řádek by ve frontě zůstal — a to právě u dokladu, který
    // se změnil, tedy v jediném případě, kvůli kterému se registr čte.
    expect(fronta()).not.toContain(`D-${RUN}`);
  });

  it.skipIf(!dbAvailable)("ukazatel do PRÁZDNA (stará generace odstraněná dedupem) dohledá platnou přes stable_key", () => {
    expect(fronta()).not.toContain(`E-${RUN}`);
  });

  it.skipIf(!dbAvailable)("bez stable_key se identita NEhledá — změněný doklad zůstává (poctivé „nevím“)", () => {
    // Identita je DATA instance. Kdo ji nedeklaruje, dostane jen ukazatel —
    // a fail-open pravidlo: co zdroj přes ukazatel neřekl, z fronty neodejde.
    const src = { field: "settled", closed_when: "True", label_key: "app.wf.source.settled" };
    const tituly = fronta({ source_state: src });
    expect(tituly).not.toContain(`A-${RUN}`); // ukazatel sedí → vyřízeno ze zdroje
    expect(tituly).toContain(`D-${RUN}`);
    expect(tituly).toContain(`E-${RUN}`);
  });

  it.skipIf(!dbAvailable)("stable_key, který běh NENESE, nic nevyřadí", () => {
    const src = { field: "settled", closed_when: "True", stable_key: "jine_pole", label_key: "app.wf.source.settled" };
    const tituly = fronta({ source_state: src });
    expect(tituly).toContain(`D-${RUN}`);
    expect(tituly).toContain(`E-${RUN}`);
  });

  it.skipIf(!dbAvailable)("běh BEZ ukazatele zůstává — chybějící údaj není tvrzení o opaku", () => {
    // Starší generace běhů (klíčovaná číslem dokladu) ukazatel nemá. Kdyby je
    // fronta zahodila, ztratila by práci, o které zdroj nic neřekl.
    expect(fronta()).toContain(`C-${RUN}`);
  });

  it.skipIf(!dbAvailable)("include_source_closed vrátí zavřené zpět (back-office pohled)", () => {
    const vse = fronta({ include_source_closed: true });
    expect(vse).toContain(`A-${RUN}`);
    expect(vse).toContain(`D-${RUN}`);
  });

  it.skipIf(!dbAvailable)("zavřená položka nese anotaci zdroje, otevřená ne", () => {
    const params = JSON.stringify({ ...JSON.parse(PARAMS), include_source_closed: true });
    const anotace = jako(
      `select coalesce(string_agg((i->>'title') || '=' ||
                coalesce(i->'source_state'->>'label_key', '-'), ',' order by i->>'title'), '')
         from jsonb_array_elements(
           public.get_workflow_my_steps_block('${params}'::jsonb) -> 'data' -> 'items') i`,
    );
    expect(anotace).toContain(`A-${RUN}=app.wf.source.settled`);
    // Otevřená práce anotaci nenese — u ní je to šum, ne informace.
    expect(anotace).toContain(`B-${RUN}=-`);
  });

  it.skipIf(!dbAvailable)("bez source_state se blok chová PŘESNĚ jako dřív (zpětná kompatibilita)", () => {
    // Nasazení funkce samo o sobě nesmí změnit nic: chování mění až ten řádek
    // v instančních datech. Blok se starou konfigurací vidí všech pět.
    const stare = JSON.stringify({
      step_code: "predani", input_match: { settled: "False" }, limit: 200, title_src: "input:counterparty",
    });
    const out = jako(
      `select count(*) from jsonb_array_elements(
         public.get_workflow_my_steps_block('${stare}'::jsonb) -> 'data' -> 'items') i
        where i->>'title' like '%-${RUN}'`,
    );
    expect(Number(out)).toBe(5);
  });

  it.skipIf(!dbAvailable)("provenance přizná, že se filtrovalo živým stavem", () => {
    const trace = jako(
      `select public.get_workflow_my_steps_block('${PARAMS}'::jsonb) -> 'provenance' ->> 'trace_id'`,
    );
    expect(trace).toContain(":src-state");
  });
});

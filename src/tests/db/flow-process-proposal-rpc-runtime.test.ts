/**
 * propose_production_workflow_template — mapa toku se váže do NÁVRHU PROCESU.
 *
 * Uzel bez hran je bod bez toho, co mezi ním teče. `propose_production_flow_node`
 * uzavřel jen třetinu rodiny `flow_map_proposal`: z běhu nad 36 724 jízdami
 * dorazilo 435 uzlů, ale 1 665 hran a 141 podpisů pohybu nemělo konzumenta.
 * Vlastní tabulku pro ně stavět nelze ani nemá smysl — `production_flow_records`
 * je pohyb LÁTKY (volume_l/concentration_pct NOT NULL) a doplnit je by znamenalo
 * vymyslet si měření. Hrana proto patří DOVNITŘ návrhu procesu.
 *
 * Test drží vlastnosti, které rozhodují, ne pravopis:
 *   1. návrh NIKDY neaktivuje proces ani ho nedělá výchozím,
 *   2. hrany i role strojů opravdu dojedou (jinak je to zase jen seznam stanic),
 *   3. ratifikovaný proces je nedotknutelný — může podle něj právě běžet provoz,
 *   4. ruční práce (neaktivní šablona bez proposal) se nepřepisuje,
 *   5. čerstvější měření přidá VERZI, ne duplicitní šablonu,
 *   6. prázdná mapa se odmítne — šablona bez kroků vypadá jako hotová práce.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const KEY = `test-${RUN}:place_from>place_to`;
const NAME = `Ingest: ${KEY}`;

function svc(sql: string): string {
  const wrapped = `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n${sql};`;
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: wrapped, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

const STEPS = `'[{"step_code":"ZULOVA","step_name":"ŽULOVÁ","step_order":1},
                 {"step_code":"MIKULOVICE","step_name":"MIKULOVICE","step_order":2}]'::jsonb`;
const EDGES = `'[{"from":"MIKULOVICE","to":"ŽULOVÁ","observations":568}]'::jsonb`;
const MOVERS = `'[{"parameter":"machine_id","value":"231632","signature":"rover","observations":7398}]'::jsonb`;

function propose(key = KEY, steps = STEPS, edges = EDGES, movers = MOVERS): Record<string, unknown> {
  return JSON.parse(
    svc(`SELECT public.propose_production_workflow_template('${key}', ${steps}, ${edges}, ${movers}, '{}'::jsonb)`),
  );
}

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_workflow_templates WHERE name LIKE 'Ingest: test-${RUN}%'`);
});

describe("propose_production_workflow_template", () => {
  beforeAll(() => {
    if (dbAvailable) svc(`DELETE FROM public.production_workflow_templates WHERE name = '${NAME}'`);
  });

  it.skipIf(!dbAvailable)("prázdná mapa se odmítne — šablona bez kroků lže o hotové práci", () => {
    const out = propose(`test-${RUN}-empty:x`, `'[]'::jsonb`);
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("non-empty");
  });

  it.skipIf(!dbAvailable)("návrh nikdy neaktivuje proces ani ho nedělá výchozím", () => {
    expect(propose().created).toBe(true);
    // boolean::text je 'false'/'true' — 'f'/'t' je jen zobrazení psql, ne hodnota.
    const row = svc(
      `SELECT is_active::text || '|' || coalesce(is_default::text,'null') FROM public.production_workflow_templates WHERE name = '${NAME}'`,
    );
    expect(row).toBe("false|false");
  });

  it.skipIf(!dbAvailable)("hrany i role strojů dojedou — jinak je to jen seznam stanic", () => {
    const data = JSON.parse(
      svc(`SELECT workflow_data FROM public.production_workflow_templates WHERE name = '${NAME}'`),
    );
    expect(data.transitions).toHaveLength(1);
    expect(data.transitions[0].from).toBe("MIKULOVICE");
    expect(data.transitions[0].observations).toBe(568);
    expect(data.movers[0].signature).toBe("rover");
    expect(data.proposal.proposed_by).toBe("ingest/flow_map");
    const steps = JSON.parse(
      svc(`SELECT steps FROM public.production_workflow_templates WHERE name = '${NAME}'`),
    );
    expect(steps).toHaveLength(2);
  });

  it.skipIf(!dbAvailable)("čerstvější měření přidá VERZI, ne druhou šablonu", () => {
    const out = propose();
    expect(out.refreshed).toBe(true);
    expect(Number(out.version)).toBeGreaterThan(1);
    expect(svc(`SELECT count(*) FROM public.production_workflow_templates WHERE name = '${NAME}'`)).toBe("1");
    const versions = svc(
      `SELECT count(*) FROM public.production_workflow_template_versions v
         JOIN public.production_workflow_templates t ON t.id = v.template_id WHERE t.name = '${NAME}'`,
    );
    expect(Number(versions)).toBeGreaterThanOrEqual(2);
  });

  it.skipIf(!dbAvailable)("ratifikovaný proces je nedotknutelný — může podle něj běžet provoz", () => {
    svc(`UPDATE public.production_workflow_templates SET is_active = true WHERE name = '${NAME}'`);
    const before = svc(`SELECT steps::text FROM public.production_workflow_templates WHERE name = '${NAME}'`);
    const out = propose(KEY, `'[{"step_code":"JINY","step_name":"Jiný","step_order":1}]'::jsonb`);
    expect(out.already_active).toBe(true);
    expect(svc(`SELECT steps::text FROM public.production_workflow_templates WHERE name = '${NAME}'`)).toBe(before);
    svc(`UPDATE public.production_workflow_templates SET is_active = false WHERE name = '${NAME}'`);
  });

  it.skipIf(!dbAvailable)("ruční šablona se nepřepisuje — návrh nesmí sníst lidskou práci", () => {
    const key = `test-${RUN}-hand:place_from>place_to`;
    svc(`INSERT INTO public.production_workflow_templates (name, steps, is_active)
         VALUES ('Ingest: ${key}', '[{"step_code":"RUCNI"}]'::jsonb, false)`);
    const out = propose(key);
    expect(out.exists_unmanaged).toBe(true);
    expect(
      svc(`SELECT steps::text FROM public.production_workflow_templates WHERE name = 'Ingest: ${key}'`),
    ).toContain("RUCNI");
  });
});

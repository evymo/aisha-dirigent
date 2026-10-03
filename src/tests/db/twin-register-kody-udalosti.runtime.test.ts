/**
 * REGISTR TWINŮ: kódy událostí se z katalogu čtou JEDNOU (kody_udalosti), ne po událostech.
 *
 * ⛔ NAMĚŘENO 2026-09-30 na produkci forku (generický plán, jen čtení, md5 shodné):
 * latest_cv vylučovalo kódy vedené v atributu události korelovaným
 * `not exists (select 1 from twin_parameter_definitions dd where dd.code = e.attrs->>'code' …)`.
 * Planner to provedl jako Nested Loop Anti Join a katalog (pod RLS) prošel pro KAŽDOU
 * událost: 581 × ~1,1 ms = 646 ms — i u domén, které žádný takový kód nemají
 * (registr jednotek 0,8 s → 0,17 s). Množina kódů jako MATERIALIZED CTE se čte jednou.
 *
 * CO SE MĚŘÍ:
 *   1. Význam: kód s `event_type` v katalogu se NEčte z {code,value} (zbloudilá hodnota
 *      zmizí), ale švem z atributu události (poslední jízda); ostatní kódy beze změny.
 *   2. Tvar plánu: v generickém plánu těla funkce se sken twin_parameter_definitions
 *      provede nejvýš jednou (Actual Loops ≤ 1); stará korelovaná podoba (mutace) víckrát.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { psqlQuery } from "./validation-utils";
import {
  PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable, reportTestCapabilities,
} from "./test-env-probe";

const dbAvailable = isPgReachable();
const P = `ku${randomUUID().slice(0, 6)}`;
const OP = randomUUID();

/** psql s velkým bufferem (EXPLAIN JSON s politikami RLS má stovky kB), bez hlaviček, s ON_ERROR_STOP. */
function psqlVelky(sql: string): string {
  const soubor = join(tmpdir(), `kody-udalosti-${process.pid}-${randomUUID()}.sql`);
  writeFileSync(soubor, sql);
  try {
    return execFileSync(
      "psql",
      ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-f", soubor],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60000, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
    );
  } finally {
    unlinkSync(soubor);
  }
}

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', '${P}-op@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, metadata) VALUES
  ('${P}_plate', 'Značka', '${P}_vuz', 'text',    NULL, 'test', '{"shape":"code_value"}'::jsonb),
  ('${P}_odo',   'Stav',   '${P}_vuz', 'decimal', 'km', 'test', '{"event_type":"${P}_jizda","attr":"km"}'::jsonb);
DO $$
DECLARE t1 uuid; t2 uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_vuz', 'V1') RETURNING id INTO t1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_vuz', 'V2') RETURNING id INTO t2;
  INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
    ('param',       t1, now() - interval '3 days', '{"code":"${P}_plate","value":"1A0"}', 'test'),
    ('param',       t1, now() - interval '1 day',  '{"code":"${P}_plate","value":"1A1"}', 'test'),
    -- zbloudilá hodnota kódu, který katalog vede v atributu události: registr ji NESMÍ vzít
    ('param',       t1, now(),                     '{"code":"${P}_odo","value":"999"}', 'test'),
    ('${P}_jizda',  t1, now() - interval '1 day',  '{"km":100}', 'test'),
    ('${P}_jizda',  t1, now() - interval '1 hour', '{"km":150}', 'test'),
    ('param',       t2, now() - interval '2 days', '{"code":"${P}_plate","value":"2B1"}', 'test'),
    ('param',       t2, now(),                     '{"code":"${P}_plate","value":"2B2"}', 'test');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true) IS NOT NULL AS ok;
`;

const PARAMS = `'{"entity_type":"${P}_vuz"}'::jsonb`;

/** Stará (korelovaná) podoba vyřazení — mutace pro důkaz, že měření rozliší. */
function mutace(telo: string): string {
  return telo
    .replace(/\bkody_udalosti as materialized \([^)]*\),/, "")
    .replace(
      /not exists \(select 1 from kody_udalosti k where k\.code = e\.attrs->>'code'\)/,
      "not exists (select 1 from public.twin_parameter_definitions dd where dd.code = e.attrs->>'code' and dd.metadata ? 'event_type')",
    );
}

/** Největší Actual Loops u skenů twin_parameter_definitions v plánu. */
function smycekKatalogu(plan: unknown): number {
  let max = 0;
  const projdi = (n: Record<string, unknown>) => {
    if (n["Relation Name"] === "twin_parameter_definitions") max = Math.max(max, Number(n["Actual Loops"] ?? 0));
    for (const p of (n["Plans"] as Record<string, unknown>[] | undefined) ?? []) projdi(p);
  };
  projdi((plan as Array<{ Plan: Record<string, unknown> }>)[0]!.Plan);
  return max;
}

describe("registr twinů: kódy událostí z katalogu jednou", () => {
  beforeAll(() => reportTestCapabilities("registr twinů — kódy událostí"));

  it.skipIf(!dbAvailable)("kód události se čte švem, ne z {code,value}; ostatní kódy beze změny", () => {
    const out = psqlVelky(`
BEGIN;
${FIXTURE}
SELECT 'radky=' || (SELECT string_agg(r->>'label' || ':' || coalesce(r->>'${P}_plate','-') || ':' || coalesce(r->>'${P}_odo','-'), ',' ORDER BY r->>'label')
                     FROM jsonb_array_elements(public.get_twin_register(${PARAMS})->'data'->'rows') r);
RESET ROLE;
ROLLBACK;
`);
    expect(out, "V1: poslední značka + poslední jízda (ne zbloudilých 999); V2 jen značka").toContain("radky=V1:1A1:150,V2:2B2:-\n");
  });

  it.skipIf(!dbAvailable)("katalog se v plánu prochází nejvýš jednou; stará korelovaná podoba víckrát", () => {
    const telo = psqlQuery(`SELECT prosrc FROM pg_proc WHERE oid = 'public.get_twin_register(jsonb)'::regprocedure`)
      .replace(/\bp_params\b/g, "$1")
      .replace(/;\s*$/, "");
    const mut = mutace(telo);
    expect(mut, "mutace se neaplikovala — tělo funkce se změnilo, uprav mutace()").not.toBe(telo);
    expect(mut).not.toContain("kody_udalosti");
    const out = psqlVelky(`
BEGIN;
${FIXTURE}
SET LOCAL plan_cache_mode = force_generic_plan;
PREPARE nyni(jsonb) AS ${telo};
PREPARE stara(jsonb) AS ${mut};
\\echo @@nyni
EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) EXECUTE nyni(${PARAMS});
\\echo @@stara
EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) EXECUTE stara(${PARAMS});
\\echo @@konec
RESET ROLE;
ROLLBACK;
`);
    const plan = (od: string, po: string) => JSON.parse(out.split(`@@${od}\n`)[1]!.split(`@@${po}`)[0]!);
    const nyni = smycekKatalogu(plan("nyni", "stara"));
    const stara = smycekKatalogu(plan("stara", "konec"));
    console.log(`[registr twinů] sken katalogu: nyní ${nyni}×, stará podoba ${stara}×`);
    expect(nyni, "katalog kódů událostí se čte po událostech — vrátil se korelovaný tvar").toBeLessThanOrEqual(1);
    expect(stara, "měřítko nerozliší korelovanou podobu (planner zvolil hash anti join)").toBeGreaterThan(1);
  });
});

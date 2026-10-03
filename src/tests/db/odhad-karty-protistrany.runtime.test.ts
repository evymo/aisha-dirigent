/**
 * KARTA PROTISTRANY: counterparty_resolve vrací JEDEN řádek a planner to ví (ROWS 1).
 *
 * ⛔ NAMĚŘENO 2026-09-30 na produkci (read-only, generický plán, md5 36/36 proti živé
 * funkci). counterparty_resolve měla výchozí ROWS 1000, ačkoli vrací vždy právě jeden
 * řádek (závěrečný SELECT bez FROM). Volající `id × counterparty_docs(...)` pak planner
 * odhadl na 1 000 000 řádků (skutečně 0–stovky) → karta 676 317, aging 810 514,
 * web 305 974 → plný JIT: karta 1,8–2,8 s místo 14–240 ms. S ROWS 1: 4 038 / 811 / 4 606.
 * Vypnout JIT není oprava; oprava je pravdivý odhad.
 *
 * CO SE MĚŘÍ:
 *   1. pg_proc: counterparty_resolve má prorows = 1 (klauzule v SoT se opravdu propsala).
 *   2. Funkce vrací PRÁVĚ jeden řádek pro každý tvar vstupu — ROWS 1 je pravda, ne ladění.
 *   3. ODHAD plánu karty, agingu a webu při počtech řádků z produkce (reltuples v rollbacku):
 *      pod jit_above_cost; mutace `ALTER FUNCTION … ROWS 1000` (starý stav) nad ním.
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
const RUN = randomUUID().slice(0, 8);
const ICO = `7${RUN.replace(/[^0-9]/g, "").padEnd(7, "4").slice(0, 7)}`;
const JMENO = `Odhad karty ${RUN} s.r.o.`;
const OP = randomUUID();

/** psql pro EXPLAIN (FORMAT JSON): plán s politikami RLS má stovky kB (výchozí buffer 1 MB nestačí). */
function psqlVelky(sql: string): string {
  const soubor = join(tmpdir(), `odhad-karty-${process.pid}-${randomUUID()}.sql`);
  writeFileSync(soubor, sql);
  try {
    return execFileSync(
      "psql",
      ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", soubor],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60000, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
    );
  } finally {
    unlinkSync(soubor);
  }
}

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', 'odhad-${RUN}@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, doc_class, status, fields) VALUES
  ('odhad-${RUN}-1', 'odhad-${RUN}-d1', 'invoice', 'transactional', 'AUTO_PASS',
   '{"counterparty":{"value":"${JMENO}"},"counterparty_id":{"value":"${ICO}"},"issue_date":{"value":"2026-09-01"}}'::jsonb);
DO $$
DECLARE t uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', '${JMENO}') RETURNING id INTO t;
  INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at)
    VALUES (t, 'company_ico', 'test', '${ICO}', 'confirmed', 'test', now());
  PERFORM set_config('odhad.twin', t::text, true);
END $$;
`;

/** Počty řádků z produkce 2026-09-30. */
const PROFIL: Array<[string, number]> = [
  ["public.li_source_registry", 70583],
  ["public.twin_entities", 3993],
  ["public.twin_external_refs", 10126],
];

const VOLAJICI = ["get_counterparty_card", "get_counterparty_aging", "get_counterparty_web"];

function odhady(): { prah: number; profil: number; nyni: Record<string, number>; mutace: Record<string, number> } {
  const tela = Object.fromEntries(
    VOLAJICI.map((fn) => [
      fn,
      psqlQuery(`SELECT prosrc FROM pg_proc WHERE oid = 'public.${fn}(jsonb)'::regprocedure`)
        .replace(/\bp_params\b/g, "$1")
        .replace(/;\s*$/, ""),
    ]),
  );
  const params = `'{"presentation":"detail","debtor":"${ICO}","storno_values":["1","2"],"receivable_from":"issue_date"}'::jsonb`;
  const explain = (pre: string) =>
    VOLAJICI.map((fn) => `PREPARE ${pre}_${fn}(jsonb) AS ${tela[fn]};\n\\echo @@${pre}_${fn}\nEXPLAIN (FORMAT JSON) EXECUTE ${pre}_${fn}(${params});`).join("\n");
  const out = psqlVelky(`
BEGIN;
${FIXTURE}
UPDATE pg_class c
   SET relpages = greatest(1, (pg_relation_size(c.oid) / current_setting('block_size')::int)::int), reltuples = x.n
  FROM (VALUES ${PROFIL.map(([t, n]) => `('${t}'::regclass, ${n})`).join(", ")}) x(oid, n)
 WHERE c.oid = x.oid;
SELECT 'profil=' || count(*) FROM pg_class c WHERE c.oid IN (${PROFIL.map(([t]) => `'${t}'::regclass`).join(", ")})
   AND c.reltuples IN (${PROFIL.map(([, n]) => n).join(", ")});
SELECT 'prah=' || current_setting('jit_above_cost');
SET LOCAL plan_cache_mode = force_generic_plan;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true) IS NOT NULL AS ok;
${explain("nyni")}
RESET ROLE;
-- mutace = stav před opravou (výchozí ROWS 1000); v transakci, ROLLBACK ji vrátí
ALTER FUNCTION public.counterparty_resolve(jsonb) ROWS 1000;
SET LOCAL ROLE authenticated;
${explain("mutace")}
RESET ROLE;
ROLLBACK;
`);
  const cena = (znacka: string) => {
    const m = new RegExp(`@@${znacka}\\n[\\s\\S]*?"Total Cost":\\s*([0-9.]+)`).exec(out);
    return m ? Number(m[1]) : NaN;
  };
  return {
    prah: Number(/prah=([0-9.]+)/.exec(out)?.[1]),
    profil: Number(/profil=(\d+)/.exec(out)?.[1]),
    nyni: Object.fromEntries(VOLAJICI.map((fn) => [fn, cena(`nyni_${fn}`)])),
    mutace: Object.fromEntries(VOLAJICI.map((fn) => [fn, cena(`mutace_${fn}`)])),
  };
}

describe("karta protistrany: counterparty_resolve je jeden řádek a odhad to ví", () => {
  beforeAll(() => reportTestCapabilities("odhad karty protistrany"));

  it.skipIf(!dbAvailable)("prorows = 1 a funkce vrací právě jeden řádek pro každý tvar vstupu", () => {
    expect(psqlQuery(`SELECT prorows FROM pg_proc WHERE oid = 'public.counterparty_resolve(jsonb)'::regprocedure`)).toBe("1");
    const vstupy = [
      `'{}'::jsonb`,
      `'{"debtor":"${ICO}"}'::jsonb`,
      `'{"debtor":"${JMENO}"}'::jsonb`,
      `'{"debtor":"   "}'::jsonb`,
      `jsonb_build_object('twin_id', current_setting('odhad.twin'))`,
      `jsonb_build_object('twin_id', '${randomUUID()}')`,
      `'{"twin_id":"neni-uuid"}'::jsonb`,
    ];
    const out = psqlVelky(`
BEGIN;
${FIXTURE}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true) IS NOT NULL AS ok;
${vstupy.map((v, i) => `SELECT 'radku_${i}=' || count(*) FROM public.counterparty_resolve(${v});`).join("\n")}
RESET ROLE;
ROLLBACK;
`);
    vstupy.forEach((v, i) => expect(out, v).toContain(`radku_${i}=1\n`));
  });

  it.skipIf(!dbAvailable)("odhad karty, agingu a webu je pod jit_above_cost; ROWS 1000 ho nafoukne", () => {
    const o = odhady();
    console.log(
      `[karta protistrany] práh JIT ${o.prah}; nyní ${JSON.stringify(o.nyni)}; ROWS 1000 ${JSON.stringify(o.mutace)}`,
    );
    expect(o.profil, "profil počtů se do pg_class nepropsal — měřítko by měřilo malou DB").toBe(PROFIL.length);
    for (const fn of VOLAJICI) {
      expect(Number.isFinite(o.nyni[fn]) && Number.isFinite(o.mutace[fn]), `${fn}: EXPLAIN nevrátil cenu`).toBe(true);
      expect(o.nyni[fn], `${fn} dostane JIT — odhad je nafouknutý`).toBeLessThan(o.prah);
      // Nafouknutí je násobek (1000 × řádky counterparty_docs), ne pevná hodnota: měří se proti „nyní".
      expect(o.mutace[fn], `${fn}: měřítko nerozliší ROWS 1000`).toBeGreaterThan(o.nyni[fn] * 50);
    }
    // Karta a aging překročí práh i na malé DB. Web jen při stránkách z produkce (riq 305 974,
    // tady ~90 tis. — I/O část ceny škáluje se skutečnými stránkami, které reltuples nezmění).
    for (const fn of ["get_counterparty_card", "get_counterparty_aging"]) {
      expect(o.mutace[fn], `${fn}: ROWS 1000 musí spustit JIT i tady`).toBeGreaterThan(o.prah);
    }
  });
});

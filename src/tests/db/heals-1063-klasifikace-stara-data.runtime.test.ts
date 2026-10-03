/**
 * heals #1063 na STARÝCH DATECH: závora klasifikace nesmí shodit migrate.
 *
 * NAMĚŘENO 2026-09-25 (upgrade DB předchozího mainu 0c1043458 → #1063): jeden
 * AKTIVNÍ zdroj ve starém tvaru (`retention` místo `retention_class`, bez
 * `source_type` — stará závora ho pustila) shodil v heals ADD CONSTRAINT
 * `agent_knowledge_sources_activation_guard`, tím celý migrate a s ním nasazení
 * core. Rozhodnutí správy repa: takový zdroj se PŘED přidáním závor vypne,
 * s důvodem u dat a v audit_journal.
 *
 * Test spouští PŘESNĚ úsek heals.sql mezi značkami `>>> heals #1063` a
 * `<<< heals #1063` (ne kopii), nad tabulkou vrácenou do stavu před #1063
 * (nové CHECKy odebrané), a to celé v transakci, kterou na konci vrátí —
 * sdílená testovací DB zůstane beze změny.
 *
 * Vlastnosti:
 *  1. migrate projde: úsek doběhne a všechny čtyři CHECKy jsou platné;
 *  2. aktivní zdroj bez klasifikace je vypnutý a důvod leží u dat
 *     (`config.deaktivace`) i v audit_journal;
 *  3. neplatná hodnota dimenze (i u vypnutého řádku) se přesune do
 *     `deaktivace.neplatne_hodnoty`, aby prošel hodnotový CHECK;
 *  4. kontrolní vzorky: klasifikovaný aktivní zdroj zůstane aktivní
 *     a nedotčený; vypnutý neklasifikovaný zdroj s platnými hodnotami se
 *     nemění (závora vypnutý řádek nesoudí);
 *  5. idempotence: druhý běh nic nezmění a nový audit nezapíše.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const LIMIT = 180_000;
const RUN = randomUUID().slice(0, 8);

const HEALS = readFileSync(join(__dirname, "../../../aisha/db/heals.sql"), "utf-8");
const ZACATEK = "-- >>> heals #1063: klasifikace zdroje";
const KONEC = "-- <<< heals #1063: klasifikace zdroje";

/** Úsek heals.sql, který se testuje — přesně ten, který běží při migrate. */
function usek(): string {
  const a = HEALS.indexOf(ZACATEK);
  const b = HEALS.indexOf(KONEC);
  if (a < 0 || b < 0 || b < a) throw new Error("značky heals #1063 v heals.sql chybí nebo jsou prohozené");
  return HEALS.slice(a, b);
}

const AKTIVNI_STARY = `stary-aktivni-${RUN}`;
const VYPNUTY_NEPLATNY = `vypnuty-neplatny-${RUN}`;
const KLASIFIKOVANY = `klasifikovany-${RUN}`;
const VYPNUTY_NEKLASIFIKOVANY = `vypnuty-bez-klasifikace-${RUN}`;
const SLUGY = [AKTIVNI_STARY, VYPNUTY_NEPLATNY, KLASIFIKOVANY, VYPNUTY_NEKLASIFIKOVANY];
const slugArr = `ARRAY[${SLUGY.map((s) => `'${s}'`).join(",")}]`;

/** Stav zdrojů a auditu jako jeden JSON (jeden řádek výstupu). */
const STAV_SQL = `SELECT jsonb_build_object(
  'zdroje', (SELECT jsonb_object_agg(source_slug, jsonb_build_object('aktivni', is_active, 'config', config))
               FROM public.agent_knowledge_sources WHERE source_slug = ANY(${slugArr})),
  'audit', (SELECT count(*) FROM public.audit_journal
             WHERE action = 'agent_knowledge_sources.deaktivace_klasifikace'
               AND metadata->>'source_slug' = ANY(${slugArr})),
  'checky', (SELECT jsonb_object_agg(conname, convalidated) FROM pg_constraint
              WHERE conrelid = 'public.agent_knowledge_sources'::regclass
                AND conname IN ('agent_knowledge_sources_source_type_valid',
                                'agent_knowledge_sources_retention_class_valid',
                                'agent_knowledge_sources_legal_basis_valid',
                                'agent_knowledge_sources_activation_guard'))
)::text`;

type Stav = {
  zdroje: Record<string, { aktivni: boolean; config: Record<string, unknown> & { deaktivace?: Record<string, unknown> } }>;
  audit: number;
  checky: Record<string, boolean>;
};

/**
 * Celý scénář v JEDNÉ transakci jedním psql: tabulka do stavu před #1063,
 * stará data, úsek heals 2×, stav po každém běhu, ROLLBACK.
 */
function scenar(): { poPrvnim: Stav; poDruhem: Stav } {
  const sql = `
\\set ON_ERROR_STOP 1
\\o /dev/null
BEGIN;
SET LOCAL client_min_messages = error;
ALTER TABLE public.agent_knowledge_sources
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_activation_guard,
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_source_type_valid,
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_retention_class_valid,
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_legal_basis_valid;
INSERT INTO public.agent_knowledge_sources (source_slug, namespace, is_active, config) VALUES
  ('${AKTIVNI_STARY}', 'tenant/t/${RUN}/a', true,
   '{"data_sensitivity":"internal","legal_basis":"contract","owner":"ops","retention":"7y"}'),
  ('${VYPNUTY_NEPLATNY}', 'tenant/t/${RUN}/b', false,
   '{"data_sensitivity":"internal","legal_basis":"test","owner":"test"}'),
  ('${KLASIFIKOVANY}', 'tenant/t/${RUN}/c', true,
   '{"source_type":"partner","data_sensitivity":"restricted","retention_class":"long_term","legal_basis":"contract","owner":"ops"}'),
  ('${VYPNUTY_NEKLASIFIKOVANY}', 'tenant/t/${RUN}/d', false,
   '{"data_sensitivity":"internal"}');
${usek()}
\\o
${STAV_SQL};
\\o /dev/null
${usek()}
\\o
${STAV_SQL};
ROLLBACK;
`;
  const out = execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-tA"],
    { encoding: "utf8", input: sql, env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  );
  const radky = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  if (radky.length !== 2) throw new Error(`čekal jsem 2 stavy, přišlo ${radky.length}:\n${out}`);
  return { poPrvnim: JSON.parse(radky[0]), poDruhem: JSON.parse(radky[1]) };
}

let vysledek: { poPrvnim: Stav; poDruhem: Stav } | undefined;

beforeAll(async () => {
  await reportTestCapabilities("heals #1063: klasifikace zdroje na starých datech");
  if (dbAvailable) vysledek = scenar();
}, LIMIT);

describe("heals #1063 na starých datech", () => {
  it.skipIf(!dbAvailable)("migrate projde: všechny čtyři CHECKy existují a jsou platné", () => {
    expect(vysledek!.poPrvnim.checky).toEqual({
      agent_knowledge_sources_source_type_valid: true,
      agent_knowledge_sources_retention_class_valid: true,
      agent_knowledge_sources_legal_basis_valid: true,
      agent_knowledge_sources_activation_guard: true,
    });
  });

  it.skipIf(!dbAvailable)("aktivní zdroj bez klasifikace je vypnutý a důvod leží u dat", () => {
    const z = vysledek!.poPrvnim.zdroje[AKTIVNI_STARY];
    expect(z.aktivni).toBe(false);
    expect(z.config.deaktivace).toMatchObject({
      kym: "heals #1063",
      bylo_aktivni: true,
      chybi: ["source_type", "retention_class"],
      neplatne_hodnoty: {},
    });
    expect(String(z.config.deaktivace!.proc)).toContain("source_type");
    // Původní klasifikace zůstala — operátor doplňuje, nezačíná znovu.
    expect(z.config).toMatchObject({ data_sensitivity: "internal", legal_basis: "contract", owner: "ops", retention: "7y" });
  });

  it.skipIf(!dbAvailable)("neplatná hodnota se přesune do deaktivace, aby prošel hodnotový CHECK", () => {
    const z = vysledek!.poPrvnim.zdroje[VYPNUTY_NEPLATNY];
    expect(z.aktivni).toBe(false);
    expect(z.config.legal_basis).toBeUndefined();
    expect(z.config.deaktivace).toMatchObject({ bylo_aktivni: false, neplatne_hodnoty: { legal_basis: "test" } });
  });

  it.skipIf(!dbAvailable)("každé vypnutí má řádek v audit_journal (a jen ono)", () => {
    expect(vysledek!.poPrvnim.audit).toBe(2);
  });

  it.skipIf(!dbAvailable)("kontrolní vzorky: klasifikovaný aktivní zdroj ani vypnutý platný se nemění", () => {
    const k = vysledek!.poPrvnim.zdroje[KLASIFIKOVANY];
    expect(k.aktivni).toBe(true);
    expect(k.config.deaktivace).toBeUndefined();
    const v = vysledek!.poPrvnim.zdroje[VYPNUTY_NEKLASIFIKOVANY];
    expect(v.aktivni).toBe(false);
    expect(v.config).toEqual({ data_sensitivity: "internal" });
  });

  it.skipIf(!dbAvailable)("idempotence: druhý běh nic nezmění a nový audit nezapíše", () => {
    expect(vysledek!.poDruhem.zdroje).toEqual(vysledek!.poPrvnim.zdroje);
    expect(vysledek!.poDruhem.audit).toBe(vysledek!.poPrvnim.audit);
  });
});

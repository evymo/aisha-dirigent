/**
 * Jeden ingest = jedna identita zdroje v twinech.
 *
 * NAMĚŘENO 2026-09-19 v produkci instance: přehrání balíčků se jménem aplikace
 * (`aisha-local-ingest`) místo registrovaného zdroje (`local-ingest`) založilo
 * 839 duplikátních twinů. Registr zdrojů zdroj pohltil (neaktivní +
 * config.superseded_by), ale zapisovatelé twinů párují přesně podle
 * (source, source_key) — pohlcení neviděli.
 *
 * Vlastnosti:
 *  1. prevence: twin_upsert_entity_audited i twin_identity_propose_binding
 *     zapisují pohlcený zdroj pod toho, kdo ho pohltil → přehrání starého
 *     balíčku trefí týž twin, nový nezaloží; aktivní zdroj se nepřekládá;
 *  2. rozhodnutí: náhled nic nezmění a spočítá třídy duplikat / prevest /
 *     nejasne (klíč porovnaný jen z písmen a číslic); ostrý běh archivuje
 *     duplikáty, převede jedinečné vazby, na nejasné nesáhne a zapíše
 *     rozhodnutí do audit_journal (viditelné v get_decisions_admin);
 *  3. vrácení: obnoví přesně stav před rozhodnutím; změněné řádky přeskočí
 *     a řekne to; dvojí vrácení odmítne;
 *  4. hranice: nepohlcený zdroj a chybějící důvod se odmítnou; bez role
 *     admin/staff odmítnutí, anon funkci vůbec nespustí.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

function q(sql: string, opts: { claims?: string; role?: string } = {}): string {
  const claims = opts.claims ?? '{"role":"service_role"}';
  const setRole = opts.role ? `SET ROLE ${opts.role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
const qj = (sql: string, opts?: { claims?: string; role?: string }) => JSON.parse(q(sql, opts));

const RUN = randomUUID().slice(0, 8);

/**
 * Limity pro zátěž stroje: jedno spuštění `psql` trvalo pod zátěží 7–25 s
 * (naměřeno 2026-09-19, load ~15) a výchozích 30 s na hook shodilo kontrolní
 * běh bez jakékoli vady. Příprava dat proto jde JEDNÍM voláním a limity
 * jsou volné — test měří chování, ne rychlost.
 */
const LIMIT = 180_000;
const NS = "test/ingest-identita";

/** SQL: pohlcený zdroj `abs` → `kan` (stav registru po ensure_source_story). */
function pohlt(abs: string, kan: string): string {
  return `INSERT INTO public.agent_knowledge_sources (source_slug, namespace, is_active, config)
          VALUES ('${abs}', '${NS}', false, '{"superseded_by":"${kan}"}'::jsonb)`;
}

/** SQL: historický stav — twin a jeho potvrzené vazby zapsané PŘÍMO (tak, jak je zapsal starý kód). */
function twin(id: string, refs: Array<[source: string, kind: string, key: string]>, druh = "company"): string {
  return [
    `INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${id}', '${druh}', 'test ${RUN}')`,
    ...refs.map(
      ([source, kind, key]) =>
        `INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
         VALUES ('${id}', '${source}', '${key}', '${kind}', 'confirmed', 'import', now())`,
    ),
  ].join(";\n");
}

/** Celou přípravu jedním spuštěním psql. */
const priprav = (...sql: string[]) => q(sql.join(";\n"));

function snapshot(ids: string[]): string {
  const arr = `ARRAY[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]`;
  return q(`SELECT coalesce((SELECT string_agg(format('%s|%s|%s', id, status, metadata::text), E'\\n' ORDER BY id)
                               FROM public.twin_entities WHERE id = ANY(${arr})), '') || E'\\n--\\n' ||
                   coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', twin_id, source, source_key, ref_kind, state, valid_to IS NULL),
                                               E'\\n' ORDER BY id)
                               FROM public.twin_external_refs WHERE twin_id = ANY(${arr})), '')`);
}

beforeAll(async () => {
  await reportTestCapabilities("ingest: jedna identita zdroje v twinech");
}, LIMIT);

describe("prevence: zapisovatelé twinů dodržují pohlcení zdroje", () => {
  const ABS = `abs-p-${RUN}`;
  const KAN = `kan-p-${RUN}`;
  const AKT = `akt-p-${RUN}`;

  it.skipIf(!dbAvailable)("canonical_ingest_source překládá jen neaktivní pohlcený zdroj", () => {
    // Kontrolní vzorek: AKTIVNÍ zdroj se superseded_by se nepřekládá — pohlcení
    // platí, až když ho registr vyřadil.
    priprav(
      pohlt(ABS, KAN),
      `INSERT INTO public.agent_knowledge_sources (source_slug, namespace, is_active, config)
       VALUES ('${AKT}', '${NS}', true, '{"superseded_by":"${KAN}","source_type":"internal",
               "data_sensitivity":"internal","retention_class":"short_term",
               "legal_basis":"legitimate_interest","owner":"test"}'::jsonb)`,
    );
    expect(q(`SELECT public.canonical_ingest_source('${ABS}')`)).toBe(KAN);
    expect(q(`SELECT public.canonical_ingest_source('${KAN}')`)).toBe(KAN);
    expect(q(`SELECT public.canonical_ingest_source('${AKT}')`)).toBe(AKT);
    expect(q(`SELECT public.canonical_ingest_source('nezname-${RUN}')`)).toBe(`nezname-${RUN}`);
  }, LIMIT);

  it.skipIf(!dbAvailable)("přehrání pod pohlceným jménem trefí týž twin, nový nezaloží", () => {
    const a = qj(`SELECT public.twin_upsert_entity_audited('company', '${KAN}', 'X-1', 'Firma X')`);
    expect(a.created).toBe(true);
    const b = qj(`SELECT public.twin_upsert_entity_audited('company', '${ABS}', 'X-1', 'Firma X')`);
    expect(b.created).toBe(false);
    expect(b.twin_id).toBe(a.twin_id);
    expect(q(`SELECT count(*) FROM public.twin_external_refs WHERE source = '${ABS}'`)).toBe("0");

    const c = qj(`SELECT public.twin_upsert_entity_audited('company', '${ABS}', 'X-2', 'Firma Y')`);
    expect(c.created).toBe(true);
    expect(q(`SELECT source FROM public.twin_external_refs WHERE twin_id = '${c.twin_id}'`)).toBe(KAN);

    const p = qj(`SELECT public.twin_identity_propose_binding('${a.twin_id}', '${ABS}', 'ICO-9', 'ico', 'rule:test')`);
    expect(q(`SELECT source FROM public.twin_external_refs WHERE id = '${p.ref_id}'`)).toBe(KAN);
  }, LIMIT);
});

describe("rozhodnutí: srovnat twiny pohlceného zdroje, vrátit", () => {
  const ABS = `abs-r-${RUN}`;
  const KAN = `kan-r-${RUN}`;
  // ⛔ DUPLIKÁT = ÚPLNÁ SHODA (2026-09-28, majitel: „slučovat, pokud máme
  // shodu"; „neslučovat jen podle jednoho klíče"). Jeden společný klíč nestačí:
  // twin, jehož ostatní klíče kanonický zdroj nezná, nebo jehož klíče vedou na
  // dvě různé firmy, je spor pro člověka — archivace by ukončila jeho IČO/DIČ/jméno.
  const T = {
    kan1: randomUUID(), // kanonický: primary A-1, ico 111
    kan2: randomUUID(), // kanonický: ico 444
    dup: randomUUID(), // jen pohlcený, VŠECHNY klíče drží kan1 → duplikat
    // (surové klíče se liší zápisem — „a-1", „A 1", „A.1" — kvůli unikátnímu indexu;
    //  po normalizaci jsou všechny „a1" jako kanonické „A-1")
    dupCast: randomUUID(), // jen pohlcený, A-1 drží kan1, ale dic CZ999 kanon nezná → nejasne
    dupSpor: randomUUID(), // jen pohlcený, A-1 → kan1, ico 444 → kan2 (dvě firmy) → nejasne
    dupDruh: randomUUID(), // jen pohlcený, klíče drží kan1, ale je to OSOBA, ne firma → nejasne
    pure: randomUUID(), // jen pohlcený, bez protějšku → prevest
    mixOk: randomUUID(), // oba zdroje, bez sporu → prevest (stejný klíč na sobě se ukončí)
    mixSpor: randomUUID(), // oba zdroje, klíč „44-4" drží kan2 → nejasne
  };
  const ALL = Object.values(T);
  const NEJASNE = [T.dupCast, T.dupSpor, T.dupDruh, T.mixSpor].sort();
  let pred = "";
  let decisionId = "";

  beforeAll(() => {
    if (!dbAvailable) return;
    priprav(
      pohlt(ABS, KAN),
      twin(T.kan1, [[KAN, "primary_id", "A-1"], [KAN, "ico", "111"]]),
      twin(T.kan2, [[KAN, "primary_id", "E-1"], [KAN, "ico", "444"]]),
      twin(T.dup, [[ABS, "primary_id", "A-1"], [ABS, "ico", "1 1 1"]]),
      twin(T.dupCast, [[ABS, "primary_id", "a-1"], [ABS, "dic", "CZ999"]]),
      twin(T.dupSpor, [[ABS, "primary_id", "A 1"], [ABS, "ico", "444"]]),
      twin(T.dupDruh, [[ABS, "primary_id", "A.1"], [ABS, "ico", "111"]], "person"),
      twin(T.pure, [[ABS, "primary_id", "B-1"], [ABS, "ico", "222"]]),
      twin(T.mixOk, [[KAN, "primary_id", "C-1"], [ABS, "primary_id", "C-1"], [ABS, "ico", "333"]]),
      twin(T.mixSpor, [[KAN, "primary_id", "D-1"], [ABS, "ico", "44-4"]]),
    );
    pred = snapshot(ALL);
  }, LIMIT);

  it.skipIf(!dbAvailable)("odmítne nepohlcený zdroj a chybějící důvod", () => {
    const a = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${KAN}', 'test')`);
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/pohlcený/);
    const b = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', '  ')`);
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/důvod/);
  }, LIMIT);

  it.skipIf(!dbAvailable)("bez role admin/staff odmítne, anon nespustí", () => {
    const sub = randomUUID();
    const r = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', 'test', false)`, {
      claims: `{"role":"authenticated","sub":"${sub}"}`,
      role: "authenticated",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/oprávnění/);
    expect(() =>
      q(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', 'test')`, { claims: '{"role":"anon"}', role: "anon" }),
    ).toThrow(/permission denied/);
    expect(snapshot(ALL)).toBe(pred);
  }, LIMIT);

  it.skipIf(!dbAvailable)("náhled spočítá třídy a nic nezmění", () => {
    const n = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', 'test náhledu')`);
    expect(n.ok).toBe(true);
    expect(n.dry_run).toBe(true);
    expect(n.kanon).toBe(KAN);
    expect(n.twinu).toEqual({ duplikat: 1, prevest: 2, nejasne: 4 });
    // ukončit: 2 vazby duplikátu + pohlcené C-1 u mixOk; převést: 2 u pure + ico 333.
    // Duplikát z úplné shody nemá klíč bez protějšku — nic se neztratí.
    expect(n.vazeb).toEqual({ nahradit: 3, prevest: 3, duplikat_bez_protejsku: 0 });
    expect([...n.nejasne_ukazka].sort()).toEqual(NEJASNE);
    expect(snapshot(ALL)).toBe(pred);
  }, LIMIT);

  it.skipIf(!dbAvailable)("ostrý běh archivuje duplikát, převede jedinečné, nejasné nechá", () => {
    const r = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', 'test ostrého běhu', false)`);
    expect(r.ok).toBe(true);
    expect(r.vazeb).toEqual({ nahrazeno: 3, prevedeno: 3 });
    decisionId = r.decision_id;

    expect(q(`SELECT status || '|' || (metadata->>'archivovano_rozhodnutim') FROM public.twin_entities WHERE id = '${T.dup}'`))
      .toBe(`archived|${decisionId}`);
    expect(q(`SELECT count(*) FROM public.twin_external_refs
               WHERE twin_id = '${T.dup}' AND state = 'superseded' AND valid_to IS NOT NULL`)).toBe("2");
    // Částečná shoda, spor dvou firem i jiný druh: nic se nezměnilo, IČO/DIČ žijí.
    for (const id of [T.dupCast, T.dupSpor, T.dupDruh]) {
      expect(q(`SELECT status || '|' || (SELECT count(*) FROM public.twin_external_refs
                                           WHERE twin_id = '${id}' AND source = '${ABS}' AND valid_to IS NULL)
                  FROM public.twin_entities WHERE id = '${id}'`)).toBe("active|2");
    }
    expect(q(`SELECT string_agg(DISTINCT source, ',') FROM public.twin_external_refs WHERE twin_id = '${T.pure}'`)).toBe(KAN);
    expect(q(`SELECT string_agg(source || ':' || ref_kind || ':' || state || ':' || (valid_to IS NULL), ',' ORDER BY source, ref_kind)
                FROM public.twin_external_refs WHERE twin_id = '${T.mixOk}'`))
      .toBe(`${ABS}:primary_id:superseded:false,${KAN}:ico:confirmed:true,${KAN}:primary_id:confirmed:true`);
    expect(q(`SELECT status || '|' || (SELECT string_agg(source, ',' ORDER BY source) FROM public.twin_external_refs
                                        WHERE twin_id = '${T.mixSpor}')
                FROM public.twin_entities WHERE id = '${T.mixSpor}'`)).toBe(`active|${ABS},${KAN}`);
    expect(q(`SELECT status FROM public.twin_entities WHERE id = '${T.kan1}'`)).toBe("active");

    const d = qj(`SELECT public.get_decisions_admin(50, 'twin_decision')`);
    const mine = d.items.find((x: { decision_id: string }) => x.decision_id === decisionId);
    expect(mine?.vratne).toBe(true);
    expect(mine?.pocty?.twinu_archivovano).toBe(1);
  }, LIMIT);

  it.skipIf(!dbAvailable)("vrácení obnoví přesně stav před rozhodnutím, dvakrát nejde", () => {
    const n = qj(`SELECT public.revert_twin_decision_admin('${decisionId}', 'test náhledu vrácení')`);
    expect(n).toMatchObject({ ok: true, dry_run: true, twinu: 1, vazeb_obnoveno: 3, vazeb_vraceno_zdroji: 3, preskoceno_zmenene: 0 });
    const r = qj(`SELECT public.revert_twin_decision_admin('${decisionId}', 'test vrácení', false)`);
    expect(r).toMatchObject({ ok: true, twinu: 1, vazeb_obnoveno: 3, vazeb_vraceno_zdroji: 3, preskoceno_zmenene: 0 });
    expect(snapshot(ALL)).toBe(pred);

    const znovu = qj(`SELECT public.revert_twin_decision_admin('${decisionId}', 'podruhé', false)`);
    expect(znovu.ok).toBe(false);
    expect(znovu.error).toMatch(/už bylo vráceno/);
    const d = qj(`SELECT public.get_decisions_admin(50, 'twin_decision')`);
    const mine = d.items.find((x: { decision_id: string }) => x.decision_id === decisionId);
    expect(mine?.vratne).toBe(false);
    expect(mine?.vraceno?.obnoveno).toBe(7);
  }, LIMIT);
});

describe("vrácení nepřepíše, na co od rozhodnutí někdo sáhl", () => {
  const ABS = `abs-z-${RUN}`;
  const KAN = `kan-z-${RUN}`;
  const K = randomUUID();
  const D = randomUUID();

  it.skipIf(!dbAvailable)("ručně obnovený twin se přeskočí a vrácení to řekne", () => {
    priprav(pohlt(ABS, KAN), twin(K, [[KAN, "primary_id", "Z-1"]]), twin(D, [[ABS, "primary_id", "Z-1"]]));
    const r = qj(`SELECT public.resolve_absorbed_ingest_source_admin('${ABS}', 'test', false)`);
    expect(r.twinu).toEqual({ duplikat: 1, prevest: 0, nejasne: 0 });
    // Člověk mezitím twin sám vrátil do života.
    q(`UPDATE public.twin_entities SET status = 'active', metadata = metadata - 'archivovano_rozhodnutim' WHERE id = '${D}'`);
    const v = qj(`SELECT public.revert_twin_decision_admin('${r.decision_id}', 'test', false)`);
    expect(v).toMatchObject({ ok: true, twinu: 0, vazeb_obnoveno: 1, preskoceno_zmenene: 1 });
    expect(q(`SELECT status FROM public.twin_entities WHERE id = '${D}'`)).toBe("active");
  }, LIMIT);
});

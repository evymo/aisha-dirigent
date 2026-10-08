import { beforeAll, describe, expect, it } from "vitest";
import { validateBlockData } from "@aisha/surface-blocks";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * NÁVRHY VAZEB MEZI DVOJČATY + SCHVALOVÁNÍ PO SKUPINÁCH — real-DB runtime test
 * (throwaway PG přes `npm run test:db`).
 *
 * Majitel 2026-09-28: zdroje (měřidla, smlouvy, faktury…) se mají propojit tak,
 * že vazby NAVRHNE systém sám a člověk je SCHVÁLÍ — „po skupinách". Naměřeno
 * v produkci RIQ: twin_relations 0 řádků, li_relation_suggestions bez čtenáře
 * a bez stavu rozhodnutí — návrh hrany neměl kam přistát.
 *
 * Tvrdí se:
 *   · návrh je idempotentní (instanční data se přehrávají při každém nasazení);
 *   · rozhodnutí je lepkavé — schválené ani zamítnuté navrhovatel nepřepíše;
 *   · hrana, která už platí, se nenavrhuje k rozhodnutí ('superseded');
 *   · skupinu jednoho zdroje jiný zdroj nepřepíše, vadný vstup padá (22023);
 *   · schválení skupiny otevře hrany přes twin_relation_open_admin (s důkazem
 *     v metadatech) a zapíše audit; konflikt překryvu nechá návrh čekat;
 *   · rozhoduje přihlášený správce — běžný uživatel ani služba NE;
 *   · fronta projde maskou review_queue ve všech větvích a ukazuje jen čekající.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const ZDROJ = `navrhy-vazeb-${process.pid}-${Date.now()}`;
const CIZI = "00000000-0000-4000-8000-00000000abcd";
const FRONTA = `${ZDROJ}-fronta`;

beforeAll(async () => {
  await reportTestCapabilities("Návrhy vazeb mezi dvojčaty");
});

const FIXTURE = `
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
    WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
`;

/** Přepnutí identity uvnitř DO bloku (transakčně lokální). */
const JAKO_SLUZBA = `
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);`;
const JAKO_SPRAVCE = `
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);`;
const JAKO_CIZI = `
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '${CIZI}', true);`;

/** Zavolá výraz jako `authenticated` s daným sub ve vrácené transakci; vrátí jsonb. */
function jakoUzivatel(sub: string, vyraz: string, priprava = ""): unknown {
  const ZNACKA = "@@ODPOVED@@";
  const out = psqlQuery(
    `begin; ${priprava} ` +
      `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); ` +
      `select set_config('request.jwt.claim.sub', '${sub}', true); ` +
      `set local role authenticated; ` +
      `select '${ZNACKA}' || (${vyraz})::text; rollback;`,
  );
  const radek = out.split("\n").map((r) => r.trim()).find((r) => r.startsWith(ZNACKA));
  if (!radek) throw new Error(`ve výstupu psql chybí odpověď: ${out.slice(0, 200)}`);
  return JSON.parse(radek.slice(ZNACKA.length));
}

/** Návrh jedné skupiny jako JSON literál pro SQL. */
const skupina = (klic: string, zdroj = ZDROJ, titulek = klic) =>
  `jsonb_build_object('group_key', '${ZDROJ}:${klic}', 'source', '${zdroj}', 'rule_key', 'struktura', ` +
  `'title', '${titulek}', 'evidence', '{"list":"Mlyn"}'::jsonb)`;

describe("návrhy vazeb mezi dvojčaty", () => {
  it.skipIf(!dbAvailable)("návrh: idempotence, lepkavé rozhodnutí, hotový fakt, vlastnictví skupiny", () => {
    psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  r jsonb; v_g uuid; v_n int; v_failed boolean; v_state text;
  v_navrhy jsonb;
BEGIN
  ${FIXTURE}
  INSERT INTO public.twin_entities (id, entity_type, label) VALUES
    (a, 'meter', '${ZDROJ}-HLAVNI'), (b, 'meter', '${ZDROJ}-POD-1'),
    (c, 'meter', '${ZDROJ}-POD-2'),  (d, 'unit',  '${ZDROJ}-MISTNOST');

  v_navrhy := jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:p1', 'source_twin_id', b, 'target_twin_id', a,
      'relation_kind', 'submeter_of', 'valid_from', '2026-01-01T00:00:00Z', 'confidence', 0.95,
      'evidence', '{"row":167}'::jsonb),
    jsonb_build_object('proposal_key', '${ZDROJ}:p2', 'source_twin_id', c, 'target_twin_id', a,
      'relation_kind', 'submeter_of', 'valid_from', '2026-01-01T00:00:00Z'),
    jsonb_build_object('proposal_key', '${ZDROJ}:p3', 'source_twin_id', b, 'target_twin_id', d,
      'relation_kind', 'measures'));

  -- 1. první návrh → 3 čekající v jedné skupině
  ${JAKO_SLUZBA}
  r := public.twin_relation_propose(${skupina("g1")}, v_navrhy);
  IF (r->>'inserted')::int <> 3 THEN RAISE EXCEPTION '1: expected 3 inserted, got %', r; END IF;
  v_g := (r->>'group_id')::uuid;

  -- 2. opakovaný běh (každé nasazení) nic nezdvojí
  r := public.twin_relation_propose(${skupina("g1")}, v_navrhy);
  IF (r->>'unchanged')::int <> 3 OR (r->>'inserted')::int <> 0 THEN
    RAISE EXCEPTION '2: expected 3 unchanged, got %', r;
  END IF;
  SELECT count(*) INTO v_n FROM public.twin_relation_proposals WHERE proposal_key LIKE '${ZDROJ}:%';
  IF v_n <> 3 THEN RAISE EXCEPTION '2: expected 3 rows, got %', v_n; END IF;

  -- 3. nový důkaz u čekajícího návrhu se promítne
  r := public.twin_relation_propose(${skupina("g1")}, jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:p3', 'source_twin_id', b, 'target_twin_id', d,
      'relation_kind', 'measures', 'evidence', '{"row":168}'::jsonb)));
  IF (r->>'updated')::int <> 1 THEN RAISE EXCEPTION '3: expected 1 updated, got %', r; END IF;

  -- 4. cizí zdroj skupinu nepřepíše
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_propose(${skupina("g1", "cizi-zdroj")}, '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '4: foreign source must not take over a group'; END IF;

  -- 5. vadný vstup padá, nic se tiše nepřeskakuje
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_propose(${skupina("g1")}, jsonb_build_array(
      jsonb_build_object('proposal_key', '${ZDROJ}:vadny', 'source_twin_id', b, 'relation_kind', 'measures')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '5: proposal without target must raise 22023'; END IF;

  -- 6. návrh nepřeskočí do jiné skupiny
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_propose(${skupina("g-jina")}, jsonb_build_array(
      jsonb_build_object('proposal_key', '${ZDROJ}:p1', 'source_twin_id', b, 'target_twin_id', a,
        'relation_kind', 'submeter_of')));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '6: proposal must not move to another group'; END IF;

  -- 7. běžný přihlášený uživatel nenavrhuje
  ${JAKO_CIZI}
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_propose(${skupina("g1")}, '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '7: plain user must not propose'; END IF;

  -- 8. schválení skupiny (přes dispečer plochy) otevře hrany s důkazem
  ${JAKO_SPRAVCE}
  r := public.submit_evidence_review_audited('twin_relation', v_g, 'approved', 'podle sešitu');
  IF r->>'state' <> 'approved' OR (r->'result'->>'approved')::int <> 3 THEN
    RAISE EXCEPTION '8: expected 3 approved, got %', r;
  END IF;
  SELECT count(*) INTO v_n FROM public.twin_relations tr
    JOIN public.twin_relation_proposals x ON x.relation_id = tr.id
   WHERE x.group_id = v_g AND x.state = 'approved'
     AND tr.metadata->>'proposal_id' = x.id::text AND tr.metadata->>'proposed_by' = '${ZDROJ}';
  IF v_n <> 3 THEN RAISE EXCEPTION '8: expected 3 relations carrying proposal evidence, got %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.twin_relations
   WHERE source_twin_id = b AND target_twin_id = a AND relation_kind = 'submeter_of'
     AND valid_from = '2026-01-01T00:00:00Z' AND valid_to IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION '8: edge must hold the source-asserted valid_from'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_journal
   WHERE entity_type = 'twin_relation_proposal_group' AND entity_id = v_g::text AND user_id = v_admin;
  IF v_n <> 1 THEN RAISE EXCEPTION '8: expected one group audit row, got %', v_n; END IF;

  -- 9. rozhodnutí je lepkavé: navrhovatel schválené nepřepíše ani neoživí
  ${JAKO_SLUZBA}
  r := public.twin_relation_propose(${skupina("g1")}, v_navrhy);
  IF (r->>'decided_kept')::int <> 3 THEN RAISE EXCEPTION '9: expected 3 decided_kept, got %', r; END IF;

  -- 10. hrana, která už platí, do fronty nepatří
  r := public.twin_relation_propose(${skupina("g-fakt")}, jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:p-fakt', 'source_twin_id', b, 'target_twin_id', a,
      'relation_kind', 'submeter_of')));
  SELECT state INTO v_state FROM public.twin_relation_proposals WHERE proposal_key = '${ZDROJ}:p-fakt';
  IF (r->>'already_fact')::int <> 1 OR v_state <> 'superseded' THEN
    RAISE EXCEPTION '10: expected superseded already_fact, got % / %', r, v_state;
  END IF;

  -- 11. zamítnutí je lepkavé
  r := public.twin_relation_propose(${skupina("g-ne")}, jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:p-ne', 'source_twin_id', c, 'target_twin_id', d,
      'relation_kind', 'measures', 'confidence', 0.4)));
  v_g := (r->>'group_id')::uuid;
  ${JAKO_SPRAVCE}
  r := public.submit_evidence_review_audited('twin_relation', v_g, 'rejected', 'jiná místnost');
  IF (r->'result'->>'rejected')::int <> 1 THEN RAISE EXCEPTION '11: expected 1 rejected, got %', r; END IF;
  ${JAKO_SLUZBA}
  r := public.twin_relation_propose(${skupina("g-ne")}, jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:p-ne', 'source_twin_id', c, 'target_twin_id', d,
      'relation_kind', 'measures', 'confidence', 0.9)));
  SELECT state INTO v_state FROM public.twin_relation_proposals WHERE proposal_key = '${ZDROJ}:p-ne';
  IF (r->>'decided_kept')::int <> 1 OR v_state <> 'rejected' THEN
    RAISE EXCEPTION '11: human "no" must not come back, got % / %', r, v_state;
  END IF;
  SELECT count(*) INTO v_n FROM public.twin_relations WHERE source_twin_id = c AND target_twin_id = d;
  IF v_n <> 0 THEN RAISE EXCEPTION '11: rejected proposal must not open an edge'; END IF;
END $$;`);
  });

  it.skipIf(!dbAvailable)("rozhodnutí: jen přihlášený správce, uzavřený slovník, konflikt překryvu čeká", () => {
    psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_admin uuid; a uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  r jsonb; v_g uuid; v_n int; v_failed boolean; v_state text;
BEGIN
  ${FIXTURE}
  INSERT INTO public.twin_entities (id, entity_type, label) VALUES
    (a, 'meter', '${ZDROJ}-R-HLAVNI'), (d, 'unit', '${ZDROJ}-R-MISTNOST');
  -- Hrana, která platila do půlky roku: návrh od ledna s ní koliduje v čase.
  INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from, valid_to)
  VALUES (a, d, 'feeds', '2025-01-01T00:00:00Z', '2026-06-01T00:00:00Z');

  ${JAKO_SLUZBA}
  r := public.twin_relation_propose(${skupina("r1")}, jsonb_build_array(
    jsonb_build_object('proposal_key', '${ZDROJ}:r-konflikt', 'source_twin_id', a, 'target_twin_id', d,
      'relation_kind', 'feeds', 'valid_from', '2026-01-01T00:00:00Z')));
  v_g := (r->>'group_id')::uuid;

  -- 1. služba ratifikovat nesmí (stroj by z návrhu udělal fakt bez člověka)
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_proposal_decide(v_g, 'approved');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '1: service_role must not decide'; END IF;

  -- 2. běžný uživatel nerozhodne ani přes dispečer, ani napřímo
  ${JAKO_CIZI}
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('twin_relation', v_g, 'approved');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '2: plain user must not decide via dispatcher'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_proposal_decide(v_g, 'approved');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '2: plain user must not decide directly'; END IF;

  -- 3. překlep nerozhodne nic
  ${JAKO_SPRAVCE}
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('twin_relation', v_g, 'aproved');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  SELECT state INTO v_state FROM public.twin_relation_proposals WHERE proposal_key = '${ZDROJ}:r-konflikt';
  IF NOT v_failed OR v_state <> 'proposed' THEN
    RAISE EXCEPTION '3: typo must raise 22023 and leave proposed (failed=%, state=%)', v_failed, v_state;
  END IF;

  -- 4. konflikt překryvu: schválení hranu neotevře, návrh zůstane čekat
  r := public.twin_relation_proposal_decide(v_g, 'approved');
  SELECT state INTO v_state FROM public.twin_relation_proposals WHERE proposal_key = '${ZDROJ}:r-konflikt';
  IF (r->>'conflicts')::int <> 1 OR (r->>'approved')::int <> 0 OR v_state <> 'proposed' THEN
    RAISE EXCEPTION '4: overlap must count as conflict and stay proposed, got % / %', r, v_state;
  END IF;
  SELECT count(*) INTO v_n FROM public.twin_relations WHERE source_twin_id = a AND target_twin_id = d;
  IF v_n <> 1 THEN RAISE EXCEPTION '4: conflicting approval must not add an edge (n=%)', v_n; END IF;

  -- 5. neexistující skupina = čitelná chyba, ne tiché nic
  v_failed := false;
  BEGIN
    PERFORM public.twin_relation_proposal_decide(gen_random_uuid(), 'approved');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '5: unknown group must raise P0002'; END IF;
END $$;`);
  });

  it.skipIf(!dbAvailable)("fronta projde maskou review_queue ve všech větvích a nese jen čekající skupiny", () => {
    const admin = psqlQuery(
      `select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`,
    );
    expect(admin, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);

    // Dvojčata i návrh vzniknou ve stejné vrácené transakci — nic nezůstane v DB.
    const priprava =
      `select set_config('request.jwt.claims', '{"role":"service_role"}', true); ` +
      `insert into public.twin_entities (id, entity_type, label) values ` +
      `('11111111-2222-4333-8444-000000000001', 'meter', '859182400513022198'), ` +
      `('11111111-2222-4333-8444-000000000002', 'meter', '101 - Molekuly života - PW 03'), ` +
      `('11111111-2222-4333-8444-000000000003', 'meter', '102 - Květinařství - PW 04'); ` +
      `select public.twin_relation_propose(${skupina("fronta", FRONTA, "Mlyn · Elektřina (zásuvky)")}, jsonb_build_array(` +
      `jsonb_build_object('proposal_key', '${ZDROJ}:f1', 'source_twin_id', '11111111-2222-4333-8444-000000000002', ` +
      `'target_twin_id', '11111111-2222-4333-8444-000000000001', 'relation_kind', 'submeter_of', 'confidence', 0.95), ` +
      `jsonb_build_object('proposal_key', '${ZDROJ}:f2', 'source_twin_id', '11111111-2222-4333-8444-000000000003', ` +
      `'target_twin_id', '11111111-2222-4333-8444-000000000001', 'relation_kind', 'submeter_of', 'confidence', 0.9))); `;
    // Vlastní zdroj: konfliktní návrh z předchozího testu v DB správně ČEKÁ dál,
    // takže by ve frontě téhož zdroje byl vidět jako druhá skupina.
    const params = `'{"source":"${FRONTA}","sample":1}'::jsonb`;

    const r = jakoUzivatel(admin, `public.get_twin_relation_proposal_queue(${params})`, priprava) as {
      data: {
        entity_kind: string;
        items: { id: string; title: string; quote: string; fields: { key: string; value?: unknown }[] }[];
        actions: { decision: string }[];
      };
    };
    const v = validateBlockData(r.data);
    expect(v.ok, `maska: ${JSON.stringify(v)}`).toBe(true);
    expect(r.data.entity_kind).toBe("twin_relation");
    expect(r.data.items).toHaveLength(1);
    const [polozka] = r.data.items;
    expect(polozka.title).toBe("Mlyn · Elektřina (zásuvky)");
    // Ukázka hran je čitelná (štítky ze zdroje, ne UUID) a přizná, kolik je navíc.
    expect(polozka.quote).toContain("→ 859182400513022198");
    expect(polozka.quote).toContain("(+1)");
    expect(polozka.fields.find((f) => f.key === "pending")?.value).toBe(2);
    expect(polozka.fields.find((f) => f.key === "confidence")?.value).toBe("90 %");
    expect(r.data.actions.map((a) => a.decision)).toEqual(["approved", "rejected"]);

    // Bez nároku i bez čekajících: prázdná fronta, ale POŘÁD platný blok.
    for (const [sub, vyraz, prip] of [
      [CIZI, `public.get_twin_relation_proposal_queue(${params})`, priprava],
      [admin, `public.get_twin_relation_proposal_queue('{"source":"${ZDROJ}-nic"}'::jsonb)`, ""],
    ] as const) {
      const prazdna = jakoUzivatel(sub, vyraz, prip) as { data: { items: unknown[] } };
      expect(validateBlockData(prazdna.data).ok, `${vyraz} jako ${sub}`).toBe(true);
      expect(prazdna.data.items).toEqual([]);
    }
  });

  it.skipIf(!dbAvailable)("bilance hlavního měřidla: jen potvrzené hrany, násobitel, výměna měřidla, chybějící odečet", () => {
    const admin = psqlQuery(
      `select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`,
    );
    const H = "22222222-3333-4444-8555-000000000001";
    const P1 = "22222222-3333-4444-8555-000000000002";
    const P2 = "22222222-3333-4444-8555-000000000003";
    const P3 = "22222222-3333-4444-8555-000000000004";
    const odecet = (t: string, per: string, druh: string, v: number) =>
      // Odečet je hodnota K DATU (G3, 2026-10-04): jako import sešitu leží na hranici období — počátek
      // 1. dne měsíce, konec 1. dne následujícího (UTC = výchozí pásmo bloku). Čísla musí vyjít STEJNĚ
      // jako dřív, kdy bilance četla nálepku `period`/`kind` (ta zůstává, bilance ji už nečte).
      `('meter_reading', '${t}', (to_date('${per}', 'YYYY-MM')${druh === "konec" ? " + interval '1 month'" : ""})::timestamp at time zone 'UTC', jsonb_build_object('period', '${per}', 'kind', '${druh}', 'value', ${v}, 'unit', 'kWh'), '${ZDROJ}', '${ZDROJ}:${t}:${per}:${druh}')`;
    // Hlavní + dvě podružná (P2 s násobitelem 2) přes POTVRZENÉ hrany; P3 je jen NÁVRH.
    const priprava =
      `select set_config('request.jwt.claims', '{"role":"service_role"}', true); ` +
      `insert into public.twin_entities (id, entity_type, label, metadata) values ` +
      `('${H}', 'meter', 'HLAVNI', '{}'), ('${P1}', 'meter', 'POD-1', '{}'), ` +
      `('${P2}', 'meter', 'POD-2', '{"energie":{"nasobitel":2}}'), ('${P3}', 'meter', 'POD-3', '{}'); ` +
      `insert into public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from) values ` +
      `('${P1}', '${H}', 'submeter_of', '2026-01-01T00:00:00+01:00'), ('${P2}', '${H}', 'submeter_of', '2026-01-01T00:00:00+01:00'); ` +
      `select public.twin_relation_propose(${skupina("bilance")}, jsonb_build_array(jsonb_build_object(` +
      `'proposal_key', '${ZDROJ}:b3', 'source_twin_id', '${P3}', 'target_twin_id', '${H}', 'relation_kind', 'submeter_of'))); ` +
      `insert into public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) values ` +
      [
        odecet(P1, "2026-01", "pocatek", 10), odecet(P1, "2026-01", "konec", 40),
        odecet(P2, "2026-01", "pocatek", 5), odecet(P2, "2026-01", "konec", 15),
        // únor: P1 vyměněno — nový počítadlo začíná od nuly (výslovný počátek)
        odecet(P1, "2026-02", "pocatek", 0), odecet(P1, "2026-02", "konec", 20),
        odecet(P2, "2026-02", "konec", 25),
        // březen: P2 bez odečtu
        odecet(P1, "2026-03", "konec", 35),
        odecet(P3, "2026-01", "pocatek", 0), odecet(P3, "2026-01", "konec", 999),
      ].join(", ") +
      `, ` +
      ["2026-01:100", "2026-02:40", "2026-03:30"]
        .map((x) => x.split(":"))
        .map(([per, v]) => `('meter_consumption', '${H}', now(), jsonb_build_object('period', '${per}', 'value', ${v}, 'unit', 'kWh'), '${ZDROJ}', '${ZDROJ}:${H}:${per}')`)
        .join(", ") +
      `; `;
    const cfg = `'{"twin_id":"${H}","relation_kind":"submeter_of","consumption_event":"meter_consumption","multiplier_path":["energie","nasobitel"],"residual_path":["energie","dopocty"]}'::jsonb`;
    const r = jakoUzivatel(admin, `public.get_meter_balance_block(${cfg})`, priprava) as {
      data: { columns: { key: string }[]; rows: Record<string, unknown>[] };
    };
    const v = validateBlockData(r.data);
    expect(v.ok, `maska: ${JSON.stringify(v)}`).toBe(true);
    const podle = Object.fromEntries(r.data.rows.map((x) => [x.obdobi as string, x]));
    // leden: (40−10) + (15−5)×2 = 50; P3 (jen návrh, 999) se NEPOČÍTÁ
    expect(podle["2026-01"]).toMatchObject({ hlavni: 100, podruzne: 50, rozdil: 50, rozdil_pct: 50, chybi: 0, odhad: 0,
      stav: "app.meters.balance.state.measured" });
    // únor: výměna P1 → 20 − 0; P2 navazuje na lednový konec: (25−15)×2 = 20
    expect(podle["2026-02"]).toMatchObject({ hlavni: 40, podruzne: 40, rozdil: 0, stav: "app.meters.balance.state.measured" });
    // březen: P2 bez odečtu → součet NEÚPLNÝ, přizná se
    expect(podle["2026-03"]).toMatchObject({ chybi: 1, stav: "app.meters.balance.state.missing_readings" });

    // Bez `multiplier_path` (hlavička: „volitelné, bez ní 1“) se bilance NESMÍ shodit: prázdná cesta
    // dřív četla `metadata #>> '{}'` = celý objekt a `::numeric` spadl (naměřeno 2026-10-04).
    // Násobitel P2 pak platí 1: leden (40−10) + (15−5) = 40.
    const cfgBezNasobitele = `'{"twin_id":"${H}","relation_kind":"submeter_of","consumption_event":"meter_consumption"}'::jsonb`;
    const bezNasobitele = jakoUzivatel(admin, `public.get_meter_balance_block(${cfgBezNasobitele})`, priprava) as {
      data: { rows: Record<string, unknown>[] };
    };
    expect(bezNasobitele.data.rows.find((x) => x.obdobi === "2026-01")).toMatchObject({ hlavni: 100, podruzne: 40, rozdil: 60 });

    // Dopočet u hlavního: rozdíl je nulový z principu — stav to řekne.
    const sDopoctem = jakoUzivatel(admin, `public.get_meter_balance_block(${cfg})`,
      priprava + `update public.twin_entities set metadata = '{"energie":{"dopocty":["Soundsyle"]}}' where id = '${H}'; `,
    ) as { data: { rows: Record<string, unknown>[] } };
    expect(sDopoctem.data.rows.find((x) => x.obdobi === "2026-02")?.stav).toBe("app.meters.balance.state.residual");

    // Bez nároku a bez konfigurace: platná prázdná tabulka.
    for (const [sub, vyraz, prip] of [
      [CIZI, `public.get_meter_balance_block(${cfg})`, priprava],
      [admin, `public.get_meter_balance_block('{"twin_id":"${H}"}'::jsonb)`, priprava],
    ] as const) {
      const prazdna = jakoUzivatel(sub, vyraz, prip) as { data: { columns: unknown[]; rows: unknown[] } };
      expect(validateBlockData(prazdna.data).ok, `${vyraz} jako ${sub}`).toBe(true);
      expect(prazdna.data.rows).toEqual([]);
    }
  });
});

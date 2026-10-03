import { beforeAll, describe, expect, it } from "vitest";
import { validateBlockData } from "@aisha/surface-blocks";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * NÁLEZY JAKO DOTAZY NA PRAVDU — real-DB runtime test (throwaway PG přes `npm run test:db`).
 *
 * ⛔ NAMĚŘENO 2026-09-28 (produkce, extranet): blok „Nálezy" ukazoval 79 řádků —
 * 43× „Součet položek nesedí s celkovou částkou" a 36× „Data dokladu jsou
 * v nesprávném pořadí", každý s jedním souborem, bez čísel a bez akce; tentýž
 * soubor někdy 2×. Uživatel: „nevím k čemu to je a nejde s tím stejně nic dělat".
 *
 * Tvrdí se:
 *   · nálezy se slučují po PRAVIDLE (ne po titulku): dvě pravidla téhož druhu
 *     nálezu jsou dva dotazy, tentýž nález na více dokladech jeden;
 *   · dotaz nese počet dokladů, popis pravidla a příklad s čísly z důkazu;
 *   · stará verze dokladu (registr ho překlíčoval) se nepočítá ani neukazuje;
 *   · blok projde maskou review_queue i pro uživatele bez nároku (prázdný);
 *   · odpověď platí pro celé pravidlo, zapíše verdikt + audit a dotaz zmizí;
 *   · překlep, neexistující dotaz ani cizí role nezapíšou nic.
 *
 * Vše běží ve vrácené transakci — v DB nic nezůstane.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const P = `t${process.pid}x${Date.now()}`;

beforeAll(async () => {
  await reportTestCapabilities("Nálezy jako dotazy na pravdu");
});

/** Produkční tvar nálezů z 2026-09-28, zmenšený. Prefix `P` je izoluje od ostatních dat. */
const FIXTURE = `
insert into public.li_source_registry (source_sha256, doc_slug, doc_type, filename) values
  ('${P}-vf1',    '${P}-d1', 'invoice',  '${P}-VF2600068.json'),
  ('${P}-vf2',    '${P}-d2', 'invoice',  '${P}-VF22337.json'),
  ('${P}-vf3new', '${P}-d3', 'invoice',  '${P}-VF24288.json'),
  ('${P}-fpt',    '${P}-d4', 'invoice',  '${P}-FPT2600195.json'),
  ('${P}-sml',    '${P}-d5', 'contract', '${P}-Naj.sml.PROFIMAX.pdf');
insert into public.li_findings (finding_key, rule_key, finding, severity, documents, evidence, raw_data, ingested_at) values
  ('${P}-k1', '${P}-lines', 'lines_sum_mismatch', 'high',
   '[{"source_sha256":"${P}-vf1","source_slug":"${P}-d1","filename":"${P}-VF2600068.json"}]',
   '{"op":"lines_sum_equals","line_field":"line_total","total_field":"amount_without_vat","lines_sum":12340,"total_value":12338,"diff":2}',
   '{"description":"Součet řádkových položek = částka bez DPH"}', now() - interval '2 hours'),
  ('${P}-k2', '${P}-lines', 'lines_sum_mismatch', 'high',
   '[{"source_sha256":"${P}-vf2","source_slug":"${P}-d2","filename":"${P}-VF22337.json"}]',
   '{"op":"lines_sum_equals","line_field":"line_total","total_field":"amount_without_vat","lines_sum":5000,"total_value":4132,"diff":868}',
   '{"description":"Součet řádkových položek = částka bez DPH"}', now() - interval '1 hour'),
  ('${P}-k3old', '${P}-lines', 'lines_sum_mismatch', 'high',
   '[{"source_sha256":"${P}-vf3old","source_slug":"${P}-d3","filename":"${P}-VF24288.json"}]',
   '{"op":"lines_sum_equals","total_field":"amount_without_vat","lines_sum":10,"total_value":7,"diff":3}',
   '{"description":"Součet řádkových položek = částka bez DPH"}', now()),
  ('${P}-k3new', '${P}-lines', 'lines_sum_mismatch', 'high',
   '[{"source_sha256":"${P}-vf3new","source_slug":"${P}-d3","filename":"${P}-VF24288.json"}]',
   '{"op":"lines_sum_equals","total_field":"amount_without_vat","lines_sum":900,"total_value":898,"diff":2}',
   '{"description":"Součet řádkových položek = částka bez DPH"}', now() - interval '3 hours'),
  ('${P}-k4', '${P}-inv-dates', 'date_order_violation', 'medium',
   '[{"source_sha256":"${P}-fpt","source_slug":"${P}-d4","filename":"${P}-FPT2600195.json"}]',
   '{"op":"date_order","violated":["taxable_supply_date","issue_date"],"values":{"taxable_supply_date":"2026-09-01","issue_date":"2026-08-25"}}',
   '{"description":"DUZP ≤ datum vystavení ≤ datum splatnosti"}', now()),
  ('${P}-k5', '${P}-contract-dates', 'date_order_violation', 'high',
   '[{"source_sha256":"${P}-sml","source_slug":"${P}-d5","filename":"${P}-Naj.sml.PROFIMAX.pdf"}]',
   '{"op":"date_order","violated":["signature_date","valid_from"],"values":{"signature_date":"2024-02-03","valid_from":"2024-01-01"}}',
   '{"description":"Podpis ≤ platnost od ≤ platnost do"}', now());
`;

type Pole = { key: string; label_key: string; value?: string | number | null };
type Dotaz = { id: string; title_key: string; quote?: string; fields: Pole[] };

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

/** Jen dotazy z této fixtury (příklad nese prefix běhu). */
function nase(items: Dotaz[]): Dotaz[] {
  return items.filter((i) => String(i.fields.find((f) => f.key === "example")?.value ?? "").startsWith(P));
}

const pole = (d: Dotaz, key: string) => d.fields.find((f) => f.key === key)?.value;

describe("nálezy jako dotazy na pravdu", () => {
  it.skipIf(!dbAvailable)("slučuje po pravidle, nese příklad s čísly a nepočítá staré verze dokladů", () => {
    const admin = psqlQuery(
      `select user_id from public.user_roles where role in ('admin','staff') order by user_id limit 1`,
    );
    expect(admin, "fixture: no admin/staff user seeded").toMatch(/^[0-9a-f-]{36}$/);

    const r = jakoUzivatel(admin, "public.get_finding_questions('{}'::jsonb)", FIXTURE) as {
      data: { entity_kind: string; items: Dotaz[]; actions: { decision: string }[] };
    };
    const v = validateBlockData(r.data);
    expect(v.ok, `maska: ${JSON.stringify(v)}`).toBe(true);
    expect(r.data.entity_kind).toBe("finding");
    expect(r.data.actions.map((a) => a.decision)).toEqual(["confirmed", "rejected"]);

    const dotazy = nase(r.data.items);
    // 6 nálezů → 3 dotazy: součet položek (1 pravidlo) a pořadí dat (2 různá pravidla)
    expect(dotazy).toHaveLength(3);
    const soucet = dotazy.find((d) => d.title_key === "app.wb.finding.lines_sum_mismatch")!;
    expect(pole(soucet, "documents"), "stará verze VF24288 se nesmí počítat").toBe(3);
    expect(pole(soucet, "example"), "příklad = nejnovější AKTUÁLNÍ nález").toBe(`${P}-VF22337.json`);
    expect(pole(soucet, "lines_sum")).toBe(5000);
    expect(pole(soucet, "amount_without_vat")).toBe(4132);
    expect(pole(soucet, "diff")).toBe(868);
    expect(soucet.quote).toBe("Součet řádkových položek = částka bez DPH");

    const data = dotazy.filter((d) => d.title_key === "app.wb.finding.date_order_violation");
    expect(data.map((d) => d.quote).sort()).toEqual([
      "DUZP ≤ datum vystavení ≤ datum splatnosti",
      "Podpis ≤ platnost od ≤ platnost do",
    ]);
    const smlouva = data.find((d) => d.quote?.startsWith("Podpis"))!;
    expect(smlouva.fields.map((f) => f.key)).toEqual(["documents", "example", "signature_date", "valid_from"]);
    expect(pole(smlouva, "signature_date")).toBe("2024-02-03");

    // Bez nároku: prázdná fronta, ale pořád platný blok.
    const cizi = jakoUzivatel(
      "00000000-0000-4000-8000-00000000abcd",
      "public.get_finding_questions('{}'::jsonb)",
      FIXTURE,
    ) as { data: { items: Dotaz[] } };
    expect(validateBlockData(cizi.data).ok).toBe(true);
    expect(nase(cizi.data.items)).toEqual([]);
  });

  it.skipIf(!dbAvailable)("odpověď platí pro pravidlo a dotaz zmizí; překlep, cizí dotaz ani cizí role nezapíšou", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
begin;
${FIXTURE}
DO $$
DECLARE
  v_admin uuid; v_q uuid; v_r jsonb; v_failed boolean; v_n int; v_v record;
  v_left text[];
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
    WHERE ur.role IN ('admin','staff') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no admin/staff user seeded'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_q := public.li_finding_question_id('${P}-lines', 'lines_sum_mismatch');

  -- 1. překlep nerozhodne nic
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('finding', v_q, 'rejectd');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.li_finding_verdicts WHERE question_id = v_q) THEN
    RAISE EXCEPTION 'typo must raise 22023 and write no verdict (failed=%)', v_failed;
  END IF;

  -- 2. dotaz, který nic nepojmenovává, neexistuje
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('finding', public.li_finding_question_id('${P}-nic', 'nic'), 'rejected');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown question must raise P0002'; END IF;

  -- 3. bez role správce se nezapíše nic
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000abcd', true);
  v_failed := false;
  BEGIN
    PERFORM public.submit_evidence_review_audited('finding', v_q, 'rejected');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.li_finding_verdicts WHERE question_id = v_q) THEN
    RAISE EXCEPTION 'non-reviewer must get 42501 and write no verdict (failed=%)', v_failed;
  END IF;

  -- 4. odpověď správce: verdikt nad pravidlem + audit
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_r := public.submit_evidence_review_audited('finding', v_q, 'rejected', 'zaokrouhlení');
  IF v_r->>'state' <> 'rejected' THEN RAISE EXCEPTION 'expected state rejected, got %', v_r; END IF;
  SELECT * INTO v_v FROM public.li_finding_verdicts WHERE question_id = v_q;
  IF v_v.decision <> 'rejected' OR v_v.documents_count <> 3 OR v_v.decided_by <> v_admin
     OR v_v.example->>'document' <> '${P}-VF22337.json' THEN
    RAISE EXCEPTION 'verdict row wrong: %', row_to_json(v_v);
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_journal
   WHERE action = 'evidence.review_decided' AND details->>'entity_kind' = 'finding'
     AND details->>'entity_id' = v_q::text AND details->>'rule_key' = '${P}-lines';
  IF v_n <> 1 THEN RAISE EXCEPTION 'audit row missing (n=%)', v_n; END IF;

  -- 5. zodpovězený dotaz z fronty zmizel, oba dotazy na pořadí dat zůstaly
  SELECT array_agg(i->>'quote' ORDER BY i->>'quote') INTO v_left
    FROM jsonb_array_elements(public.get_finding_questions()->'data'->'items') i
   WHERE i->'fields'->1->>'value' LIKE '${P}%';
  IF v_left IS DISTINCT FROM ARRAY['DUZP ≤ datum vystavení ≤ datum splatnosti', 'Podpis ≤ platnost od ≤ platnost do'] THEN
    RAISE EXCEPTION 'after answer expected only the two date questions, got %', v_left;
  END IF;

  RAISE NOTICE 'dotazy na pravdu OK';
END $$;
rollback;
`);
    expect(run).not.toThrow();
  });
});

/**
 * OSA „PODLE FIRMY" VE VŠECH BLOCÍCH SEKCE — a přiznání tam, kde blok nefiltruje.
 *
 * ⛔ NAMĚŘENO 2026-09-28 (majitel: „na stránce smlouvy a nájmy funguje filtrování podle
 * firmy jen u dlužníků, ale jednotky a obsazenost se podle toho už nefiltrují“): v sekci
 * Smlouvy filtrovalo 5 bloků z 10. KPI smluv, povinnosti, identifikace, jednotky a nájemci
 * zvolenou firmu tiše ignorovali a ukazovali celý podnik.
 *
 * CO SE MĚŘÍ (vše pod admin identitou, v transakci s ROLLBACK):
 *   1. get_document_digest: všechny metriky počítají jen doklady zvolené firmy; povinnosti
 *      a zjištění patří firmě přes SVŮJ doklad.
 *   2. get_obligation_queue: fronta pod firmou = přesná podmnožina fronty bez osy.
 *   3. get_twin_ref_review_block: filtruje JEN se `scope_map.owner_company.via = 'document'`;
 *      bez konfigurace nefiltruje A NEHLÁSÍ, že filtroval.
 *   4. get_twin_register přes vazbu: jednotka se zvolenou firmou jen přes PLATNOU vazbu na
 *      firmu s POTVRZENÝM odkazem `nase_firma` (nepotvrzená firma ani prošlá vazba nestačí).
 *   5. get_twin_register přes pole dokladu: nájemce = IČO v protistraně dokladů firmy.
 *   6. Každý blok, který filtroval, to řekne v provenance.scope_effective (scope_applied);
 *      bez osy je provenance beze změny.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const P = `of${randomUUID().slice(0, 6)}`;
const OP = randomUUID();
const FA = `${P} Firma A`;
const FB = `${P} Firma B`;

const reg = (sha: string, type: string, klass: string, status: string, firma: string, ico: string) =>
  `('${P}-${sha}', '${P}-d-${sha}', '${type}', '${klass}', '${status}', ` +
  `'{"owner_company":{"value":"${firma}"},"counterparty_id":{"value":"${P}-${ico}"}}'::jsonb)`;

const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES ('${OP}', '${P}-op@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${OP}', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, doc_class, status, fields) VALUES
  ${reg("a1", "contract", "contractual", "AUTO_PASS", FA, "ico1")},
  ${reg("a2", "invoice", "transactional", "REVIEW", FA, "ico2")},
  ${reg("b1", "contract", "contractual", "AUTO_PASS", FB, "ico3")};
INSERT INTO public.li_obligations (obligation_key, source_sha256, quote, candidate_status) VALUES
  ('${P}-o1', '${P}-a1', 'Nájemce zaplatí do 15. dne.', 'NEEDS_REVIEW'),
  ('${P}-o2', '${P}-b1', 'Pronajímatel zajistí úklid.', 'NEEDS_REVIEW');
INSERT INTO public.li_findings (finding_key, rule_key, finding, severity, documents) VALUES
  ('${P}-f1', '${P}-r', 'x', 'high', '[{"source_sha256":"${P}-a1"}]'),
  ('${P}-f2', '${P}-r', 'x', 'high', '[{"source_sha256":"${P}-b1"}]');
DO $$
DECLARE ca uuid; cb uuid; u1 uuid; u2 uuid; u3 uuid; t1 uuid; t2 uuid; t3 uuid;
BEGIN
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', '${FA}') RETURNING id INTO ca;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', '${FB}') RETURNING id INTO cb;
  -- Firma A je POTVRZENÁ naše firma, B jen navržená.
  INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at)
    VALUES (ca, 'nase_firma', 'money', '${FA}', 'confirmed', 'test', now()),
           (cb, 'nase_firma', 'money', '${FB}', 'proposed',  'test', null);
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U1') RETURNING id INTO u1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U2') RETURNING id INTO u2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_unit', 'U3') RETURNING id INTO u3;
  INSERT INTO public.twin_relations (source_twin_id, target_twin_id, relation_kind, valid_from, valid_to) VALUES
    (u1, ca, '${P}_pronajimatel', now() - interval '1 year', null),
    (u2, cb, '${P}_pronajimatel', now() - interval '1 year', null),
    (u3, ca, '${P}_pronajimatel', now() - interval '2 years', now() - interval '1 year');
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T1') RETURNING id INTO t1;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T2') RETURNING id INTO t2;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('${P}_firma', 'T3') RETURNING id INTO t3;
  INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
    ('param', t1, now(), '{"code":"company_ico","value":"${P}-ico1"}', 'test'),
    ('param', t2, now(), '{"code":"company_ico","value":"${P}-ico3"}', 'test'),
    ('param', t3, now(), '{"code":"company_ico","value":"${P}-ico9"}', 'test');
  -- Návrhy identity z dokladů (klíč = sha dokladu) — fronta identifikace.
  INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by)
    VALUES (t1, 'ico', '${P}-ingest', '${P}-a1', 'proposed', 'test'),
           (t2, 'ico', '${P}-ingest', '${P}-b1', 'proposed', 'test');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${OP}","role":"authenticated"}', true);
`;

/** Hodnota scope_effective (nebo „-“, když ji blok neohlásil). */
const eff = (expr: string) => `coalesce((${expr})->'provenance'->'scope_effective'->0->>'value', '-')`;
const osa = (extra: string) => `jsonb_build_object('owner_company', '${FA}') || ${extra}`;
const REF_REVIEW = `'{"source":"${P}-ingest","title_template":"{label}","quote_template":"{label}"}'::jsonb`;
const JEDNOTKY = `'{"entity_type":"${P}_unit","scope_map":{"owner_company":{"via":"relation","relation_kind":"${P}_pronajimatel","target_ref":"nase_firma"}}}'::jsonb`;
const NAJEMCI = `'{"entity_type":"${P}_firma","scope_map":{"owner_company":{"via":"doc_field","param":"company_ico","doc_field":"counterparty_id"}}}'::jsonb`;
const rows = (expr: string) =>
  `(SELECT coalesce(string_agg(r->>'label', ',' ORDER BY r->>'label'), '') FROM jsonb_array_elements((${expr})->'data'->'rows') r)`;

function probe(): string {
  return psqlMultiline(`
BEGIN;
${FIXTURE}
-- 1. KPI: všechny metriky pod firmou A
SELECT 'digest=' || (SELECT string_agg(m || ':' || (public.get_document_digest(${osa(`jsonb_build_object('metric', m)`)})->'data'->>'value'), ',' ORDER BY m)
                     FROM unnest(array['contracts','findings','pending_review','registered']) m) AS out;
SELECT 'digest_eff=' || ${eff(`public.get_document_digest(${osa(`'{"metric":"contracts"}'::jsonb`)})`)} AS out;
SELECT 'digest_bez_osy=' || (public.get_document_digest('{"metric":"contracts"}'::jsonb)->'provenance' ? 'scope_effective')::text AS out;

-- 2. povinnosti: pod A jen o1; bez osy o1 i o2
SELECT 'povinnosti_a=' || (SELECT count(*) FROM jsonb_array_elements(public.get_obligation_queue(${osa(`'{"limit":500}'::jsonb`)})->'data'->'items') i
                           WHERE i->>'quote' LIKE 'Nájemce zaplatí%' OR i->>'quote' LIKE 'Pronajímatel zajistí%') AS out;
SELECT 'povinnosti_vse=' || (SELECT count(*) FROM jsonb_array_elements(public.get_obligation_queue('{"limit":500}'::jsonb)->'data'->'items') i
                             WHERE i->>'quote' LIKE 'Nájemce zaplatí%' OR i->>'quote' LIKE 'Pronajímatel zajistí%') AS out;
SELECT 'povinnosti_eff=' || ${eff(`public.get_obligation_queue(${osa(`'{}'::jsonb`)})`)} AS out;

-- 3. identifikace: filtr jen s konfigurací; bez ní nefiltruje a nehlásí
SELECT 'ident_osa=' || jsonb_array_length(public.get_twin_ref_review_block(${osa(`${REF_REVIEW} || '{"scope_map":{"owner_company":{"via":"document"}}}'::jsonb`)})->'data'->'items') AS out;
SELECT 'ident_osa_eff=' || ${eff(`public.get_twin_ref_review_block(${osa(`${REF_REVIEW} || '{"scope_map":{"owner_company":{"via":"document"}}}'::jsonb`)})`)} AS out;
SELECT 'ident_bez_mapy=' || jsonb_array_length(public.get_twin_ref_review_block(${osa(REF_REVIEW)})->'data'->'items') AS out;
SELECT 'ident_bez_mapy_eff=' || ${eff(`public.get_twin_ref_review_block(${osa(REF_REVIEW)})`)} AS out;

-- 4. jednotky přes vazbu na potvrzenou naši firmu
SELECT 'jednotky_a=' || ${rows(`public.get_twin_register(${osa(JEDNOTKY)})`)} AS out;
SELECT 'jednotky_b=' || ${rows(`public.get_twin_register(jsonb_build_object('owner_company', '${FB}') || ${JEDNOTKY})`)} AS out;
SELECT 'jednotky_eff=' || ${eff(`public.get_twin_register(${osa(JEDNOTKY)})`)} AS out;
SELECT 'jednotky_vse=' || ${rows(`public.get_twin_register(${JEDNOTKY})`)} AS out;
SELECT 'jednotky_bez_mapy=' || ${rows(`public.get_twin_register(${osa(`'{"entity_type":"${P}_unit"}'::jsonb`)})`)} AS out;
SELECT 'jednotky_bez_mapy_eff=' || ${eff(`public.get_twin_register(${osa(`'{"entity_type":"${P}_unit"}'::jsonb`)})`)} AS out;
SELECT 'jednotky_nezname_via=' || ${eff(`public.get_twin_register(${osa(`'{"entity_type":"${P}_unit","scope_map":{"owner_company":{"via":"jmeno"}}}'::jsonb`)})`)} AS out;

-- 5. nájemci přes IČO v dokladech firmy
SELECT 'najemci_a=' || ${rows(`public.get_twin_register(${osa(NAJEMCI)})`)} AS out;
SELECT 'najemci_b=' || ${rows(`public.get_twin_register(jsonb_build_object('owner_company', '${FB}') || ${NAJEMCI})`)} AS out;

-- 6. dosavadní konzumenti osy ji teď ohlásí
SELECT 'registr_eff=' || ${eff(`public.get_document_register(${osa(`'{"doc_type":"contract"}'::jsonb`)})`)} AS out;
SELECT 'registr_radku=' || jsonb_array_length(public.get_document_register(${osa(`'{"doc_type":"contract"}'::jsonb`)})->'data'->'rows') AS out;
SELECT 'pohledavky_eff=' || ${eff(`public.get_receivables_overdue(${osa(`'{}'::jsonb`)})`)} AS out;
SELECT 'rozpad_eff=' || ${eff(`public.get_rent_breakdown(${osa(`'{}'::jsonb`)})`)} AS out;
SELECT 'expirace_eff=' || ${eff(`public.get_doc_expiry_review_block(${osa(`'{"doc_type":"contract","date_field":"valid_to","direction":"upcoming"}'::jsonb`)})`)} AS out;
SELECT 'recap_eff=' || ${eff(`public.get_ingest_recap(${osa(`'{"metric":"doklady"}'::jsonb`)})`)} AS out;
SELECT 'recap_high=' || (public.get_ingest_recap(${osa(`'{"metric":"zjisteni_high"}'::jsonb`)})->'data'->>'value') AS out;
SELECT 'recap_sync_eff=' || ${eff(`public.get_ingest_recap(${osa(`'{"view":"sync"}'::jsonb`)})`)} AS out;

-- helper: tvar a prázdno
SELECT 'helper_prazdno=' || public.scope_applied('{}'::jsonb, 'owner_company')::text
    || '|' || public.scope_applied('{"owner_company":""}'::jsonb, 'owner_company')::text AS out;
SELECT 'helper_tvar=' || (public.scope_applied('{"owner_company":"X"}'::jsonb, 'owner_company')->'scope_effective'->0)::text AS out;
RESET ROLE;
ROLLBACK;
`);
}

describe("osa „podle firmy“ ve všech blocích sekce Smlouvy", () => {
  beforeAll(() => reportTestCapabilities("osa firmy — bloky"));

  it.skipIf(!dbAvailable)("filtruje, kde to jde přes identitu, a každý filtr ohlásí", () => {
    const out = probe();
    // 1. KPI: smlouvy 1 (a1), zjištění 1 (f1), k revizi 2 (a2 REVIEW + o1), registrováno 2.
    expect(out).toContain("digest=contracts:1,findings:1,pending_review:2,registered:2");
    expect(out).toContain(`digest_eff=${FA}`);
    expect(out, "bez osy je provenance beze změny").toContain("digest_bez_osy=false");
    // 2. povinnosti
    expect(out).toContain("povinnosti_a=1");
    expect(out, "výřez je podmnožina fronty bez osy").toContain("povinnosti_vse=2");
    expect(out).toContain(`povinnosti_eff=${FA}`);
    // 3. identifikace
    expect(out).toContain("ident_osa=1");
    expect(out).toContain(`ident_osa_eff=${FA}`);
    expect(out, "bez konfigurace se nefiltruje…").toContain("ident_bez_mapy=2");
    expect(out, "…a blok netvrdí, že filtroval").toContain("ident_bez_mapy_eff=-");
    // 4. jednotky: U2 má firmu jen navrženou, U3 prošlou vazbu
    expect(out).toContain("jednotky_a=U1\n");
    expect(out, "nepotvrzená naše firma nepropustí nic").toContain("jednotky_b=\n");
    expect(out).toContain(`jednotky_eff=${FA}`);
    expect(out, "bez osy registr beze změny").toContain("jednotky_vse=U1,U2,U3");
    expect(out, "blok bez mapy osu nečte…").toContain("jednotky_bez_mapy=U1,U2,U3");
    expect(out, "…a nehlásí ji").toContain("jednotky_bez_mapy_eff=-");
    expect(out, "neznámá cesta se neodhaduje").toContain("jednotky_nezname_via=-");
    // 5. nájemci
    expect(out).toContain("najemci_a=T1\n");
    expect(out).toContain("najemci_b=T2\n");
    // 6. dosavadní konzumenti
    expect(out).toContain(`registr_eff=${FA}`);
    expect(out).toContain("registr_radku=1");
    expect(out).toContain(`pohledavky_eff=${FA}`);
    expect(out).toContain(`rozpad_eff=${FA}`);
    expect(out).toContain(`expirace_eff=${FA}`);
    expect(out).toContain(`recap_eff=${FA}`);
    expect(out, "zjištění v přehledu ingestu patří firmě přes doklad").toContain("recap_high=1");
    expect(out, "stav synchronizace s firmou nesouvisí a netvrdí to").toContain("recap_sync_eff=-");
    // helper
    expect(out).toContain("helper_prazdno={}|{}");
    expect(out).toContain('helper_tvar={"dim": "owner_company", "value": "X", "origin": "user_pick", "resolver": "none", "confidence": 1}');
  });
});

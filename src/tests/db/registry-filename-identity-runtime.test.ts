import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * li_upsert_source_registry — IDENTITA DOKLADU JE JMÉNO, sha je verze obsahu.
 *
 * THE BUG THIS PINS (measured on production 2026-07-30, not hypothetical):
 * `source_sha256` is a hash of the file CONTENT. Re-downloading the same
 * document with richer fields (payment state, line items) changes the content,
 * so ON CONFLICT (source_sha256) matched nothing and inserted a SECOND row for
 * the same document — a re-ingest of 4 050 invoices added 4 050 rows and left
 * 3 227 filenames duplicated. Refresh is not an edge case: payment state keeps
 * changing, so this is the normal operating mode of the money lane.
 *
 * The schemas declared `doc_identity: "@filename"` all along; nothing evaluated
 * it (the string does not appear in the ingest at all). These cases make that
 * declaration behaviour, and — just as importantly — pin the FAIL-SAFE: the
 * rekey happens only when it is unambiguous, so a genuinely different document
 * that happens to share a filename can never overwrite another one.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("li_upsert_source_registry — filename identity");
});

describe("registry upsert — refresh of the same document", () => {
  it.skipIf(!dbAvailable)("updates in place instead of duplicating", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE
  v_res jsonb; v_cnt int; v_sha text; v_unpaid text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- první stažení: doklad bez stavu úhrady
  v_res := public.li_upsert_source_registry(jsonb_build_array(jsonb_build_object(
    'source_sha256','aaaa1111', 'source_slug','doc-test1', 'filename','invoice-TEST1-abcdef12.json',
    'doc_type','invoice', 'status','AUTO_PASS',
    'fields', jsonb_build_object('invoice_number', jsonb_build_object('value','TEST1'))
  )), 'exp-1', 'test', true);

  -- druhé stažení TÉHOŽ dokladu, bohatší → JINÝ obsah → jiný sha
  v_res := public.li_upsert_source_registry(jsonb_build_array(jsonb_build_object(
    'source_sha256','bbbb2222', 'source_slug','doc-test1', 'filename','invoice-TEST1-abcdef12.json',
    'doc_type','invoice', 'status','AUTO_PASS',
    'fields', jsonb_build_object('invoice_number', jsonb_build_object('value','TEST1'),
                                 'amount_unpaid',  jsonb_build_object('value','1500'))
  )), 'exp-2', 'test', true);

  SELECT count(*) INTO v_cnt FROM public.li_source_registry
   WHERE filename = 'invoice-TEST1-abcdef12.json';
  IF v_cnt <> 1 THEN
    RAISE 'refresh duplikoval doklad: % řádků se stejným jménem', v_cnt;
  END IF;

  SELECT source_sha256, fields->'amount_unpaid'->>'value' INTO v_sha, v_unpaid
    FROM public.li_source_registry
   WHERE filename = 'invoice-TEST1-abcdef12.json';
  IF v_sha <> 'bbbb2222' THEN RAISE 'řádek se nepřeklíčoval na nový obsah: %', v_sha; END IF;
  -- a hlavně: nová pravda o platbě je NA TOM ŘÁDKU, ne v osiřelém duplikátu
  IF v_unpaid IS DISTINCT FROM '1500' THEN RAISE 'nová pole nedorazila: %', v_unpaid; END IF;

  -- audit musí refresh odlišit od replaye beze změny
  IF (v_res->>'rekeyed')::int < 1 THEN RAISE 'rekey se nezapočítal: %', v_res; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("replay of an unchanged export changes nothing", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v_cnt int; v_res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR i IN 1..2 LOOP
    v_res := public.li_upsert_source_registry(jsonb_build_array(jsonb_build_object(
      'source_sha256','cccc3333', 'source_slug','doc-test2', 'filename','invoice-TEST2-abcdef12.json',
      'doc_type','invoice', 'status','AUTO_PASS')), 'exp-same', 'test', true);
  END LOOP;
  SELECT count(*) INTO v_cnt FROM public.li_source_registry
   WHERE filename = 'invoice-TEST2-abcdef12.json';
  IF v_cnt <> 1 THEN RAISE 'replay vyrobil % řádků', v_cnt; END IF;
  -- beze změny obsahu se nic nepřeklíčovává
  IF (v_res->>'rekeyed')::int <> 0 THEN RAISE 'replay hlásí rekey: %', v_res; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("refuses to rekey when the filename is ambiguous", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v_cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- dva RŮZNÉ dokumenty téhož jména už v registru (historický stav)
  INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, filename, status)
  VALUES ('dddd4444','s1','invoice','invoice-DUP-abcdef12.json','AUTO_PASS'),
         ('eeee5555','s2','invoice','invoice-DUP-abcdef12.json','AUTO_PASS');

  PERFORM public.li_upsert_source_registry(jsonb_build_array(jsonb_build_object(
    'source_sha256','ffff6666', 'source_slug','doc-dup', 'filename','invoice-DUP-abcdef12.json',
    'doc_type','invoice', 'status','AUTO_PASS')), 'exp-3', 'test', true);

  -- Nesmí přepsat ANI JEDEN z nich — dvojznačnost se řeší starou cestou
  -- (nový řádek), nikdy hádáním, který z dvojice je "ten pravý".
  IF NOT EXISTS (SELECT 1 FROM public.li_source_registry WHERE source_sha256='dddd4444')
     OR NOT EXISTS (SELECT 1 FROM public.li_source_registry WHERE source_sha256='eeee5555') THEN
    RAISE 'rekey přepsal doklad při dvojznačném jménu';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.li_source_registry
   WHERE filename = 'invoice-DUP-abcdef12.json';
  IF v_cnt <> 3 THEN RAISE 'čekány 3 řádky (2 staré + 1 nový), je %', v_cnt; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("refuses to rekey onto a hash another document already owns", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, filename, status)
  VALUES ('1111aaaa','s1','invoice','invoice-A-abcdef12.json','AUTO_PASS'),
         ('2222bbbb','s2','invoice','invoice-B-abcdef12.json','AUTO_PASS');

  -- doklad A se "refreshne" na obsah, který UŽ patří dokladu B (stejný obsah,
  -- jiné jméno). Rekey by porušil unique — musí ustoupit, ne spadnout.
  PERFORM public.li_upsert_source_registry(jsonb_build_array(jsonb_build_object(
    'source_sha256','2222bbbb', 'source_slug','doc-a', 'filename','invoice-A-abcdef12.json',
    'doc_type','invoice', 'status','AUTO_PASS')), 'exp-4', 'test', true);

  IF NOT EXISTS (SELECT 1 FROM public.li_source_registry
                  WHERE source_sha256='1111aaaa'
                    AND filename='invoice-A-abcdef12.json') THEN
    RAISE 'doklad A byl překlíčován na cizí hash';
  END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});

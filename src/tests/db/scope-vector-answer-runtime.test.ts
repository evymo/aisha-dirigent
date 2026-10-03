import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Scope vector × answer path — RUNTIME tests against a real cold-started DB
 * (throwaway pg17 via `npm run test:db`).
 *
 * What these prove is not "the functions exist" but the three properties the
 * mechanism was built for (owner's brief 2026-07-30: "solve it as a vector and
 * record it in the system, or we get noise and we handle responsibility badly"):
 *
 *   1. NO SILENT NARROWING — a malformed vector raises instead of answering
 *      unscoped, and a coordinate the substrate cannot vouch for is reported,
 *      not quietly honoured.
 *   2. NO SECOND SOURCE OF TRUTH — an explicit scope BEATS the wording of the
 *      question. This is the measured noise the change exists to kill: the
 *      answerer used to pick a company by matching label tokens against the
 *      question text, so a question mentioning another firm hijacked the answer.
 *   3. THE RUN IS RECORDED — ai_runs + ai_trace_events carry the vector, so the
 *      answer stays attributable; and a caller that sends NO scope gets the
 *      byte-identical envelope it got before the field existed (deploy order of
 *      core vs surface must not be able to break a client).
 *
 * Identity matters to the measurement itself: scope_effective is SECURITY
 * INVOKER, so the same vector resolves differently for a superuser than for a
 * plain `authenticated` reader. Both are exercised — measuring only as the owner
 * would hide exactly the fail-closed drop that makes the lens honest.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("scope vector × answer path");
});

describe("scope_normalize — canonical form, strict on garbage", () => {
  it.skipIf(!dbAvailable)("validates, sanitises, dedups by origin rank and sorts", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE v_out jsonb; v_err text;
BEGIN
  -- empty forms
  IF public.scope_normalize(NULL) <> '[]'::jsonb THEN RAISE 'NULL scope must be empty vector'; END IF;
  IF public.scope_normalize('{}'::jsonb) <> '[]'::jsonb THEN RAISE 'empty object must be empty vector'; END IF;

  -- a non-array is a caller bug and must say so
  BEGIN
    PERFORM public.scope_normalize('"company"'::jsonb);
    RAISE 'a scalar scope must raise';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- guessed coordinates may never claim certainty
  BEGIN
    PERFORM public.scope_normalize('[{"dim":"company","value":"x","origin":"guessed_from_text","confidence":1}]'::jsonb);
    RAISE 'guessed_from_text with confidence 1 must raise';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- a derivation must state how sure it is
  BEGIN
    PERFORM public.scope_normalize('[{"dim":"area","value":"najmy","origin":"derived"}]'::jsonb);
    RAISE 'derived without confidence must raise';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- a dim is a slug
  BEGIN
    PERFORM public.scope_normalize('[{"dim":"Company X","value":"a"}]'::jsonb);
    RAISE 'non-slug dim must raise';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- caller-claimed resolver is stripped: being vouched for is not self-declared
  v_out := public.scope_normalize('[{"dim":"area","value":"najmy","resolver":"twin"}]'::jsonb);
  IF v_out->0 ? 'resolver' THEN RAISE 'caller-supplied resolver survived: %', v_out; END IF;

  -- dedup: the human pick outranks a very confident derivation, and dims sort
  v_out := public.scope_normalize($j$[
    {"dim":"object","value":"o1"},
    {"dim":"company","value":"derived-one","origin":"derived","confidence":0.99},
    {"dim":"company","value":"picked-one","origin":"user_pick"}
  ]$j$::jsonb);
  IF jsonb_array_length(v_out) <> 2 THEN RAISE 'expected 2 coordinates, got %', v_out; END IF;
  IF v_out->0->>'dim' <> 'company' OR v_out->1->>'dim' <> 'object' THEN RAISE 'not sorted by dim: %', v_out; END IF;
  IF v_out->0->>'value' <> 'picked-one' THEN RAISE 'derivation overruled the user pick: %', v_out; END IF;
END $$;
`);
    expect(run).not.toThrow();
  });
});

describe("scope_effective — single owner of the rule, no existence oracle", () => {
  it.skipIf(!dbAvailable)("vouches by shape and type, passes slugs through, drops the rest", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE
  v_co uuid; v_veh uuid; v_res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company','Scope Test a.s.') RETURNING id INTO v_co;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('vehicle','Scope Test vozidlo') RETURNING id INTO v_veh;

  -- a real company uuid under dim=company is vouched by the twin substrate
  v_res := public.scope_effective(jsonb_build_array(
             jsonb_build_object('dim','company','value',v_co::text)));
  IF v_res->'effective'->0->>'resolver' <> 'twin' THEN RAISE 'company twin not vouched: %', v_res; END IF;

  -- the SAME uuid under dim=object is not an object: relabeling one node as
  -- another would title an answer with the wrong node
  v_res := public.scope_effective(jsonb_build_array(
             jsonb_build_object('dim','object','value',v_co::text)));
  IF jsonb_array_length(v_res->'effective') <> 0 THEN RAISE 'type mismatch was accepted: %', v_res; END IF;
  IF v_res->'dropped'->0->>'reason' <> 'not_visible' THEN RAISE 'wrong drop reason: %', v_res; END IF;

  -- a vehicle uuid under dim=company: same single reason, no oracle
  v_res := public.scope_effective(jsonb_build_array(
             jsonb_build_object('dim','company','value',v_veh::text)));
  IF v_res->'dropped'->0->>'reason' <> 'not_visible' THEN RAISE 'cross-type leak: %', v_res; END IF;

  -- an absent uuid is indistinguishable from a forbidden one
  v_res := public.scope_effective(jsonb_build_array(
             jsonb_build_object('dim','company','value',gen_random_uuid()::text)));
  IF v_res->'dropped'->0->>'reason' <> 'not_visible' THEN RAISE 'missing row got its own reason: %', v_res; END IF;

  -- a slug axis has no substrate yet: passed through, marked unverified, never
  -- silently dropped (a dropped axis would kill the area lens)
  v_res := public.scope_effective('[{"dim":"area","value":"najmy","origin":"derived","confidence":0.8}]'::jsonb);
  IF v_res->'effective'->0->>'resolver' <> 'none' THEN RAISE 'slug coordinate not passed through: %', v_res; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("resolves differently for a plain authenticated reader (fail-closed)", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
-- Seeded as the owner (RLS bypassed), then measured as a plain reader. Measuring
-- only as the owner is the mistake this case exists to prevent: the drop that
-- makes the lens honest is invisible from a role that bypasses RLS.
INSERT INTO public.twin_entities (id, entity_type, label)
VALUES ('11111111-1111-4111-8111-111111111111','company','RLS Scope Test a.s.');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}', true);

DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.scope_effective(
    '[{"dim":"company","value":"11111111-1111-4111-8111-111111111111"}]'::jsonb);
  -- No relation, no roles → the twin is not visible, so the coordinate cannot be
  -- honoured. It is REPORTED, not applied: that is the difference between a lens
  -- and a lie. (If a future policy grants plain readers twin access, this case
  -- must be revisited deliberately — it is pinning behaviour, not spelling.)
  IF jsonb_array_length(v_res->'effective') <> 0 THEN
    RAISE 'an invisible twin was honoured as scope: %', v_res;
  END IF;
  IF v_res->'dropped'->0->>'reason' <> 'not_visible' THEN
    RAISE 'expected not_visible drop, got %', v_res;
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});

describe("answer path — the vector wins over the wording, and the run is recorded", () => {
  it.skipIf(!dbAvailable)("explicit scope beats a company named in the question text", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE
  v_a uuid; v_b uuid; v_obj uuid; v_ans jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company','ALFAKORP a.s.')  RETURNING id INTO v_a;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company','BETAKORP a.s.')  RETURNING id INTO v_b;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('object','Mlynarska hala')  RETURNING id INTO v_obj;

  INSERT INTO public.twin_events (event_type, twin_id, place_twin_id, occurred_at, attrs, source)
  VALUES ('lease', v_a, v_obj, now(), '{"annual_rent_czk": 120000}'::jsonb, 'test'),
         ('lease', v_b, v_obj, now(), '{"annual_rent_czk": 999000}'::jsonb, 'test');

  -- The question names BETAKORP; the reader is standing on ALFAKORP.
  v_ans := public.answer_verified_facts(
             'kolik plati najem BETAKORP',
             'strucny',
             jsonb_build_array(jsonb_build_object('dim','company','value',v_a::text)));

  IF v_ans->>'answer' NOT LIKE '%ALFAKORP%' THEN
    RAISE 'the question text hijacked the scope: %', v_ans->>'answer';
  END IF;
  IF v_ans->>'answer' LIKE '%BETAKORP%' THEN
    RAISE 'answer leaked the company from the wording: %', v_ans->>'answer';
  END IF;

  -- and the vector it answered under is reported back, with its origin
  IF v_ans->'scope'->0->>'origin' <> 'user_pick' THEN
    RAISE 'scope origin not carried: %', v_ans->'scope';
  END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("a guess is admitted only as a guess", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v_a uuid; v_obj uuid; v_ans jsonb; v_c jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company','GAMAKORP a.s.') RETURNING id INTO v_a;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('object','Hala G') RETURNING id INTO v_obj;
  INSERT INTO public.twin_events (event_type, twin_id, place_twin_id, occurred_at, attrs, source)
  VALUES ('lease', v_a, v_obj, now(), '{"annual_rent_czk": 50000}'::jsonb, 'test');

  -- No scope sent: the text guess still fills the dimension (that behaviour is
  -- useful), but it must be LABELLED as a guess with confidence < 1 — otherwise
  -- a month later nobody can tell a choice from a regex over a sentence.
  v_ans := public.answer_verified_facts('kolik plati najem GAMAKORP', 'strucny');
  SELECT c INTO v_c FROM jsonb_array_elements(v_ans->'scope') c WHERE c->>'dim' = 'company';
  IF v_c IS NULL THEN RAISE 'guessed coordinate was not recorded at all: %', v_ans->'scope'; END IF;
  IF v_c->>'origin' <> 'guessed_from_text' THEN RAISE 'guess not labelled: %', v_c; END IF;
  IF (v_c->>'confidence')::numeric >= 1 THEN RAISE 'guess claims certainty: %', v_c; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("get_answer_block records the run with its vector and story", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE
  v_a uuid; v_obj uuid; v_block jsonb; v_run uuid; v_ev int; v_story uuid; v_meta jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company','DELTAKORP a.s.') RETURNING id INTO v_a;
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('object','Hala D') RETURNING id INTO v_obj;
  INSERT INTO public.twin_events (event_type, twin_id, place_twin_id, occurred_at, attrs, source)
  VALUES ('lease', v_a, v_obj, now(), '{"annual_rent_czk": 70000}'::jsonb, 'test');

  v_block := public.get_answer_block(jsonb_build_object(
    'question', 'kolik plati najem',
    'scope', jsonb_build_array(jsonb_build_object('dim','company','value',v_a::text))));

  -- the envelope carries what was asked and what survived
  IF v_block->'provenance'->'scope_requested' IS NULL THEN RAISE 'scope_requested missing: %', v_block->'provenance'; END IF;
  IF v_block->'provenance'->'scope_effective'->0->>'resolver' <> 'twin' THEN RAISE 'scope_effective missing/unvouched: %', v_block->'provenance'; END IF;
  IF v_block->'provenance'->>'run_id' IS NULL THEN RAISE 'no run recorded: %', v_block->'provenance'; END IF;

  -- the source stopped being thrown away in the last step
  IF coalesce(v_block->'data'->'rows'->0->>'zdroj','') = '' THEN RAISE 'source not surfaced beside the answer: %', v_block->'data'; END IF;

  -- and the record is real: run + step + story anchor + the vector in metadata
  v_run := (v_block->'provenance'->>'run_id')::uuid;
  SELECT story_id, metadata INTO v_story, v_meta FROM public.ai_runs WHERE id = v_run;
  IF v_story IS NULL THEN RAISE 'run has no story — ai_runs.story_id is NOT NULL for a reason'; END IF;
  IF v_meta->'scope' IS NULL THEN RAISE 'the vector did not reach the run record: %', v_meta; END IF;

  SELECT count(*) INTO v_ev FROM public.ai_trace_events WHERE run_id = v_run;
  IF v_ev < 1 THEN RAISE 'run recorded without a step — reads as "created and died"'; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("without a scope the envelope stays byte-compatible with older bundles", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v_keys text; v_block jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_block := public.get_answer_block('{"question":"kolik plati najem"}'::jsonb);
  SELECT string_agg(k, ',' ORDER BY k) INTO v_keys
  FROM jsonb_object_keys(v_block->'provenance') k;
  -- Ajv on the client is all-or-nothing: one unknown provenance key invalidates
  -- the WHOLE block and the screen says "data could not be loaded". Surfaces
  -- deploy on their own cadence, so a caller that did not ask for a scope must
  -- keep receiving exactly the three legacy keys.
  IF v_keys <> 'freshness_at,source_slug,trace_id' THEN
    RAISE 'unscoped envelope grew new keys (breaks deployed bundles): %', v_keys;
  END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("a malformed vector fails the block instead of answering unscoped", () => {
    expect(() =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.get_answer_block('{"question":"kolik plati najem","scope":"company"}'::jsonb);
END $$;
`),
    ).toThrow();
  });
});

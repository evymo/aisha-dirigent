import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * T1 task_kind taxonomy RUNTIME tests against a real cold-started DB (`npm run test:db`) —
 * the runtime counterpart to tests/gates/task-kind-normalization.gate.test.ts (structural).
 *
 * Proves: normalize_task_kind is idempotent + collapses dirty input (and defaults empty→chat);
 * fn_observe_task_kind normalizes + upserts (bumps sample_count) and is fail-closed for an
 * unauthenticated caller (42501). Repeatable: random probe kind, cleaned up.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("task_kind taxonomy (T1)");
});

describe("normalize_task_kind — pure normalizer (local DB)", () => {
  it.skipIf(!dbAvailable)("lowercases, trims, collapses whitespace, defaults empty→chat", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  IF public.normalize_task_kind('Chat ')      <> 'chat'        THEN RAISE EXCEPTION 'trim/lower failed: %', public.normalize_task_kind('Chat '); END IF;
  IF public.normalize_task_kind('multi step') <> 'multi_step'  THEN RAISE EXCEPTION 'ws-collapse failed: %', public.normalize_task_kind('multi step'); END IF;
  IF public.normalize_task_kind('')           <> 'chat'        THEN RAISE EXCEPTION 'empty default failed'; END IF;
  IF public.normalize_task_kind(NULL)         <> 'chat'        THEN RAISE EXCEPTION 'null default failed'; END IF;
  IF public.normalize_task_kind('chat')       <> 'chat'        THEN RAISE EXCEPTION 'idempotency failed'; END IF;
  IF public.normalize_task_kind('classification') <> 'classification' THEN RAISE EXCEPTION 'existing-vocab no-op failed'; END IF;
END $$;
`);
    expect(run).not.toThrow();
  });
});

describe("fn_observe_task_kind — observed registry upsert (local DB)", () => {
  it.skipIf(!dbAvailable)("normalizes + upserts, bumping sample_count on conflict", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_kind text := 'Gate Probe ' || substr(md5(random()::text), 1, 8);  -- has caps + space → must normalize
  v_norm text;
  v_c1 bigint;
  v_c2 bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_norm := public.fn_observe_task_kind(v_kind, 2);
  IF v_norm <> public.normalize_task_kind(v_kind) THEN RAISE EXCEPTION 'observe did not return normalized kind: %', v_norm; END IF;

  SELECT sample_count INTO v_c1 FROM public.ai_task_kind_registry WHERE task_kind = v_norm;
  IF v_c1 <> 2 THEN RAISE EXCEPTION 'first observe sample_count wrong: %', v_c1; END IF;

  PERFORM public.fn_observe_task_kind(v_kind, 3);  -- same normalized key → upsert bump
  SELECT sample_count INTO v_c2 FROM public.ai_task_kind_registry WHERE task_kind = v_norm;
  IF v_c2 <> 5 THEN RAISE EXCEPTION 'upsert bump wrong (expected 5): %', v_c2; END IF;

  DELETE FROM public.ai_task_kind_registry WHERE task_kind = v_norm;  -- repeatable cleanup
END $$;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("is fail-closed: an unauthenticated caller cannot record", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);  -- no uid, no service_role
  BEGIN
    PERFORM public.fn_observe_task_kind('x_unauth_probe', 1);
    RAISE EXCEPTION 'T1-VIOLATION: unauthenticated observe was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501 expected → contract holds
  END;
END $$;
`);
    expect(run).not.toThrow();
  });
});

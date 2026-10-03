import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { HEADER, SERVICE_CLAIMS } from "./_e2e-spine";

/**
 * S5 (DB part) — Executor `cli` enqueue + I1 journal against a real DB.
 *
 * fn_spawn_claude_cli_run runs admission internally, mints the I1 decision (ai_decisions.runtime='cli'),
 * and enqueues an agent_runs row (kind='claude_cli_task', status='queued') with the decision_id threaded.
 * The real Docker execution + the approve/claim path are acceptance-level (svc-agent-runner) — see the
 * runbook; here we prove the deterministic DB lifecycle: spawn → queued + journaled.
 *
 * Repeatable: unique inputs + cleanup.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("S5 cli agent-run lifecycle");
});

describe("S5 — fn_spawn_claude_cli_run enqueue + journal (local DB)", () => {
  it.skipIf(!dbAvailable)("spawns a queued claude_cli_task with an I1 cli decision threaded", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_story uuid := gen_random_uuid();
  v_agent uuid;
  v_kind  text;
  v_status text;
  v_dec   uuid;
  v_runtime text;
BEGIN
  ${SERVICE_CLAIMS}

  v_agent := public.fn_spawn_claude_cli_run(
    'e2e-image',                                                   -- p_image (non-empty → agent_runs.image NOT NULL ok)
    'e2e-source',                                                  -- p_source
    jsonb_build_object('prompt', 'e2e cli task', 'story_id', v_story),
    'kata-dragonball',                                             -- p_profile (valid agent_runs.profile)
    NULL, NULL, 'claude-cli');                                     -- p_source_ref, p_max_inflight, p_cli_slug
  IF v_agent IS NULL THEN RAISE EXCEPTION 'S5: spawn returned null'; END IF;

  SELECT kind, status, decision_id INTO v_kind, v_status, v_dec FROM public.agent_runs WHERE id = v_agent;
  IF v_kind   <> 'claude_cli_task' THEN RAISE EXCEPTION 'S5: kind % (want claude_cli_task)', v_kind; END IF;
  IF v_status <> 'queued'          THEN RAISE EXCEPTION 'S5: status % (want queued)', v_status; END IF;
  IF v_dec IS NULL                 THEN RAISE EXCEPTION 'S5: missing I1 decision_id on agent_runs'; END IF;

  SELECT runtime INTO v_runtime FROM public.ai_decisions WHERE id = v_dec;
  IF v_runtime <> 'cli' THEN RAISE EXCEPTION 'S5: journaled decision runtime % (want cli)', v_runtime; END IF;

  -- cleanup (children/refs first)
  DELETE FROM public.agent_runs   WHERE id = v_agent;
  DELETE FROM public.ai_decisions WHERE id = v_dec;
END $$;
`);
    expect(run).not.toThrow();
  });
});

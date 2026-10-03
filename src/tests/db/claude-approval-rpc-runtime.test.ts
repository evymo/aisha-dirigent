import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * claude_cli_task ADMISSION + APPROVAL flow — real-DB runtime test.
 *
 * Proves the governance chain the CLI-runtime unification adds, end-to-end against
 * a real Postgres (throwaway pg17 via `npm run test:db`, which IS in CI):
 *   fn_spawn_claude_cli_run → fn_admit_clow ('ask' for an irreversible+egress+write
 *   CLI run) → run created HELD (approval_required + approved_at IS NULL) + I1
 *   journal (ai_decisions via fn_record_execution_decision, threaded onto
 *   agent_runs.decision_id) → claim_queued_claude_run SKIPS the held run →
 *   approve_claude_run (admin + segregation of duties) clears the hold →
 *   claim_queued_claude_run now claims it.
 *
 * RAISE inside the DO block → non-zero psql exit → execFileSync throws → test fails.
 */

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Claude Run Approval RPC Runtime");
});

const HEADER = "\\set ON_ERROR_STOP on\n";

// Shared fixture preamble: a requester (any user) + a DISTINCT admin approver
// (a seeded admin if present, else grant a 2nd user the admin role for the test).
const FIXTURE = `
  -- requester = a GUARANTEED non-admin user (so the admin-gate test is meaningful);
  -- approver = a DISTINCT admin/staff user.
  SELECT u.id INTO v_user FROM aisha_auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role IN ('admin','staff'))
    ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'fixture: no non-admin user seeded'; END IF;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
    WHERE ur.role IN ('admin','staff') AND ur.user_id <> v_user ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture: no distinct admin/staff user seeded'; END IF;
`;

describe("claude_cli_task admission + approval flow (local DB)", () => {
  it.skipIf(!dbAvailable)(
    "ask → HELD run + I1 journal; claim skips held; approve → claimable",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user uuid; v_admin uuid; v_run uuid;
  v_status text; v_appr boolean; v_appr_at timestamptz; v_dec uuid; v_dec_n int; v_claimed int;
BEGIN
  ${FIXTURE}

  -- spawn as the requester → fn_admit_clow returns 'ask' (cli runtime is
  -- irreversible + needs egress + write ⇒ critical risk ⇒ ask under the builtin band)
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_run := public.fn_spawn_claude_cli_run('', 'db-test', jsonb_build_object('prompt','do the thing'), 'kata-dragonball', NULL, NULL);

  -- the run is HELD with a journaled decision threaded onto it
  SELECT status, approval_required, approved_at, decision_id
    INTO v_status, v_appr, v_appr_at, v_dec
    FROM public.agent_runs WHERE id = v_run;
  IF v_status <> 'queued' OR v_appr IS NOT TRUE OR v_appr_at IS NOT NULL OR v_dec IS NULL THEN
    RAISE EXCEPTION 'expected HELD run, got status=% appr=% appr_at=% dec=%', v_status, v_appr, v_appr_at, v_dec;
  END IF;
  SELECT count(*) INTO v_dec_n FROM public.ai_decisions
    WHERE id = v_dec AND runtime = 'cli' AND cli_slug = 'claude-cli'
      AND admission_verdict = 'ask' AND approval_required IS TRUE;
  IF v_dec_n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 ai_decisions ask row, got %', v_dec_n; END IF;

  -- backdate so the claim's grace window (created_at < now()) can't mask the hold
  UPDATE public.agent_runs SET created_at = now() - interval '1 hour' WHERE id = v_run;

  -- the poller must NOT claim THE HELD run. Scope the assertion to v_run:
  -- parallel test files (agent-run-wake-notify) legitimately insert their own
  -- claimable claude_cli_task rows into the shared throwaway DB, so an
  -- unscoped count() races against them (observed flake: "expected 0, got 1").
  SELECT count(*) INTO v_claimed FROM public.claim_queued_claude_run(0) c WHERE c.id = v_run;
  IF v_claimed <> 0 THEN RAISE EXCEPTION 'held run was claimed (expected 0), got %', v_claimed; END IF;

  -- approve as a DISTINCT admin → clears the hold
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.approve_claude_run(v_run);
  SELECT approved_at INTO v_appr_at FROM public.agent_runs WHERE id = v_run;
  IF v_appr_at IS NULL THEN RAISE EXCEPTION 'approve_claude_run did not set approved_at'; END IF;

  -- now the poller claims it: v_run is backdated 1h, so it is the OLDEST
  -- claimable row and claim (oldest-first, LIMIT 1) must return exactly it.
  SELECT count(*) INTO v_claimed FROM public.claim_queued_claude_run(0) c WHERE c.id = v_run;
  IF v_claimed <> 1 THEN RAISE EXCEPTION 'approved run not claimed (expected 1), got %', v_claimed; END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "approve_claude_run enforces admin gate + segregation of duties; list_pending is admin-gated + held-only",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user uuid; v_admin uuid; v_run uuid; v_n int; v_blocked boolean;
BEGIN
  ${FIXTURE}

  -- a held run owned by the admin (so we can test self-approval = segregation)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_run := public.fn_spawn_claude_cli_run('', 'db-test-sod', jsonb_build_object('prompt','x'), 'kata-dragonball', NULL, NULL);

  -- self-approval is refused (approver must differ from requester)
  v_blocked := false;
  BEGIN PERFORM public.approve_claude_run(v_run); EXCEPTION WHEN OTHERS THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'segregation of duties NOT enforced (self-approval allowed)'; END IF;

  -- a non-admin cannot approve
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_blocked := false;
  BEGIN PERFORM public.approve_claude_run(v_run); EXCEPTION WHEN OTHERS THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'admin gate NOT enforced (non-admin approved)'; END IF;

  -- list_pending_claude_approvals: admin sees the held run...
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT count(*) INTO v_n FROM public.list_pending_claude_approvals() WHERE run_id = v_run;
  IF v_n <> 1 THEN RAISE EXCEPTION 'admin inbox missing the held run (got %)', v_n; END IF;

  -- ...a non-admin is refused
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_blocked := false;
  BEGIN PERFORM count(*) FROM public.list_pending_claude_approvals(); EXCEPTION WHEN OTHERS THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'list_pending_claude_approvals NOT admin-gated'; END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "service_role spawn (no human requester) succeeds with NULL requested_by",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_run uuid; v_req uuid;
BEGIN
  -- the reflection cli adapter / svc-agent-runner POST call fn_spawn under
  -- service_role (auth.uid() IS NULL). The PG role GUC (fn_runtime_available) AND the
  -- jwt-claims role (fn_record_execution_decision) must both read service_role; the
  -- service_role grant must let the call through; requested_by must be NULL-tolerant.
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_run := public.fn_spawn_claude_cli_run('', 'svc-spawn', jsonb_build_object('prompt','y'), 'kata-dragonball', NULL, NULL);
  SELECT requested_by INTO v_req FROM public.agent_runs WHERE id = v_run;
  IF v_req IS NOT NULL THEN RAISE EXCEPTION 'service_role spawn should have NULL requested_by, got %', v_req; END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );

  it.skipIf(!dbAvailable)(
    "update_agent_run_status persists p_outputs (and is a single 8-arg overload — no ambiguity)",
    () => {
      const run = () =>
        psqlMultiline(`${HEADER}
DO $$
DECLARE
  v_user uuid; v_admin uuid; v_run uuid; v_ov int; v_outputs jsonb; v_status text; v_fin boolean;
BEGIN
  ${FIXTURE}
  -- the p_outputs signature change DROPped the old 7-arg overload → exactly one remains
  SELECT count(*) INTO v_ov FROM pg_proc WHERE proname = 'update_agent_run_status';
  IF v_ov <> 1 THEN RAISE EXCEPTION 'expected exactly 1 update_agent_run_status overload, got %', v_ov; END IF;

  -- finalize a run WITH p_outputs → the structured result lands in agent_runs.outputs
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_run := public.fn_spawn_claude_cli_run('', 'db-outputs', jsonb_build_object('prompt','z'), 'kata-dragonball', NULL, NULL);
  PERFORM public.update_agent_run_status(v_run, 'succeeded', 0, NULL, NULL, 'host', NULL,
    '{"result":{"ok":true,"run_id":"z","exit_code":0},"result_valid":true}'::jsonb);
  SELECT status, outputs, finished_at IS NOT NULL INTO v_status, v_outputs, v_fin
    FROM public.agent_runs WHERE id = v_run;
  IF v_status <> 'succeeded' OR (v_outputs->>'result_valid')::boolean IS NOT TRUE OR NOT v_fin THEN
    RAISE EXCEPTION 'p_outputs not persisted: status=% outputs=% finished=%', v_status, v_outputs, v_fin;
  END IF;
END $$;
`);
      expect(run).not.toThrow();
    },
  );
});

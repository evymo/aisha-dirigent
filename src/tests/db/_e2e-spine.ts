/**
 * S0 — shared DB-level E2E spine for the orchestration "organism" tests.
 *
 * The S1/S5/S8/S9 db tests drive the decision → journal → trace → outcome chain over a throwaway
 * pg17 (`npm run test:db`) and assert each hop (correctness + a number). This module centralizes the
 * shared SQL preamble and the authentication contract so every scenario seeds valid data uniformly.
 *
 * AUTH CONTRACT (why both 'sub' and role): the orchestration RPCs use two different guards —
 *   - claims-role based (fn_admit_clow, insert_model_benchmark, fn_observe_task_kind,
 *     record_model_reliability): check request.jwt.claims->>'role'.
 *     (NOTE: a few writers — e.g. fn_record_proposal_outcome, claim_queued_claude_run — gate on the
 *      Postgres role GUC current_setting('role') instead; those are acceptance-level, not used here.)
 *   - auth.uid()/role-GUC based (aisha_resolve_clow_backend, record_model_benchmark,
 *     fn_record_execution_decision, fn_spawn_claude_cli_run): pass when auth.uid() IS NOT NULL.
 * Setting BOTH a 'sub' (→ auth.uid() non-null) AND role=service_role in request.jwt.claims satisfies
 * every guard WITHOUT `SET ROLE` (which would forfeit the superuser RLS-bypass the psql test
 * connection relies on for seeding).
 *
 * SEED CONTRACT (verified against SoT):
 *   - ai_provider_registry: required (slug, display_name, backend_kind, auth_kind); set
 *     is_enabled=true + last_health_status IN ('healthy','unknown') or the resolver excludes it.
 *   - ai_model_registry: required (provider, model_id); chat models keep default is_chat_capable=true,
 *     eval_status default 'pending' (NOT 'rejected') so the resolver admits them.
 *   - ai_runs.story_id is NOT NULL (§16) — always seed a uuid.
 *   - ai_decisions is written ONLY via fn_record_execution_decision.
 */

export const HEADER = "\\set ON_ERROR_STOP on\n";

/** PL/pgSQL statement: authenticate the current DO block as service_role with a non-null auth.uid(). */
export const SERVICE_CLAIMS =
  "PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'service_role')::text, true);";

-- Source of Truth: create_ai_run
-- Purpose: Create a new AI run record for tracking agent execution.
--          Validates the run kind and assigns the actor user.
-- Used by: route_task (internal), ai-chat edge function, orchestrationBridge.ts
-- Migration: 20260216_aisha_phase3_router.sql (original)

-- 2026-07-30: p_estimate_usd forwarded to the admission it already calls.
-- fn_authorize_task_spend has taken a p_estimate since it was written; this
-- caller simply could not supply one, so every run was admitted against the p90
-- estimate of its KIND. For a run whose cost is known to be zero — a
-- deterministic SQL answer read out of verified facts, no model call — that
-- guess is the difference between a recorded run and no record at all: on a
-- story that is over budget, admission returns deny and the run is lost exactly
-- where accountability matters most. A caller that KNOWS its cost may now say so;
-- one that does not still gets the estimate. Denial stays possible and stays
-- meaningful (a policy may deny at 0), it just stops being a guess.
CREATE OR REPLACE FUNCTION public.create_ai_run(
  p_kind text,
  p_story_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_route_plan jsonb DEFAULT '{}'::jsonb,
  p_estimate_usd numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_authz  jsonb;
BEGIN
  -- Validate kind
  IF p_kind NOT IN (
    'chat','project_delivery','compliance_check','guild_review',
    'pr_gate','incident','doc_update'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid ai_run kind: %s', p_kind), ERRCODE = 'P0001';
  END IF;

  -- Spend admission (pre-flight). This path returns an immediately-running
  -- run (chat & friends), so ask/deny refuse LOUDLY instead of creating a
  -- blocked row (the INSERT would roll back with the exception anyway).
  -- Under catalog defaults interactive kinds (chat=micro) always allow;
  -- expensive kinds launched here surface a clear actionable error.
  v_authz := public.fn_authorize_task_spend(p_kind, p_story_id, p_estimate_usd);
  IF v_authz->>'decision' IN ('ask', 'deny') THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'spend_%s: kind %s estimate $%s (%s) — adjust ai_spend_policies or use the workflow path for Mission Control approval',
        v_authz->>'decision', p_kind,
        COALESCE(v_authz->>'estimate_used', '?'),
        v_authz->>'reason'),
      ERRCODE = 'P0001';
  END IF;

  INSERT INTO ai_runs (kind, story_id, actor_user_id, route_plan, status)
  VALUES (p_kind, p_story_id, COALESCE(p_actor_user_id, auth.uid()), p_route_plan, 'running')
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$function$;

-- Permissions. The 4-arg signature is DROPPED in heals before this file runs:
-- leaving both would make every 4-argument call ambiguous ("function is not
-- unique"), which is how an added default parameter breaks a working caller.
REVOKE ALL ON FUNCTION public.create_ai_run(text, uuid, uuid, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ai_run(text, uuid, uuid, jsonb, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ai_run(text, uuid, uuid, jsonb, numeric) TO service_role;

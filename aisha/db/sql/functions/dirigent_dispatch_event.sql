-- Function: public.dirigent_dispatch_event
-- Arguments: p_event_name text, p_payload jsonb
-- Security: SECURITY DEFINER (server-side router; service_role only)
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Purpose: Internal router called by the dirigent-supervisor edge function after
--          it receives a Claude Code hook event. Updates moderation_sessions.hook_event_log
--          (ring buffer, last 50 events) and returns the n8n playbook key for
--          the edge function to dispatch. Keeps event-to-playbook mapping in DB
--          rather than hardcoded in edge fn (easier to tune without redeploy).

CREATE OR REPLACE FUNCTION public.dirigent_dispatch_event(
  p_event_name text,
  p_payload jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_story_id uuid;
  v_user_id uuid;
  v_playbook text;
  v_priority int;
  v_existing_log jsonb;
  v_new_entry jsonb;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  -- Map event_name → n8n playbook key. Centralised so edge fn stays thin.
  v_playbook := CASE p_event_name
    WHEN 'session_start'   THEN 'briefing'
    WHEN 'prompt_submit'   THEN 'intent_advisor'
    WHEN 'pre_tool'        THEN 'compliance_pre_check'
    WHEN 'post_tool'       THEN 'compliance_enforcement'
    WHEN 'stop'            THEN 'goal_evaluator'
    ELSE NULL
  END;

  IF v_playbook IS NULL THEN
    RETURN jsonb_build_object('error', 'unknown event', 'event', p_event_name);
  END IF;

  v_story_id := nullif(p_payload->>'story_id', '')::uuid;
  v_user_id  := nullif(p_payload->>'user_id', '')::uuid;
  v_session_id := nullif(p_payload->>'session_id', '')::uuid;

  -- Find or create the moderation_sessions row keyed by Claude session id.
  -- Note: requires moderation_sessions.user_id to be nullable (see migration).
  IF v_session_id IS NOT NULL THEN
    UPDATE moderation_sessions
       SET updated_at = now()
     WHERE id = v_session_id;
  END IF;

  IF NOT FOUND OR v_session_id IS NULL THEN
    INSERT INTO moderation_sessions (id, story_id, user_id, session_type, expertise_level, tech_stack, status, metadata)
    VALUES (
      coalesce(v_session_id, gen_random_uuid()),
      v_story_id,
      v_user_id,
      'claude_code_supervised',
      coalesce(p_payload->>'expertise_level', 'intermediate'),
      coalesce(p_payload->'tech_stack', '[]'::jsonb),
      'active',
      jsonb_build_object('ide_kind', 'claude_code', 'origin', 'dirigent-supervisor')
    )
    ON CONFLICT (id) DO UPDATE
       SET updated_at = now()
    RETURNING id INTO v_session_id;
  END IF;

  -- Append event to hook_event_log (ring buffer of last 50)
  v_new_entry := jsonb_build_object(
    'event', p_event_name,
    'at', now(),
    'tool_name', p_payload->'tool_input'->>'tool_name',
    'summary', left(coalesce(p_payload->>'summary', p_payload->'tool_input'->>'command', ''), 200)
  );

  UPDATE moderation_sessions
     SET metadata = jsonb_set(
       metadata,
       '{hook_event_log}',
       (
         SELECT jsonb_agg(elem)
         FROM (
           SELECT elem FROM jsonb_array_elements(
             coalesce(metadata->'hook_event_log', '[]'::jsonb) || v_new_entry
           ) AS t(elem)
           ORDER BY (elem->>'at')::timestamptz DESC NULLS LAST
           LIMIT 50
         ) sub
       )
     ),
     updated_at = now()
   WHERE id = v_session_id;

  -- Stop event priority depends on goal evaluator outcome — set lower budget.
  v_priority := CASE p_event_name
    WHEN 'stop' THEN 1
    WHEN 'session_start' THEN 1
    ELSE 5
  END;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'playbook', v_playbook,
    'priority', v_priority,
    'event_logged', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dirigent_dispatch_event(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dirigent_dispatch_event(text, jsonb) TO service_role;

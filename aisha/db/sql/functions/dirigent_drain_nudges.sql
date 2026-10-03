-- Function: public.dirigent_drain_nudges
-- Arguments: p_story_id uuid, p_conversation_id text DEFAULT NULL, p_limit int DEFAULT 10
-- Security: SECURITY DEFINER, service_role only
-- Source: hand-authored; deploy via migration 20260524010000_dirigent_drain_nudges.sql
--
-- Purpose: Atomically SELECT + mark consumed_at on dirigent_nudges that have
--          not yet been delivered to the agent. Called by the
--          dirigent-supervisor edge fn (services/svc-ai-chat/src/routes/dirigent-supervisor.ts)
--          on every event dispatch (especially Stop) so the agent receives
--          backend-queued advisories from n8n / scheduled flows /
--          compliance engine.
--
-- Atomicity: UPDATE ... RETURNING in a single statement ensures no nudge is
--           delivered twice if two relay calls race (CTE locks via FOR UPDATE
--           SKIP LOCKED would also work; UPDATE...RETURNING with the
--           consumed_at IS NULL predicate is simpler and the worst-case
--           outcome is one nudge skipped, not duplicated — caller can retry
--           on the next Stop event).
--
-- Cold-start parity: empty result on no nudges (not NULL); caller treats as no
--           additional context to inject. RPC must remain callable even when
--           the dirigent_nudges table has 0 rows.

CREATE OR REPLACE FUNCTION public.dirigent_drain_nudges(
  p_story_id uuid,
  p_conversation_id text DEFAULT NULL,
  p_limit int DEFAULT 10
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_drained jsonb;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  -- Atomic drain: pick at most p_limit unconsumed, unexpired nudges scoped to
  -- the story (and optionally the conversation), mark consumed, return content.
  WITH picked AS (
    SELECT id
    FROM public.dirigent_nudges
    WHERE consumed_at IS NULL
      AND expires_at > now()
      AND (p_story_id IS NULL OR story_id = p_story_id)
      AND (p_conversation_id IS NULL OR conversation_id = p_conversation_id)
    ORDER BY created_at ASC
    LIMIT greatest(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  consumed AS (
    UPDATE public.dirigent_nudges n
    SET consumed_at = now()
    FROM picked
    WHERE n.id = picked.id
    RETURNING n.id, n.event_origin, n.severity, n.message, n.metadata, n.created_at
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'event_origin', event_origin,
      'severity', severity,
      'message', message,
      'metadata', metadata,
      'created_at', created_at
    )
    ORDER BY created_at ASC
  )
  INTO v_drained
  FROM consumed;

  RETURN COALESCE(v_drained, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.dirigent_drain_nudges(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dirigent_drain_nudges(uuid, text, int) TO service_role;

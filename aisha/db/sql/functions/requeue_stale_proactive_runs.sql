-- Function: requeue_stale_proactive_runs
-- Běh zabraný executorem, který se nedokončil (worker spadl mezi claim a finish),
-- by zůstal `running` napořád a akce by se nikdy nestala. Po `p_stale_seconds` ho
-- tahle funkce vrátí do `pending` — dohnání ho vezme znovu.
--
-- ⛔ Ne donekonečna: běh, na kterém executor padá opakovaně, by se vracel v kruhu.
-- Po `p_max_attempts` zabráních končí `failed` se stopou v `error_message` — je to
-- nález k přečtení, ne smyčka. `attempts` počítá claim_proactive_run(s).
--
-- Jen běhy kanálů volajícího (cizí `running` z jiných executorů se nesmí vracet).

CREATE OR REPLACE FUNCTION public.requeue_stale_proactive_runs(
  p_channels      text[],
  p_stale_seconds integer DEFAULT 600,
  p_max_attempts  integer DEFAULT 5
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  WITH s AS (
    SELECT r.id, coalesce((r.metadata ->> 'attempts')::int, 1) AS attempts
      FROM ai_proactive_runs r
      JOIN ai_proactive_trigger_definitions d ON d.id = r.trigger_definition_id
     WHERE r.status = 'running'
       AND r.started_at < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 600), 1))
       AND (d.action_config ->> 'channel') = ANY (p_channels)
     FOR UPDATE OF r SKIP LOCKED
  ), f AS (
    UPDATE ai_proactive_runs r
       SET status        = 'failed',
           completed_at  = now(),
           error_message = format('stale: executor běh %s× zabral a nedokončil', s.attempts)
      FROM s
     WHERE r.id = s.id
       AND s.attempts >= greatest(coalesce(p_max_attempts, 5), 1)
    RETURNING r.id
  ), q AS (
    UPDATE ai_proactive_runs r
       SET status     = 'pending',
           started_at = NULL,
           metadata   = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object('requeued_at', now())
      FROM s
     WHERE r.id = s.id
       AND s.attempts < greatest(coalesce(p_max_attempts, 5), 1)
    RETURNING r.id
  )
  SELECT jsonb_build_object(
           'requeued', (SELECT count(*) FROM q),
           'failed',   (SELECT count(*) FROM f))
    INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.requeue_stale_proactive_runs(text[], integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_stale_proactive_runs(text[], integer, integer) TO service_role;

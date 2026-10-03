-- Function: finish_proactive_run
-- Executor akcí po události zapíše výsledek zabraného běhu. Jen z `running` —
-- běh, který mezitím vrátil requeue_stale_proactive_runs (a zabral jiný worker),
-- se pozdním dokončením nepřepíše; volající dostane false a ví, že výsledek zahodil.
--
-- Stavy: completed | failed | skipped. `skipped` = pravidlo se vědomě neprovedlo
-- (např. chybějící příjemce není porucha transportu) — odlišitelné od `failed`.
-- `p_error_message` se ořízne; do výsledku NIKDY nepatří tajemství ani tělo zprávy.

CREATE OR REPLACE FUNCTION public.finish_proactive_run(
  p_run_id        uuid,
  p_status        text,
  p_action_taken  text  DEFAULT NULL,
  p_action_result jsonb DEFAULT NULL,
  p_error_message text  DEFAULT NULL
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('completed', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'finish_proactive_run: stav „%“ není completed | failed | skipped', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE ai_proactive_runs r
     SET status        = p_status,
         completed_at  = now(),
         duration_ms   = CASE WHEN r.started_at IS NULL THEN NULL
                              ELSE (extract(epoch FROM now() - r.started_at) * 1000)::int END,
         action_taken  = left(p_action_taken, 200),
         action_result = p_action_result,
         error_message = left(p_error_message, 1000)
   WHERE r.id = p_run_id
     AND r.status = 'running';

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_proactive_run(uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_proactive_run(uuid, text, text, jsonb, text) TO service_role;

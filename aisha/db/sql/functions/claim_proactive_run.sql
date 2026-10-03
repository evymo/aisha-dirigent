-- Function: claim_proactive_run
-- Executor akcí po události (event-worker) si ZABERE jeden běh: pending → running
-- v jedné instrukci. Dva workery, dvě doručená notify téhož běhu, restart uprostřed —
-- vždy vyhraje právě jeden (druhé UPDATE po uvolnění zámku řádku znovu vyhodnotí
-- `status = 'pending'` a nezmění nic). Proto executor nepotřebuje žádný unikátní
-- index „jeden záznam = jedna akce“: jeden běh = jedno zabrání = jedna akce.
--
-- Bere jen běhy pravidel, jejichž kanál (`action_config.channel`) volající umí.
-- Ostatní (AI akce svc-ai-chat, kanál `in_app` ze seedu) zůstanou netknuté — executor
-- je nesmí ani zabrat, ani „vyřídit“.
--
-- Vrací { run, definition } nebo NULL (už zabráno / jiný kanál / neexistuje).
-- `attempts` se počítá při zabrání: requeue_stale_proactive_runs podle něj pozná,
-- kdy přestat vracet běh, na kterém executor opakovaně padá.

CREATE OR REPLACE FUNCTION public.claim_proactive_run(
  p_run_id   uuid,
  p_worker   text,
  p_channels text[]
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

  UPDATE ai_proactive_runs r
     SET status     = 'running',
         started_at = now(),
         metadata   = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
                        'worker',     p_worker,
                        'claimed_at', now(),
                        'attempts',   coalesce((r.metadata ->> 'attempts')::int, 0) + 1)
    FROM ai_proactive_trigger_definitions d
   WHERE r.id = p_run_id
     AND r.status = 'pending'
     AND d.id = r.trigger_definition_id
     AND (d.action_config ->> 'channel') = ANY (p_channels)
  RETURNING jsonb_build_object(
    'run', jsonb_build_object(
      'id',               r.id,
      'user_id',          r.user_id,
      'source_record_id', r.source_record_id,
      'source_data',      r.source_data,
      'metadata',         r.metadata,
      'created_at',       r.created_at),
    'definition', jsonb_build_object(
      'id',            d.id,
      'name',          d.name,
      'action_type',   d.action_type,
      'source_table',  d.source_table,
      'source_event',  d.source_event,
      'action_config', d.action_config))
  INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_proactive_run(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_proactive_run(uuid, text, text[]) TO service_role;

-- Function: record_cron_proactive_run
-- Pravidla `source_event = 'CRON'` nemají zdrojový zápis, na který by se zavěsil
-- trigger — a do 2026-09-28 je nevykonával NIKDO (svc-ai-chat je čistě event-driven,
-- routu s CRON nikdo nevolá). Executor v event-workeru je bere na svůj tik: spočítá
-- poslední splatný slot podle `action_config.schedule` a zapíše běh do outboxu.
--
-- Idempotentní na (pravidlo, slot) — unikátní index uq_ai_proactive_runs_cron_slot.
-- Tik po restartu, dva executory, opakování téže minuty: slot se zapíše jednou.
-- Slot se normalizuje na UTC text, aby tentýž okamžik nedal dva různé klíče.
--
-- Principál = `created_by` pravidla (outbox je user-scoped, `user_id NOT NULL`).
-- Pravidlo bez principála se nezapíše (NULL) — pro kanály executoru to navíc
-- zakazuje omezení ai_proactive_defs_executor_principal_check už při zápisu pravidla.
--
-- Vrací id nového běhu, nebo NULL (slot už zapsán / pravidlo neplatí).

CREATE OR REPLACE FUNCTION public.record_cron_proactive_run(
  p_definition_id uuid,
  p_slot          timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_def  ai_proactive_trigger_definitions%ROWTYPE;
  v_slot text;
  v_id   uuid;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_def
    FROM ai_proactive_trigger_definitions
   WHERE id = p_definition_id
     AND is_active
     AND source_event = 'CRON';
  IF NOT FOUND OR v_def.created_by IS NULL OR p_slot IS NULL THEN
    RETURN NULL;
  END IF;

  v_slot := to_char(p_slot AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  INSERT INTO ai_proactive_runs (
    trigger_definition_id, user_id, source_record_id, source_data, status, metadata
  ) VALUES (
    v_def.id, v_def.created_by, NULL,
    jsonb_build_object('cron_slot', v_slot),
    'pending',
    jsonb_build_object(
      'source_table',  v_def.source_table,
      'source_event',  'CRON',
      'cron_slot',     v_slot,
      'dispatched_at', now())
  )
  ON CONFLICT (trigger_definition_id, ((metadata ->> 'cron_slot')))
    WHERE (metadata ? 'cron_slot')
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_cron_proactive_run(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cron_proactive_run(uuid, timestamptz) TO service_role;

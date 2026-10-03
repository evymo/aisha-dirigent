-- Function: list_cron_proactive_definitions
-- Aktivní CRON pravidla kanálů, které volající executor umí. Rozvrh je DATA pravidla
-- (`action_config.schedule`) — kdy je slot splatný, počítá executor (čisté jádro,
-- testované bez DB); zápis slotu je idempotentní v record_cron_proactive_run.
-- Pravidla bez principála se nevrací: slot by se stejně nezapsal.

CREATE OR REPLACE FUNCTION public.list_cron_proactive_definitions(
  p_channels text[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id',            d.id,
           'name',          d.name,
           'action_config', d.action_config) ORDER BY d.name), '[]'::jsonb)
    INTO v_out
    FROM ai_proactive_trigger_definitions d
   WHERE d.is_active
     AND d.source_event = 'CRON'
     AND d.created_by IS NOT NULL
     AND (d.action_config ->> 'channel') = ANY (p_channels);

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_cron_proactive_definitions(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_cron_proactive_definitions(text[]) TO service_role;

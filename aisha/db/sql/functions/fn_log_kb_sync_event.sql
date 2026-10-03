-- ============================================================================
-- Source of Truth: fn_log_kb_sync_event
-- Popis: Zaznamená výsledek jednoho KB→Ragnarok sync běhu (per change event).
--        Volá ji WF_KB_RAGNAROK_SYNC node "Log Sync Event" (ks-log-012) po
--        "AISHA Impact Evaluation". Funkce byla v workflow referencována, ale
--        nikde v repu nedefinována — každé volání tedy 404'lo (PostgREST
--        PGRST202) a bylo tiše spolknuto onError:"continueRegularOutput", takže
--        se sync event nikdy nezaznamenal.
-- Vzor:  fn_log_dev_signal — tenký doménový wrapper, který deleguje na
--        fn_log_ai_trace_event s event_type 'n8n_workflow' (validní člen
--        ai_event_type enumu, určený přímo pro n8n workflow eventy). Žádná nová
--        tabulka — využívá existující ai_trace_events telemetry spine.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (authenticated + service_role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_log_kb_sync_event(
  p_source_table text    DEFAULT NULL,
  p_source_slug  text    DEFAULT NULL,
  p_action       text    DEFAULT 'UNKNOWN',
  p_ragnarok_ok  boolean DEFAULT NULL,
  p_severity     text    DEFAULT 'MEDIUM',
  p_needs_review boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Auth: telemetry-write RPC. Callers are the n8n workflow (service_role) or an
  -- authenticated operator; reject anon/unauthenticated. SECURITY DEFINER means
  -- the body runs as owner, so the caller identity must be checked explicitly.
  IF auth.uid() IS NULL
     AND COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'fn_log_kb_sync_event: authentication required' USING ERRCODE = '42501';
  END IF;
  -- Delegace na trace-event spine (vytvoří ai_run + ai_trace_event).
  -- Status odráží OPERAČNÍ výsledek syncu, ne severity KB změny (ta je dopad
  -- a ukládá se do request_summary):
  --   ragnarok upload selhal       -> 'error'
  --   prošel, ale vyžaduje review  -> 'warning'
  --   prošel, auto-approved        -> 'ok'
  -- Všechny parametry mají default, takže volání je odolné i vůči prázdnému
  -- argument setu (PostgREST overload resolution najde nullary variantu).
  v_result := public.fn_log_ai_trace_event(
    p_event_type      := 'n8n_workflow',
    p_agent_slug      := 'kb-ragnarok-sync',
    p_operation       := 'kb_sync:' || COALESCE(p_action, 'UNKNOWN'),
    p_status          := CASE
                           WHEN p_ragnarok_ok IS FALSE THEN 'error'
                           WHEN p_needs_review        THEN 'warning'
                           ELSE 'ok'
                         END,
    p_request_summary := jsonb_build_object(
      'source_table', p_source_table,
      'source_slug',  p_source_slug,
      'action',       p_action,
      'ragnarok_ok',  p_ragnarok_ok,
      'severity',     p_severity,
      'needs_review', p_needs_review,
      'workflow',     'WF_KB_RAGNAROK_SYNC'
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_log_kb_sync_event(text, text, text, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_log_kb_sync_event(text, text, text, boolean, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_kb_sync_event(text, text, text, boolean, text, boolean) TO service_role;

COMMENT ON FUNCTION public.fn_log_kb_sync_event(text, text, text, boolean, text, boolean) IS
  'Log a KB->Ragnarok sync outcome. Thin wrapper over fn_log_ai_trace_event (event_type n8n_workflow). Called by WF_KB_RAGNAROK_SYNC node Log Sync Event.';

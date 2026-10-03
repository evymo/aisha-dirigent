-- Function: public.record_comm_av_scan_audited
-- Records an antivirus (ClamAV) scan verdict for an inbound-communication QUEUE item
-- (an integration_events row) and FAIL-CLOSES on anything but a clean result. This is
-- the av_scan stage of the content pipeline: the av-scan worker streams the attachment
-- to clamd (INSTREAM) and calls this with the verdict. Only a 'clean' item advances to
-- store → story_entry → vectorize.
--
--   clean    → no lifecycle change; the item proceeds (append + complete elsewhere).
--   infected → terminal block: status='exhausted' (definitive malware, retrying is futile);
--              object stays quarantined, NEVER promoted, NEVER vectorized.
--   error    → fail-closed retriable failure (scan error / timeout / clamd unreachable):
--              status='failed' (backoff retry); still never promotes/vectorizes.
--
-- Complementary to fn_record_safety_scan_audited (prompt-injection, TEXT stage). AV is the
-- BYTE/file stage — it protects the object store + humans; injection protects the RAG/LLM.
--
-- Security: SECURITY DEFINER, service_role ONLY (the scanner is a system worker).
-- @audit: required

CREATE OR REPLACE FUNCTION public.record_comm_av_scan_audited(
  p_event_id  uuid,
  p_verdict   text,
  p_engine    text  DEFAULT 'clamav'::text,
  p_signature text  DEFAULT NULL::text,
  p_file_hash text  DEFAULT NULL::text,
  p_metadata  jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_blocked boolean;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_comm_av_scan_audited is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_verdict NOT IN ('clean', 'infected', 'error') THEN
    RAISE EXCEPTION 'p_verdict must be clean, infected, or error' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integration_events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'integration_events row not found: %', p_event_id USING ERRCODE = '22023';
  END IF;

  v_blocked := p_verdict IS DISTINCT FROM 'clean';

  -- Persist the verdict on the queue item (observability + downstream gate).
  UPDATE public.integration_events
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('av',
                      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
                        'verdict',    p_verdict,
                        'engine',     p_engine,
                        'signature',  p_signature,
                        'file_hash',  p_file_hash,
                        'blocked',    v_blocked,
                        'scanned_at', now()))
   WHERE id = p_event_id;

  -- Fail-closed lifecycle: only 'clean' advances.
  IF p_verdict = 'infected' THEN
    PERFORM public.complete_integration_event(p_event_id, 'exhausted', NULL,
      jsonb_build_object('message', 'av_infected', 'engine', p_engine, 'signature', p_signature));
  ELSIF p_verdict = 'error' THEN
    PERFORM public.complete_integration_event(p_event_id, 'failed', NULL,
      jsonb_build_object('message', 'av_scan_error', 'engine', p_engine));
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (NULL, 'comm.av_scan',
    jsonb_build_object(
      'area',      'communication',
      'severity',  CASE WHEN p_verdict = 'infected' THEN 'warning' ELSE 'info' END,
      'event_id',  p_event_id,
      'verdict',   p_verdict,
      'engine',    p_engine,
      'signature', p_signature,
      'blocked',   v_blocked));

  RETURN jsonb_build_object('event_id', p_event_id, 'verdict', p_verdict, 'blocked', v_blocked);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.record_comm_av_scan_audited(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_comm_av_scan_audited(uuid, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_comm_av_scan_audited(uuid, text, text, text, text, jsonb) TO service_role;

-- Function: public.record_document_av_scan_audited
-- Records an antivirus (ClamAV) scan verdict for an UPLOADED document
-- (a member_health_documents row) and FAIL-CLOSES on anything but a clean result. The
-- storage-auth scan worker streams the quarantined object to clamd (INSTREAM) and calls this
-- with the verdict; only a 'clean' document is promoted to a durable bucket + becomes eligible
-- for OCR/AI processing + vectorization.
--
--   clean    → quarantine_status='clear'; on a non-null p_durable_path also stamp the promoted
--              (durable-bucket) file_path. The OCR/AI pipeline (processing_status) proceeds.
--   infected → quarantine_status='quarantined' (terminal block; object deleted from quarantine
--              by the worker, NEVER promoted, NEVER vectorized).
--   error    → quarantine_status='flagged' (fail-closed: scan error / timeout / clamd
--              unreachable). Stays blocked; surfaces in the quarantine review queue.
--
-- Sibling of record_comm_av_scan_audited (the inbound-comm/mail-attachment queue variant) — same
-- fail-closed contract, different substrate (a document row vs an integration_events row). AV is
-- the BYTE/file stage; scanForInjection is the prompt-injection TEXT stage.
--
-- Security: SECURITY DEFINER, service_role ONLY (the scanner is a system worker, no auth.uid()).
-- @audit: required

CREATE OR REPLACE FUNCTION public.record_document_av_scan_audited(
  p_document_id  uuid,
  p_verdict      text,
  p_engine       text  DEFAULT 'clamav'::text,
  p_signature    text  DEFAULT NULL::text,
  p_durable_path text  DEFAULT NULL::text,
  p_metadata     jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_blocked boolean;
  v_qstatus text;
  v_user    uuid;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_document_av_scan_audited is service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_verdict NOT IN ('clean', 'infected', 'error') THEN
    RAISE EXCEPTION 'p_verdict must be clean, infected, or error' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO v_user FROM public.member_health_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_health_documents row not found: %', p_document_id USING ERRCODE = '22023';
  END IF;

  -- Fail-closed verdict → quarantine_status (same value set + gating predicate as knowledge_items).
  v_qstatus := CASE p_verdict
                 WHEN 'clean'    THEN 'clear'
                 WHEN 'infected' THEN 'quarantined'
                 ELSE                 'flagged'   -- scan error/timeout/unreachable: blocked, needs review
               END;
  v_blocked := p_verdict IS DISTINCT FROM 'clean';

  UPDATE public.member_health_documents
     SET quarantine_status = v_qstatus,
         av_signature      = CASE WHEN p_verdict = 'clean' THEN NULL ELSE COALESCE(p_signature, p_verdict) END,
         av_scanned_at     = now(),
         -- On a clean verdict, stamp the promoted (durable) path if the worker copied the object.
         file_path         = CASE WHEN p_verdict = 'clean' AND p_durable_path IS NOT NULL
                                  THEN p_durable_path ELSE file_path END,
         updated_at        = now()
   WHERE id = p_document_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user, 'document.av_scan',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'area',              'documents',
      'severity',          CASE WHEN p_verdict = 'infected' THEN 'warning' ELSE 'info' END,
      'document_id',       p_document_id,
      'verdict',           p_verdict,
      'engine',            p_engine,
      'signature',         p_signature,
      'quarantine_status', v_qstatus,
      'blocked',           v_blocked));

  RETURN jsonb_build_object(
    'document_id',       p_document_id,
    'verdict',           p_verdict,
    'quarantine_status', v_qstatus,
    'blocked',           v_blocked);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.record_document_av_scan_audited(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_document_av_scan_audited(uuid, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_document_av_scan_audited(uuid, text, text, text, text, jsonb) TO service_role;

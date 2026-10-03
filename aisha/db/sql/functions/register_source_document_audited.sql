-- Function: register_source_document_audited
-- Evidence layer (E3): registers one ingested document version. Service-role
-- only (NULL-safe is_service_role — deny-guard is total, #588 idiom). Rules:
--   * only an ACTIVE source may register documents (fail-closed onboarding),
--   * sensitivity is INHERITED from the source classification (never caller-supplied),
--   * idempotent on (source, content hash): replay returns the existing row.

CREATE OR REPLACE FUNCTION public.register_source_document_audited(
  p_source_slug text,
  p_source_sha256 text,
  p_doc_type text,
  p_title text DEFAULT NULL::text,
  p_doc_date date DEFAULT NULL::date,
  p_counterparty text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source public.agent_knowledge_sources%ROWTYPE;
  v_id uuid;
  v_registered boolean := true;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source
  FROM public.agent_knowledge_sources
  WHERE source_slug = p_source_slug AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown or inactive source' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.document_registry (
    source_id, source_sha256, doc_type, title, doc_date, counterparty, sensitivity, metadata
  )
  VALUES (
    v_source.id, p_source_sha256, p_doc_type, p_title, p_doc_date, p_counterparty,
    COALESCE(v_source.config->>'data_sensitivity', 'confidential'),  -- inherit; absent = most restrictive
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (source_id, source_sha256) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    v_registered := false;  -- idempotent replay
    SELECT id INTO v_id FROM public.document_registry
    WHERE source_id = v_source.id AND source_sha256 = p_source_sha256;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'DOCUMENT_REGISTERED', 'DOCUMENT_REGISTERED', 'content', 'info',
          ARRAY['evidence', 'ingest'],
          jsonb_build_object('source_slug', p_source_slug, 'doc_type', p_doc_type,
                             'sha256', p_source_sha256, 'registered', v_registered));

  RETURN jsonb_build_object('id', v_id, 'registered', v_registered);
END;
$function$

;

REVOKE ALL ON FUNCTION register_source_document_audited(text,text,text,text,date,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_source_document_audited(text,text,text,text,date,text,jsonb) TO service_role;

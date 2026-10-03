-- Function: li_get_document
-- Detail jednoho dokladu vč. line_items a provenance (source_span je uvnitř fields).
--
-- Čtecí protějšek k li_upsert_source_registry. Tabulka má RLS ON a hlavička slibuje "RPC-only lockdown",
-- ale read RPC nikdy nevznikl (5× upsert, 0× read) → evidence natekla a nešla přečíst.
-- Triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100.

CREATE OR REPLACE FUNCTION public.li_get_document(p_doc_slug text)
RETURNS TABLE (
  id uuid, doc_slug text, doc_type text, doc_class text, filename text, status text,
  missing_required text[], fields jsonb, fields_pending_review jsonb,
  line_items jsonb, lines_pending_review integer, schema_version text,
  superseded_by text, ingest_source_slug text, export_id text, engine_version text,
  verify_ok boolean, ingested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.doc_slug, r.doc_type, r.doc_class, r.filename, r.status,
         r.missing_required, r.fields, r.fields_pending_review, r.line_items,
         r.lines_pending_review, r.schema_version, r.superseded_by,
         r.ingest_source_slug, r.export_id, r.engine_version, r.verify_ok, r.ingested_at
  FROM public.li_source_registry r
  WHERE r.doc_slug = p_doc_slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.li_get_document(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_get_document(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_get_document(text) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_get_document(text) TO service_role;

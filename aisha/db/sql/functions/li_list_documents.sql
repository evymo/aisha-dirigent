-- Function: li_list_documents
-- Evidenční registr dokladů z local-ingest — ČTECÍ strana.
--
-- Proč vzniká: li_source_registry.sql:10 deklaruje "RLS: ENABLED (RPC-only lockdown —
-- čtení přes SECURITY DEFINER RPC, ne přímo)", ale ten RPC nikdo nenapsal: 5× li_upsert_*,
-- 0× read. RLS ON + 0 policies = evidence natekla a nedostala se ven — a blokovalo to
-- KAŽDÝ povrch identicky (Appsmith i runtime bloky i React jedou po téže PostgREST rovině).
--
-- Bezpečnostní triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100:
-- STABLE SECURITY DEFINER + SET search_path + role gate (42501) + REVOKE/GRANT.
-- RETURNS TABLE (ne jsonb) záměrně: PostgREST/Appsmith konzumují tabulární tvar přímo.
-- Filtry jsou volitelné (NULL = bez omezení), stránkování fail-safe (limit strop 500).

CREATE OR REPLACE FUNCTION public.li_list_documents(
  p_doc_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_story_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  doc_slug text,
  doc_type text,
  doc_class text,
  filename text,
  status text,
  missing_required text[],
  fields jsonb,
  fields_pending_review jsonb,
  lines_pending_review integer,
  schema_version text,
  superseded_by text,
  verify_ok boolean,
  engine_version text,
  ingested_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.doc_slug, r.doc_type, r.doc_class, r.filename, r.status,
    r.missing_required, r.fields, r.fields_pending_review, r.lines_pending_review,
    r.schema_version, r.superseded_by, r.verify_ok, r.engine_version, r.ingested_at
  FROM public.li_source_registry r
  WHERE (p_doc_type IS NULL OR r.doc_type = p_doc_type)
    AND (p_status   IS NULL OR r.status   = p_status)
    AND (p_story_id IS NULL OR r.story_id = p_story_id)
  ORDER BY r.ingested_at DESC, r.doc_slug
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

COMMENT ON FUNCTION public.li_list_documents(text,text,uuid,integer,integer) IS
  'Evidence registry read surface (admin/staff). Companion to li_upsert_source_registry.';

REVOKE ALL ON FUNCTION public.li_list_documents(text,text,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_list_documents(text,text,uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_list_documents(text,text,uuid,integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_list_documents(text,text,uuid,integer,integer) TO service_role;

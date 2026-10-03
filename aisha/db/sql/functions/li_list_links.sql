-- Function: li_list_links
-- Vazby mezi doklady (mapy) — invoice↔delivery_note, supersedes.
--
-- Čtecí protějšek k li_upsert_links. Tabulka má RLS ON a hlavička slibuje "RPC-only lockdown",
-- ale read RPC nikdy nevznikl (5× upsert, 0× read) → evidence natekla a nešla přečíst.
-- Triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100.

CREATE OR REPLACE FUNCTION public.li_list_links(
  p_doc_slug text DEFAULT NULL, p_relation text DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, link_key text, rule_key text, relation text,
  from_slug text, from_doc_type text, to_slug text, to_doc_type text,
  matched_by jsonb, engine_version text, verify_ok boolean, ingested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id, l.link_key, l.rule_key, l.relation, l.from_slug, l.from_doc_type,
         l.to_slug, l.to_doc_type, l.matched_by, l.engine_version, l.verify_ok, l.ingested_at
  FROM public.li_links l
  WHERE (p_doc_slug IS NULL OR l.from_slug = p_doc_slug OR l.to_slug = p_doc_slug)
    AND (p_relation IS NULL OR l.relation = p_relation)
  ORDER BY l.ingested_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500) OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.li_list_links(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_list_links(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_list_links(text,text,integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_list_links(text,text,integer,integer) TO service_role;

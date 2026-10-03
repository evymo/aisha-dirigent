-- Function: li_list_entity_suggestions
-- Návrhy entit k lidskému rozhodnutí — advisory=true je na tabulce CHECK konstanta.
--
-- Čtecí protějšek k li_upsert_entity_suggestions. Bez tohoto RPC se návrh nedostal
-- k člověku, který ho má vyřídit — tedy fronta existovala, ale nikdo ji neviděl.
-- Triáda 1:1 dle audience_admin_source_onboarding.sql:49-55,97-100.

CREATE OR REPLACE FUNCTION public.li_list_entity_suggestions(
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, suggestion_key text, suggestion text,
  id_field text, id_value text, name_field text, name_normalized text,
  names text[], ids text[], documents text[], advisory boolean,
  engine_version text, verify_ok boolean, ingested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.suggestion_key, s.suggestion, s.id_field, s.id_value,
         s.name_field, s.name_normalized, s.names, s.ids, s.documents, s.advisory,
         s.engine_version, s.verify_ok, s.ingested_at
  FROM public.li_entity_suggestions s
  ORDER BY s.ingested_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500) OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.li_list_entity_suggestions(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_list_entity_suggestions(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_list_entity_suggestions(integer,integer) TO authenticator;
GRANT EXECUTE ON FUNCTION public.li_list_entity_suggestions(integer,integer) TO service_role;

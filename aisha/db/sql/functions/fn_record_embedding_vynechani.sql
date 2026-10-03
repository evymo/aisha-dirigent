-- ============================================================================
-- Source of Truth: fn_record_embedding_vynechani
-- Popis: Zapíše chunk, který dopočet vektorů pro živou identitu záměrně nezakódoval
--        (knowledge_embedding_vynechani). Jen service_role; idempotentní.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_record_embedding_vynechani(
  p_chunk_id uuid,
  p_locale   text,
  p_identita text,
  p_duvod    text,
  p_tokenu   integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  INSERT INTO public.knowledge_embedding_vynechani (chunk_id, locale, identita, duvod, tokenu)
  VALUES (p_chunk_id, COALESCE(p_locale, 'global'), p_identita, p_duvod, p_tokenu)
  ON CONFLICT (chunk_id, locale, identita) DO UPDATE
    SET duvod = EXCLUDED.duvod, tokenu = EXCLUDED.tokenu;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_embedding_vynechani(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_embedding_vynechani(uuid, text, text, text, integer) TO service_role;

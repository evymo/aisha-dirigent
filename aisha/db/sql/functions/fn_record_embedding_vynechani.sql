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
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
BEGIN
  -- Jen role služby — týž tvar stráže jako zbytek rodiny dopočtu v1 (is_service_role je domov
  -- platformy: claim role NEBO SET ROLE service_role; „je někdo přihlášen“ nárok není).
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'fn_record_embedding_vynechani: jen role služby' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.knowledge_embedding_vynechani (chunk_id, locale, identita, duvod, tokenu)
  VALUES (p_chunk_id, COALESCE(p_locale, 'global'), p_identita, p_duvod, p_tokenu)
  ON CONFLICT (chunk_id, locale, identita) DO UPDATE
    SET duvod = EXCLUDED.duvod, tokenu = EXCLUDED.tokenu;
END;
$$;

-- I od anon/authenticated: fork s výchozím EXECUTE pro authenticated (Supabase) by ho jinak dal
-- každé nové funkci a REVOKE FROM PUBLIC by ho neodebral.
REVOKE ALL ON FUNCTION public.fn_record_embedding_vynechani(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_embedding_vynechani(uuid, text, text, text, integer) TO service_role;

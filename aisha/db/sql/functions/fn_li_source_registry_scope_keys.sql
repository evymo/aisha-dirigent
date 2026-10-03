-- ============================================================================
-- Source of Truth: fn_li_source_registry_scope_keys (trigger)
-- Popis: Drží li_doc_scope_keys v souladu s JEDNÍM řádkem registru: klíče
--        dokladu se zahodí a znovu vytáhnou (li_doc_scope_keys_z_dokladu), když
--        se změní typ, pole, slug nebo platnost verze. Nahrazená verze klíče
--        nemá — nárok míří na platnou verzi.
-- Pár: triggers/li_source_registry_scope_keys.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_li_source_registry_scope_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  DELETE FROM public.li_doc_scope_keys WHERE source_sha256 = NEW.source_sha256;
  IF NEW.superseded_by IS NULL AND NEW.doc_slug IS NOT NULL THEN
    INSERT INTO public.li_doc_scope_keys (source_sha256, doc_slug, doc_type, field_key, hodnota, zobrazeni)
    SELECT NEW.source_sha256, NEW.doc_slug, NEW.doc_type, k.field_key, k.hodnota, k.zobrazeni
      FROM public.li_doc_scope_keys_z_dokladu(NEW.doc_type, NEW.doc_class, NEW.fields, NEW.raw_data) AS k
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_li_source_registry_scope_keys() FROM PUBLIC;

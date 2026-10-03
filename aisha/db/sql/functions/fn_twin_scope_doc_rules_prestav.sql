-- ============================================================================
-- Source of Truth: fn_twin_scope_doc_rules_prestav (trigger, FOR EACH STATEMENT)
-- Popis: Změna pravidel nároku (nové pole, vypnutí, smazání) přestaví
--        li_doc_scope_keys — nové pole musí mít klíče i u dokladů, které přišly
--        dřív. Pravidla se mění zřídka (data instance), přestavba je levná.
-- Pár: triggers/twin_scope_doc_rules_prestav.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_twin_scope_doc_rules_prestav()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.li_doc_scope_keys_prestav();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_twin_scope_doc_rules_prestav() FROM PUBLIC;

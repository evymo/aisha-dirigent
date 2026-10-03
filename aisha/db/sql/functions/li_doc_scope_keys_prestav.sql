-- ============================================================================
-- Source of Truth: li_doc_scope_keys_prestav
-- Popis: Přestaví li_doc_scope_keys z celého registru (platné verze dokladů
--        typů, které zná aktivní pravidlo). Volá ji trigger při změně pravidel
--        (nové pole = klíče i pro doklady, které přišly dřív) a heals při každé
--        migraci — konvergence, kdyby trigger někdy chyběl.
--        Vrací počet zapsaných klíčů.
--
-- Bezpečnost: SECURITY DEFINER bez guardu na volajícího, ale EXECUTE má jen
--   service_role (a vlastník / migrace). Nic nevrací z dat, jen počet.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_doc_scope_keys_prestav()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.li_doc_scope_keys;
  -- Všechny platné doklady: původ (@instance, @cesta) mají všechny, pole z pravidel jen
  -- typy, které pravidla znají (to rozhodne li_doc_scope_keys_z_dokladu).
  INSERT INTO public.li_doc_scope_keys (source_sha256, doc_slug, doc_type, field_key, hodnota, zobrazeni)
  SELECT d.source_sha256, d.doc_slug, d.doc_type, k.field_key, k.hodnota, k.zobrazeni
    FROM public.li_source_registry d
    CROSS JOIN LATERAL public.li_doc_scope_keys_z_dokladu(d.doc_type, d.doc_class, d.fields, d.raw_data) AS k
   WHERE d.superseded_by IS NULL
     AND d.doc_slug IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.li_doc_scope_keys_prestav() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_doc_scope_keys_prestav() TO service_role;

COMMENT ON FUNCTION public.li_doc_scope_keys_prestav() IS
  'Přestavba li_doc_scope_keys z registru (platné verze, typy s aktivním pravidlem). Trigger při změně pravidel a heals; vrací počet klíčů.';

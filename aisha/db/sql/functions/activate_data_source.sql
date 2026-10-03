-- ============================================================================
-- Source of Truth: activate_data_source
-- Popis: Zapne zdroj dat. Protějšek k deaktivaci, který dosud CHYBĚL.
--
-- ⛔ PROČ VZNIKÁ. Naměřeno 2026-09-01: jediný UPDATE nad
-- `agent_knowledge_sources` v celém SoT byl `is_active = false`
-- (`deactivate_plugin_runtime`). `materialize_data_source` zakládá řádek
-- neaktivní „BY CONSTRUCTION" — jenže protějšek k tomu záměru nikdo nedopsal.
-- Broker proto u zdroje `money` každou minutu psal „aktivace je rozhodnutí
-- člověka", zatímco ten člověk NEMĚL ČÍM rozhodnout. Systém uměl bezpečně
-- říct „ne" a neuměl říct „ano".
--
-- ⭐ STRÁŽ SE NEVYMÝŠLÍ, ČTE SE ZE SCHÉMATU PLUGINU. Zapnout nejde, dokud
-- chybí pověření, která plugin sám označil jako `required` ∧ `secret`. Bez
-- toho by šlo zapnout zdroj naprázdno: cron by tikal, log by vypadal jako
-- provoz a tabulky by zůstaly na nule — tvar poruchy, který se nepozná.
--
-- Zdroj bez pluginu (money, local-ingest) nemá schéma; nevyžaduje se tedy nic.
-- Prázdný požadavek je „nic se nevyžaduje", ne „nevím".
--
-- Idempotentní: zapnutí už zapnutého nic nemění a nezapisuje do žurnálu
-- druhou událost.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activate_data_source(p_source_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_id uuid;
  v_active    boolean;
  v_schema    jsonb;
  v_chybi     text[];
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT s.id, s.is_active, pc.config_schema
    INTO v_source_id, v_active, v_schema
    FROM public.agent_knowledge_sources s
    LEFT JOIN public.plugin_catalog pc ON pc.id = s.source_plugin_id
   WHERE s.source_slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'activate_data_source: zdroj % neexistuje', p_source_slug;
  END IF;

  IF v_active THEN
    RETURN jsonb_build_object('source_slug', p_source_slug, 'is_active', true, 'changed', false);
  END IF;

  SELECT coalesce(array_agg(r.k ORDER BY r.k), '{}')
    INTO v_chybi
    FROM jsonb_array_elements_text(coalesce(v_schema->'required', '[]'::jsonb)) AS r(k)
   WHERE coalesce((v_schema->'properties'->r.k->>'secret')::boolean, false)
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_knowledge_source_secrets sec
        WHERE sec.source_id = v_source_id AND sec.secret_key = r.k
     );

  IF array_length(v_chybi, 1) > 0 THEN
    RAISE EXCEPTION 'activate_data_source: zdroj % nelze zapnout — chybí pověření: %',
      p_source_slug, array_to_string(v_chybi, ', ');
  END IF;

  UPDATE public.agent_knowledge_sources
     SET is_active = true, updated_at = now()
   WHERE id = v_source_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'DATA_SOURCE_ACTIVATED', jsonb_build_object(
    'area', 'ingest', 'severity', 'warning',
    'source_slug', p_source_slug, 'source_id', v_source_id
  ));

  RETURN jsonb_build_object('source_slug', p_source_slug, 'is_active', true, 'changed', true);
END;
$$;

COMMENT ON FUNCTION public.activate_data_source(text) IS
  'Zapne zdroj dat. Odmítne, dokud chybí pověření označená v config_schema pluginu jako required ∧ secret. Idempotentní, auditované. Admin/staff nebo service_role.';

REVOKE ALL ON FUNCTION public.activate_data_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_data_source(text) TO authenticated, service_role;

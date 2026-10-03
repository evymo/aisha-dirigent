-- ============================================================================
-- Source of Truth: get_data_source_secret_status
-- Popis: Co zdroj pro připojení POTŘEBUJE a co z toho je vyplněné.
--
-- ⭐ SEZNAM SE NEPÍŠE, ODVOZUJE SE. Povinná pověření vycházejí z pluginu:
-- `config_schema.required` průnik s poli, která mají `secret: true`. Kdyby tu
-- byl ruční výčet, byl by to druhý udržovaný seznam — a rozešel by se stejně
-- tiše jako ten, který má hlídat.
--
-- ⛔ VRACÍ PŘÍTOMNOST, NE HODNOTU. `is_set` vzniká z EXISTS nad šifrovanou
-- tabulkou; nic se nedešifruje, takže tahle cesta neumí tajemství vydat ani
-- omylem.
--
-- Zdroj bez pluginu (`source_plugin_id IS NULL` — např. `money`, `local-ingest`)
-- nemá schéma, ze kterého by se dalo odvozovat. Vrací tedy prázdný seznam:
-- „nic se nevyžaduje", ne „nevím".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_data_source_secret_status(p_source_slug text)
RETURNS TABLE (
  secret_key  text,
  is_required boolean,
  is_set      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_id uuid;
  v_schema    jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT s.id, pc.config_schema
    INTO v_source_id, v_schema
    FROM public.agent_knowledge_sources s
    LEFT JOIN public.plugin_catalog pc ON pc.id = s.source_plugin_id
   WHERE s.source_slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'get_data_source_secret_status: zdroj % neexistuje', p_source_slug;
  END IF;

  RETURN QUERY
  WITH pozadovane AS (
    SELECT r.k AS klic
      FROM jsonb_array_elements_text(coalesce(v_schema->'required', '[]'::jsonb)) AS r(k)
     WHERE coalesce((v_schema->'properties'->r.k->>'secret')::boolean, false)
  ),
  ulozene AS (
    SELECT sec.secret_key AS klic
      FROM public.agent_knowledge_source_secrets sec
     WHERE sec.source_id = v_source_id
  )
  SELECT k.klic,
         (k.klic IN (SELECT klic FROM pozadovane)),
         (k.klic IN (SELECT klic FROM ulozene))
    FROM (SELECT klic FROM pozadovane UNION SELECT klic FROM ulozene) AS k
   ORDER BY 1;
END;
$$;

COMMENT ON FUNCTION public.get_data_source_secret_status(text) IS
  'Která pověření zdroj vyžaduje (odvozeno z config_schema pluginu: required ∩ secret) a která jsou uložená. Vrací PŘÍTOMNOST, nikdy hodnotu. Admin/staff nebo service_role.';

REVOKE ALL ON FUNCTION public.get_data_source_secret_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_data_source_secret_status(text) TO authenticated, service_role;

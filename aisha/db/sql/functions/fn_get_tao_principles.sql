-- Function: fn_get_tao_principles
--
-- Zásady TAO — GLOBÁLNÍ položky typu `core_value` (vrstva mozku).
--
-- Viditelnost (2026-10-05): jeden domov public.knowledge_visibility_searchable pro toho, PRO KOHO se
-- čte. Do 2026-10-05 funkce viditelnost nečetla vůbec: přihlášený (EXECUTE má) dostal i soukromou
-- globální položku a compose_context skládal tutéž vrstvu do kontextu každé odpovědi bez ohledu na
-- to, kdo se ptá. Štítek viditelnosti znamená všude totéž (rozhodnutí majitele 2026-10-04:
-- nepřihlášený vidí jen public; private jen správa). Upstream seed nese všechny tyto položky jako
-- `public` — tam se výsledek nemění.
--
-- PRO KOHO se čte (vzor hledání v2/v3): jen služba smí říct, za koho čte (p_audience_user_id —
-- compose_context předává žadatele); přihlášený je připnutý na sebe; služba bez publika je bez identity.
--
-- Signatura se mění výměnou (přibyl parametr s výchozí hodnotou): bez DROP by vedle sebe žily dvě
-- přetížení a volání bez argumentů by skončilo „is not unique“.
DROP FUNCTION IF EXISTS public.fn_get_tao_principles();

CREATE OR REPLACE FUNCTION public.fn_get_tao_principles(p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_audience_user uuid;  -- pro koho se čte (služba smí říct; jinak volající sám; bez identity NULL)
  v_in_guild boolean;    -- má ten, pro koho se čte, profil partnera (viditelnost `guild`)
  v_is_admin boolean;    -- je ten, pro koho se čte, správa (čte i soukromé)
BEGIN
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: authentication required'
      USING ERRCODE = '42501';
  END IF;

  v_audience_user := CASE
    WHEN public.get_jwt_role() = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;
  v_in_guild := public.knowledge_audience_in_guild(v_audience_user);
  v_is_admin := COALESCE(public.is_admin_or_staff(v_audience_user), false);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slug', ki.source_slug,
        'title', ki.title,
        'summary', ki.summary,
        'ai_instructions', ki.ai_instructions,
        'tags', ki.ai_context_tags
      )
      ORDER BY ki.source_slug
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM knowledge_items ki
  WHERE ki.item_type = 'core_value'
    AND ki.status = 'active'
    -- Jen GLOBÁLNÍ: položka založená v příběhu (např. z balíčku agenta) není vrstvou mozku
    -- pro všechny. Do 2026-10-04 se tu četly položky všech příběhů.
    AND ki.story_id IS NULL
    AND public.knowledge_state_readable(ki.quarantine_status)
    -- Viditelnost z jednoho domova; správa vidí vše.
    AND (v_is_admin OR public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild));

  RETURN v_result;
END;
$function$

;

REVOKE ALL ON FUNCTION fn_get_tao_principles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_tao_principles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_tao_principles(uuid) TO service_role;

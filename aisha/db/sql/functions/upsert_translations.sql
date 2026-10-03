-- Function: public.upsert_translations
-- Arguments: p_translations jsonb
-- Security: service_role nebo admin bez omezení; staff jen obsahové namespacy
--           (web/news/pages/extranet) — viz rozvahu v těle funkce.
-- Extracted: 2026-01-08T18:28:34+01:00

CREATE OR REPLACE FUNCTION public.upsert_translations(p_translations jsonb)
 RETURNS TABLE(id uuid, key text, locale text, value text, namespace text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    item JSONB;
    v_keys TEXT[];
    -- Boot-time /seed-default ingests a design folder's i18n.json as service_role
    -- (sub-less system runner, auth.uid() NULL). Admit it alongside admins; the
    -- translation admin UI path is unchanged.
    v_is_service boolean := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
    v_is_admin boolean;
    v_cizi_namespace text;
    -- ⛔ OBSAHOVÉ NAMESPACY — jen tyhle smí zapisovat `staff` (2026-09-21).
    --
    -- Naměřená asymetrie: článek novinek smí vytvořit i upravit admin NEBO staff
    -- (policy „Admin/staff can manage news", USING is_admin_or_staff()), ale
    -- TEXTY toho článku šly zapsat jen adminovi. Editor plátna proto staffovi
    -- uložil článek a překlady zahodil — a SPA to umí jen ohlásit hláškou
    -- (CanvasEditor, builder.status.translationsDenied). Kdo smí obsah napsat,
    -- musí smět zapsat i jeho texty, jinak je ta role nefunkční.
    --
    -- Rozšíření je ÚZKÉ ZÁMĚRNĚ: `translations` nese i texty UI celé platformy
    -- (namespace `common`, `notifications`, …). Staff dostává jen namespacy
    -- obsahu, který smí spravovat — web, novinky, stránky, extranet. Všechno
    -- ostatní zůstává adminovi; neznámý namespace se odmítne, nedovolí.
    v_obsahove_namespacy text[] := ARRAY['web', 'news', 'pages', 'extranet'];
BEGIN
    v_is_admin := public.has_role(auth.uid(), 'admin');

    IF NOT (v_is_service OR v_is_admin) THEN
        IF NOT public.is_admin_or_staff(auth.uid()) THEN
            RAISE EXCEPTION 'Access denied: admin role required';
        END IF;

        SELECT COALESCE(prvek->>'namespace', 'questionnaires')
          INTO v_cizi_namespace
          FROM jsonb_array_elements(p_translations) AS prvek
         WHERE COALESCE(prvek->>'namespace', 'questionnaires') <> ALL (v_obsahove_namespacy)
         LIMIT 1;

        IF v_cizi_namespace IS NOT NULL THEN
            RAISE EXCEPTION 'Access denied: role staff may write only content namespaces (%), got %',
                array_to_string(v_obsahove_namespacy, ', '), v_cizi_namespace;
        END IF;
    END IF;

    v_keys := ARRAY[]::TEXT[];

    FOR item IN SELECT * FROM jsonb_array_elements(p_translations)
    LOOP
        v_keys := array_append(v_keys, item->>'key');
        
        INSERT INTO public.translations (key, locale, value, namespace, updated_at)
        VALUES (
            item->>'key',
            item->>'locale', 
            item->>'value',
            COALESCE(item->>'namespace', 'questionnaires'),
            NOW()
        )
        ON CONFLICT (key, locale, namespace) 
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    END LOOP;

    RETURN QUERY SELECT t.id, t.key, t.locale, t.value, t.namespace, t.created_at, t.updated_at
    FROM public.translations t
    WHERE t.key = ANY(v_keys);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_translations(p_translations jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_translations(p_translations jsonb) TO authenticated, service_role;

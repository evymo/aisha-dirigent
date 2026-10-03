-- Function: public.upsert_translation
-- Arguments: p_key text, p_locale text, p_value text, p_namespace text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:34+01:00

CREATE OR REPLACE FUNCTION public.upsert_translation(p_key text, p_locale text, p_value text, p_namespace text DEFAULT 'questionnaires'::text)
 RETURNS TABLE(id uuid, key text, locale text, value text, namespace text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_id UUID;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;

    INSERT INTO public.translations (key, locale, value, namespace, updated_at)
    VALUES (p_key, p_locale, p_value, p_namespace, NOW())
    ON CONFLICT (key, locale, namespace) 
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING translations.id INTO v_id;

    RETURN QUERY SELECT t.id, t.key, t.locale, t.value, t.namespace, t.created_at, t.updated_at
    FROM public.translations t WHERE t.id = v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_translation(p_key text, p_locale text, p_value text, p_namespace text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_translation(p_key text, p_locale text, p_value text, p_namespace text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_translation(p_key text, p_locale text, p_value text, p_namespace text) TO authenticated;

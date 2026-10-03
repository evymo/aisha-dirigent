-- Function: public.get_translation_value
-- Arguments: p_key text, p_namespace text, p_locale text
-- Description: Returns translation value for given key, namespace and locale.
--              Available to anonymous users for public UI translations.
-- Security: SECURITY DEFINER - required for anon access to translations table
-- Extracted: 2026-01-08T18:27:43+01:00

CREATE OR REPLACE FUNCTION public.get_translation_value(p_key text, p_namespace text, p_locale text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT t.value
    FROM public.translations t
    WHERE t.key = p_key AND t.namespace = p_namespace AND t.locale = p_locale
    LIMIT 1;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_translation_value(p_key text, p_namespace text, p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translation_value(p_key text, p_namespace text, p_locale text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translation_value(p_key text, p_namespace text, p_locale text) TO authenticated;

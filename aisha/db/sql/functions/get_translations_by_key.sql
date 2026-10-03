-- Function: public.get_translations_by_key
-- Arguments: p_key text, p_namespace text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:43+01:00

CREATE OR REPLACE FUNCTION public.get_translations_by_key(p_key text, p_namespace text DEFAULT 'questionnaires'::text)
 RETURNS TABLE(id uuid, key text, locale text, value text, namespace text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT t.id, t.key, t.locale, t.value, t.namespace, t.created_at, t.updated_at
    FROM public.translations t
    WHERE t.key = p_key AND t.namespace = p_namespace
    ORDER BY t.locale;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_translations_by_key(p_key text, p_namespace text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_by_key(p_key text, p_namespace text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_by_key(p_key text, p_namespace text) TO authenticated;

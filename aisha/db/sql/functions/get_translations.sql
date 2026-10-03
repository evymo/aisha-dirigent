-- Function: public.get_translations
-- Arguments: p_namespace text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:43+01:00

CREATE OR REPLACE FUNCTION public.get_translations(p_namespace text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, key text, locale text, value text, namespace text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT t.id, t.key, t.locale, t.value, t.namespace, t.created_at, t.updated_at
    FROM public.translations t
    WHERE (p_namespace IS NULL OR t.namespace = p_namespace)
    ORDER BY t.key, t.locale;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_translations(p_namespace text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations(p_namespace text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations(p_namespace text) TO authenticated;

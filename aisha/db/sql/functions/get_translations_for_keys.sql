-- Function: public.get_translations_for_keys
-- Arguments: p_keys text[], p_namespace text
-- Description: Returns UI translations for given keys. Public lookup data.
-- Security: Public - translations are public UI strings.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_translations_for_keys(p_keys text[], p_namespace text DEFAULT 'common'::text)
 RETURNS TABLE(key text, locale text, value text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.key, t.locale, t.value
  FROM public.translations t
  WHERE t.key = ANY(p_keys)
    AND t.namespace = p_namespace;
$function$;

-- Permissions (PUBLIC: překlady jsou potřeba pro veřejné stránky)
REVOKE ALL ON FUNCTION public.get_translations_for_keys(p_keys text[], p_namespace text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_for_keys(p_keys text[], p_namespace text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_for_keys(p_keys text[], p_namespace text) TO authenticated;

-- Function: public.get_translation_value_with_fallback
-- Arguments: p_key text, p_namespace text, p_locale text, p_fallback_locale text, p_default_value text
-- Description: Get translation value with fallback to another locale, then to default value.
-- Security: STABLE - public UI translations.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_translation_value_with_fallback(
  p_key text,
  p_namespace text,
  p_locale text DEFAULT NULL,
  p_fallback_locale text DEFAULT 'en',
  -- Default value to use if no translation found
  p_default_value text DEFAULT NULL
)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- 1. Try requested locale
    (SELECT t.value FROM public.translations t
     WHERE t.key = p_key AND t.namespace = p_namespace AND t.locale = p_locale
     LIMIT 1),
    -- 2. Try fallback locale (usually 'en')
    (SELECT t.value FROM public.translations t
     WHERE t.key = p_key AND t.namespace = p_namespace AND t.locale = p_fallback_locale
     LIMIT 1),
    -- 3. Use default value from database columns
    p_default_value
  );
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_translation_value_with_fallback(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translation_value_with_fallback(text, text, text, text, text) TO public;

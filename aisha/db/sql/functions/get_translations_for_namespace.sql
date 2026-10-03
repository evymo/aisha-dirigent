-- Source: the absorbed migration (now in the baseline)
-- Function: public.get_translations_for_namespace
-- Arguments: p_namespace TEXT, p_locale TEXT
-- Description: Returns all translations for a namespace and locale. Used by mobile app for dynamic content.
-- Security: SECURITY DEFINER - required for anon access to translations table
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_translations_for_namespace(
  p_namespace TEXT,
  p_locale TEXT DEFAULT 'en'
)
RETURNS TABLE (
  key TEXT,
  value TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.key, t.value
  FROM translations t
  WHERE t.namespace = p_namespace
    AND t.locale = p_locale
  ORDER BY t.key;
END;
$$;

-- Allow all users (including anon for public content)
REVOKE ALL ON FUNCTION public.get_translations_for_namespace(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_for_namespace(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_for_namespace(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_translations_for_namespace(text, text) IS 
  'Returns all translations for a namespace and locale. Used by mobile app for dynamic content.';

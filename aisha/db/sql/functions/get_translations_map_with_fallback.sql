-- Function: public.get_translations_map_with_fallback
-- Arguments: p_keys text[], p_namespace text, p_locale text, p_fallback_locale text, p_language text (alias)
-- Description: Get multiple translations with fallback to another locale.
-- Security: STABLE - public UI translations.
-- @security: public
-- @audit: none
--
-- Namespace handling — two modes:
--
--   1. Explicit namespace (existing behavior, backward-compatible):
--      Caller passes p_namespace='questionnaires' (or any concrete string).
--      All keys are looked up under that one namespace. Use when the caller
--      knows every key in p_keys lives in the same namespace — e.g. an admin
--      form for a single questionnaire.
--
--   2. Derive-from-key-prefix (NEW, opt-in via p_namespace=NULL):
--      Caller passes p_namespace=NULL. Each key's namespace is derived from
--      its first dot-segment, e.g. shop.hero.eyebrow →
--      namespace='shop'. Use for heterogeneous batches like PageRenderer's
--      canvas hydration where a single page may mix several namespaces,
--      tokens.* etc. Avoids forcing callers to either guess a single
--      namespace (which silently drops mismatched keys, the bug this fixes)
--      or fan out into N+1 RPC calls.
--
-- All seeded data follows the `<namespace>.<rest>` key convention (see
-- the instance's own i18n seeding tooling and its *.json source
-- file), so mode 2 reliably resolves every well-formed key.

CREATE OR REPLACE FUNCTION public.get_translations_map_with_fallback(
  p_keys text[],
  p_namespace text,
  p_locale text DEFAULT NULL,
  p_fallback_locale text DEFAULT 'en',
  -- TypeScript compatibility alias
  p_language text DEFAULT NULL
)
 RETURNS TABLE(key text, value text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- COALESCE(p_namespace, split_part(k.key, '.', 1)) — when caller omits the
  -- namespace (mode 2 above), each key's namespace is its first dot-segment.
  -- When caller provides one (mode 1), it wins for every key, preserving the
  -- legacy behavior that other RPCs and admin tooling depend on.
  SELECT k.key,
         COALESCE(t.value, tf.value) AS value
  FROM unnest(p_keys) AS k(key)
  LEFT JOIN public.translations t
    ON t.key = k.key
    AND t.namespace = COALESCE(p_namespace, split_part(k.key, '.', 1))
    AND t.locale = COALESCE(p_locale, p_language)
  LEFT JOIN public.translations tf
    ON tf.key = k.key
    AND tf.namespace = COALESCE(p_namespace, split_part(k.key, '.', 1))
    AND tf.locale = p_fallback_locale;
$function$;

-- Permissions (PUBLIC: překlady jsou potřeba pro veřejné stránky)
REVOKE ALL ON FUNCTION public.get_translations_map_with_fallback(text[], text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_map_with_fallback(text[], text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_map_with_fallback(text[], text, text, text, text) TO authenticated;

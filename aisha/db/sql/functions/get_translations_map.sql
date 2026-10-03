-- Function: public.get_translations_map
-- Arguments: p_keys text[], p_namespace text, p_locale text
-- Description: Returns UI translations for given keys. Public lookup data.
-- Security: Public - translations are public UI strings.
-- @security: public
-- @audit: none
--
-- Namespace handling: mirrors get_translations_map_with_fallback —
--   - p_namespace NOT NULL → strict single-namespace lookup (legacy behavior)
--   - p_namespace IS NULL  → per-key namespace inferred from each key's first
--     dot-segment (e.g. shop.hero.eyebrow → 'shop'). Enables
--     callers with heterogeneous key sets (PageRenderer canvas hydration) to
--     avoid forcing a single guessed namespace.
-- See get_translations_map_with_fallback.sql for the longer rationale.

CREATE OR REPLACE FUNCTION public.get_translations_map(p_keys text[], p_namespace text, p_locale text)
 RETURNS TABLE(key text, value text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- Switching to a JOIN against unnest(p_keys) so the namespace derivation
    -- can be expressed once per key rather than as a row-wise predicate. The
    -- LEFT JOIN matches the with_fallback variant's shape (which still wins
    -- for callers that need explicit fallback semantics).
    SELECT k.key, t.value
    FROM unnest(p_keys) AS k(key)
    JOIN public.translations t
      ON t.key = k.key
      AND t.namespace = COALESCE(p_namespace, split_part(k.key, '.', 1))
      AND t.locale = p_locale;
$function$;

-- Permissions (PUBLIC: překlady jsou potřeba pro veřejné stránky)
REVOKE ALL ON FUNCTION public.get_translations_map(p_keys text[], p_namespace text, p_locale text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_map(p_keys text[], p_namespace text, p_locale text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_translations_map(p_keys text[], p_namespace text, p_locale text) TO authenticated;

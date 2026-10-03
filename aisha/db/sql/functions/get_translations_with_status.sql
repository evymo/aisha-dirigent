-- Function: public.get_translations_with_status
-- Arguments: p_namespace text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:44+01:00

CREATE OR REPLACE FUNCTION public.get_translations_with_status(p_namespace text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, key text, locale text, value text, namespace text, created_at timestamptz, updated_at timestamptz, source_updated_at timestamptz, is_stale boolean, is_missing boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH active_locales AS (
    SELECT sl.code AS locale
    FROM public.supported_languages sl
    WHERE sl.is_active = true
  ),
  keys AS (
    SELECT DISTINCT t.namespace, t.key
    FROM public.translations t
    WHERE (p_namespace IS NULL OR t.namespace = p_namespace)
  ),
  grid AS (
    SELECT
      k.namespace,
      k.key,
      l.locale,
      md5(k.namespace || ':' || k.key || ':' || l.locale) AS synthetic_id_hex
    FROM keys k
    CROSS JOIN active_locales l
  ),
  source AS (
    -- Base/source locale for staleness comparison (instance base locale; terminal failover: en)
    SELECT t.namespace, t.key, t.updated_at AS source_updated_at
    FROM public.translations t
    WHERE t.locale = 'en'
  )
  SELECT
    COALESCE(
      t.id,
      (
        substring(g.synthetic_id_hex, 1, 8) || '-' ||
        substring(g.synthetic_id_hex, 9, 4) || '-' ||
        substring(g.synthetic_id_hex, 13, 4) || '-' ||
        substring(g.synthetic_id_hex, 17, 4) || '-' ||
        substring(g.synthetic_id_hex, 21, 12)
      )::uuid
    ) AS id,
    g.key,
    g.locale,
    COALESCE(t.value, '') AS value,
    g.namespace,
    COALESCE(t.created_at, s.source_updated_at, now()) AS created_at,
    COALESCE(t.updated_at, s.source_updated_at, now()) AS updated_at,
    s.source_updated_at,
    CASE
      WHEN g.locale = 'en' THEN false
      WHEN t.id IS NULL THEN false
      WHEN s.source_updated_at IS NULL THEN false
      ELSE t.updated_at < s.source_updated_at
    END AS is_stale,
    (t.id IS NULL) AS is_missing
  FROM grid g
  LEFT JOIN public.translations t
    ON t.namespace = g.namespace AND t.key = g.key AND t.locale = g.locale
  LEFT JOIN source s
    ON s.namespace = g.namespace AND s.key = g.key
  ORDER BY g.namespace, g.key, g.locale;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_translations_with_status(p_namespace text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translations_with_status(p_namespace text) TO authenticated;

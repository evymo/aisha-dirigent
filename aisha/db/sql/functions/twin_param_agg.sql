-- ============================================================================
-- Source of Truth: twin_param_agg
-- Popis: Jedna agregace jednoho parametru PO DVOJČATECH — společný počitadlový
--        krok tabulky i grafu nad substrátem dvojčat. Sesbírá i to, čím se
--        číslo doloží: čas poslední hodnoty a zdroje, které do okna přispěly.
--
-- `ratio` je VÁŽENÝ poměr (Σ čitatele / Σ jmenovatele × factor), ne průměr
--        poměrů po řádcích: průměr poměrů dá krátké jízdě tutéž váhu jako
--        dlouhé, a l/100 km pak tvrdí něco jiného než palivová bilance.
--
-- Neznámá agregace degraduje na `sum` místo pádu — nová deklarace bloku nesmí
--        shodit starší databázi (týž idiom jako `kind` v grafu).
--
-- Bezpečnost: SECURITY INVOKER; veškerý dosah má `twin_param_values` a RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_param_agg(
  p_code        text,
  p_agg         text        DEFAULT 'sum',
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_entity_type text        DEFAULT NULL,
  p_per_code    text        DEFAULT NULL,
  p_factor      numeric     DEFAULT 1
)
RETURNS TABLE (twin_id uuid, twin_label text, value numeric, last_at timestamptz, sources text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH agg AS (
    SELECT lower(COALESCE(p_agg, 'sum')) AS name
  ),
  per AS (
    SELECT v.twin_id, sum(v.value) AS denom
    FROM public.twin_param_values(p_per_code, p_from, p_to, p_entity_type) v
    GROUP BY v.twin_id
  )
  SELECT
    g.twin_id,
    g.twin_label,
    -- Zaokrouhluje se JEDNOU, až tady: hodnoty vstupují v jednotce parametru
    -- (katalog umí převod, např. s → h) a ty dávají periodická desetinná místa.
    -- `trim_scale` pak odřízne nuly, aby počet kusů zůstal „3", ne „3.00".
    trim_scale(round(g.value, 2)),
    g.last_at,
    g.sources
  FROM (
    SELECT
      b.twin_id,
      min(b.twin_label) AS twin_label,
      CASE (SELECT name FROM agg)
        WHEN 'avg'             THEN avg(b.value)
        WHEN 'count'           THEN count(*)::numeric
        WHEN 'max'             THEN max(b.value)
        WHEN 'min'             THEN min(b.value)
        WHEN 'last'            THEN (array_agg(b.value ORDER BY b.occurred_at DESC)
                                       FILTER (WHERE b.value IS NOT NULL))[1]
        WHEN 'days_since_last' THEN floor(extract(epoch FROM (now() - max(b.occurred_at))) / 86400)
        WHEN 'ratio'           THEN COALESCE(p_factor, 1) * sum(b.value)
                                    / NULLIF((SELECT p.denom FROM per p WHERE p.twin_id = b.twin_id), 0)
        ELSE sum(b.value)
      END AS value,
      max(b.occurred_at) AS last_at,
      string_agg(DISTINCT b.source, '+' ORDER BY b.source) AS sources
    FROM public.twin_param_values(p_code, p_from, p_to, p_entity_type) b
    GROUP BY b.twin_id
  ) g;
$$;

COMMENT ON FUNCTION public.twin_param_agg(text, text, timestamptz, timestamptz, text, text, numeric) IS
  'Agregace parametru po dvojčatech (sum/avg/count/max/min/last/days_since_last/ratio) i s časem poslední hodnoty a zdroji — počitadlo pro tabulku a graf.';

REVOKE ALL ON FUNCTION public.twin_param_agg(text, text, timestamptz, timestamptz, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_param_agg(text, text, timestamptz, timestamptz, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_param_agg(text, text, timestamptz, timestamptz, text, text, numeric) TO service_role;

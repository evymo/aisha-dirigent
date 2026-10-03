-- ============================================================================
-- Source of Truth: storno_values_param
-- Popis: KÓDY STORNA ZDROJE — parametr instance `storno_values` ze
--        source_params bloku (pole řetězců). Které hodnoty pole `storno`
--        znamenají stornovaný doklad, je kódování zdroje (Money: 1 = stornovaný,
--        2 = stornovací doklad, naměřeno 2026-09-26), ne vlastnost platformy.
--        Chybí-li, je to prázdné pole = instance storno nedeklarovala a nic se
--        za storno nepovažuje. Jiný tvar než pole řetězců = chyba (22023).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.storno_values_param(p_params jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v jsonb := p_params->'storno_values';
BEGIN
  IF v IS NULL OR v = 'null'::jsonb THEN
    RETURN '{}'::text[];
  END IF;
  IF jsonb_typeof(v) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) <> 'string') THEN
    RAISE EXCEPTION 'storno_values musí být pole řetězců (kódy storna zdroje), je %', v
      USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(v));
END;
$$;

REVOKE ALL ON FUNCTION public.storno_values_param(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storno_values_param(jsonb) TO authenticated, service_role;

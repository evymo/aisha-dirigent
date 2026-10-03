-- ============================================================================
-- Source of Truth: receivable_from_param
-- Popis: OD KDY JE VYDANÁ FAKTURA POHLEDÁVKOU — parametr instance
--        `receivable_from` ze source_params bloku (issue_date |
--        taxable_supply_date | due_date). Rozhodnutí majitele 2026-09-25:
--        datum VYSTAVENÍ (faktura vystavená dopředu = „předepsáno", ne dluh);
--        bloky instance ho deklarují výslovně. Neznámá hodnota = chyba
--        konfigurace (22023), ne tichý jiný výklad. Volá se JEDNOU na dotaz
--        (cfg čtečky), výsledek jde do invoice_state.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.receivable_from_param(p_params jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text := nullif(btrim(coalesce(p_params->>'receivable_from', '')), '');
BEGIN
  IF v IS NULL THEN
    RETURN 'issue_date';   -- rozhodnutí majitele 2026-09-25, ne odhad
  END IF;
  IF v NOT IN ('issue_date', 'taxable_supply_date', 'due_date') THEN
    RAISE EXCEPTION 'receivable_from=% není známé datum pohledávky (issue_date | taxable_supply_date | due_date)', v
      USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.receivable_from_param(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receivable_from_param(jsonb) TO authenticated, service_role;

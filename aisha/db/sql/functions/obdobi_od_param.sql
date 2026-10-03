-- ============================================================================
-- Source of Truth: obdobi_od_param
-- Popis: ZAČÁTEK MĚSÍCE, za který čtečka počítá (kniha faktur za měsíc) —
--        z parametrů bloku, v tomto pořadí:
--          1. `mesic` (klientský parametr, date: kterýkoli den měsíce) — volba uživatele,
--          2. `obdobi_vychozi` (konfigurace instance): 'aktualni_mesic' = tento měsíc,
--          3. nic = NULL = celá historie (dosavadní chování čteček).
--        Výchozí hodnota je v konfiguraci pod JINÝM klíčem než volba klienta —
--        konfigurace je autoritativní a klíč, který nese, klient nepřepíše
--        (surface_client_params_filter). Neznámá hodnota `obdobi_vychozi` nebo
--        neplatné datum `mesic` = chyba konfigurace/volání (22023), ne tichá
--        celá historie. Volá se JEDNOU na dotaz (cfg čtečky).
-- STABLE: čte current_date.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.obdobi_od_param(p_params jsonb)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mesic   text := nullif(btrim(coalesce(p_params->>'mesic', '')), '');
  v_vychozi text := nullif(btrim(coalesce(p_params->>'obdobi_vychozi', '')), '');
BEGIN
  IF v_mesic IS NOT NULL THEN
    IF v_mesic !~ '^\d{4}-\d{2}-\d{2}' THEN
      RAISE EXCEPTION 'mesic=% není datum (YYYY-MM-DD)', v_mesic USING ERRCODE = '22023';
    END IF;
    RETURN date_trunc('month', left(v_mesic, 10)::date)::date;
  END IF;
  IF v_vychozi IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_vychozi <> 'aktualni_mesic' THEN
    RAISE EXCEPTION 'obdobi_vychozi=% není známé období (aktualni_mesic)', v_vychozi USING ERRCODE = '22023';
  END IF;
  RETURN date_trunc('month', current_date)::date;
END;
$$;

REVOKE ALL ON FUNCTION public.obdobi_od_param(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obdobi_od_param(jsonb) TO authenticated, service_role;

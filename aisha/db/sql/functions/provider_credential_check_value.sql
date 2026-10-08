-- ============================================================================
-- Source of Truth: provider_credential_check_value
-- Popis: Stráž HODNOTY pověření před zápisem do trezoru (administrace i přesun
--        z prostředí). Prázdná hodnota je chyba (smazání má vlastní funkci),
--        mezera nebo konec řádku na kraji je chyba (typická vada vložení, se
--        kterou poskytovatel odmítne každý požadavek — radši nahlas hned),
--        víc než 16 KiB je chyba (token ani klíč tak dlouhý nebývá).
--
-- ⛔ Hodnota se do hlášky NIKDY nevypisuje — ani její délka nebo část.
--
-- Interní pomocník (volají ho jen DEFINER funkce pověření).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provider_credential_check_value(p_value text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value, E' \t\r\n') = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'Hodnota pověření nesmí být prázdná', ERRCODE = '22023';
  END IF;
  IF p_value <> btrim(p_value, E' \t\r\n') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Hodnota pověření nesmí začínat ani končit mezerou, tabulátorem nebo koncem řádku',
      ERRCODE = '22023';
  END IF;
  IF length(p_value) > 16384 THEN
    RAISE EXCEPTION USING MESSAGE = 'Hodnota pověření je delší než 16 KiB', ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_credential_check_value(text) FROM PUBLIC, anon, authenticated, service_role;

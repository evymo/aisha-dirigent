-- ============================================================================
-- Source of Truth: provider_credential_require
-- Popis: Jediná stráž JMÉNA pověření pro zápis i čtení. Jméno musí mít tvar
--        proměnné prostředí (^[A-Z][A-Z0-9_]{2,63}$) a být v katalogu
--        (provider_credential_catalog). Vrací jméno řádku v trezoru:
--        `credential:<JMÉNO>` — vlastní jmenný prostor, takže jméno z katalogu
--        nikdy nepojmenuje systémové tajemství (service_role_key,
--        GITHUB_APP_PRIVATE_KEY, edge_functions_url … leží bez prefixu).
--
-- ⛔ Jméno ve špatném tvaru se do chyby NEVYPISUJE: kdo omylem vloží hodnotu
-- do pole jména, nesmí ji najít v logu PostgRESTu ani v hlášce klienta.
--
-- Interní pomocník (volají ho jen DEFINER funkce pověření).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provider_credential_require(p_env_var text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_env_var IS NULL OR p_env_var !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Neplatné jméno pověření — očekává se jméno proměnné prostředí ^[A-Z][A-Z0-9_]{2,63}$',
      ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.provider_credential_catalog() c WHERE c.env_var = p_env_var) THEN
    RAISE EXCEPTION USING
      MESSAGE = format('Pověření %s není v katalogu — nedeklaruje ho žádný poskytovatel, runtime ani MCP server', p_env_var),
      ERRCODE = '22023';
  END IF;

  RETURN 'credential:' || p_env_var;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_credential_require(text) FROM PUBLIC, anon, authenticated, service_role;

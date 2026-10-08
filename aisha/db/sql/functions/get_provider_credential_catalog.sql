-- ============================================================================
-- Source of Truth: get_provider_credential_catalog
-- Popis: Seznam pověření poskytovatelů AI (a runtime, MCP serverů) pro
--        administraci instance: jméno proměnné, kdo ho používá, jestli je
--        nastavené, kdy a kým naposledy. NIKDY hodnotu ani její část — stav je
--        PŘÍTOMNOST řádku v trezoru (vault.secrets), bez dešifrování.
--
--        Katalog je odvozený z dat (provider_credential_catalog). Navíc vrací
--        „osiřelá" pověření — řádek `credential:*` v trezoru, jehož jméno už nikdo
--        nedeklaruje (např. odinstalovaný plugin) — s prázdným `used_by`, aby je
--        správa viděla a mohla smazat.
--
-- Volá: správa (role admin) z administrace; služba (service_role) — runner podle
-- ní zjistí, které pověření patří runtime běhu (cli:<slug> → jméno proměnné).
-- Čtecí cesta, bez zápisu do auditu (vrací jen jména a čas).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_provider_credential_catalog()
RETURNS TABLE (
  env_var text,
  used_by jsonb,
  is_set boolean,
  updated_at timestamptz,
  updated_by uuid,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (
    public.get_jwt_role() IS NOT DISTINCT FROM 'service_role'
    OR COALESCE(public.has_role(auth.uid(), 'admin'), false)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or service_role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH katalog AS (
    SELECT c.env_var, c.used_by FROM public.provider_credential_catalog() c
  ),
  trezor AS (
    SELECT substr(s.name, length('credential:') + 1) AS env_var,
           s.updated_at,
           CASE WHEN pg_input_is_valid(s.description, 'jsonb') THEN s.description::jsonb END AS popis
      FROM vault.secrets s
     WHERE s.name LIKE 'credential:%'
  ),
  vse AS (
    SELECT k.env_var, k.used_by FROM katalog k
    UNION ALL
    SELECT t.env_var, '[]'::jsonb
      FROM trezor t
     WHERE NOT EXISTS (SELECT 1 FROM katalog k WHERE k.env_var = t.env_var)
  )
  SELECT v.env_var,
         v.used_by,
         (t.env_var IS NOT NULL) AS is_set,
         t.updated_at,
         CASE WHEN pg_input_is_valid(t.popis ->> 'updated_by', 'uuid')
              THEN (t.popis ->> 'updated_by')::uuid END AS updated_by,
         COALESCE(t.popis ->> 'source', CASE WHEN t.env_var IS NOT NULL THEN 'unknown' END) AS source
    FROM vse v
    LEFT JOIN trezor t ON t.env_var = v.env_var
   ORDER BY v.env_var;
END;
$$;

REVOKE ALL ON FUNCTION public.get_provider_credential_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_credential_catalog() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_provider_credential_catalog() IS
  'Admin/služba: katalog pověření (odvozený z registrů) se stavem přítomnosti v trezoru instance — jméno, kdo ho používá, is_set, kdy a kým. Nikdy hodnotu.';

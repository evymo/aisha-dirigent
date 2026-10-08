-- ============================================================================
-- Source of Truth: get_provider_credentials
-- Popis: SLUŽBA si dávkově přečte pověření poskytovatelů z trezoru instance.
--        Vrací řádek pro každé požadované jméno, které je V KATALOGU
--        (provider_credential_catalog), s hodnotou nebo NULL (nenastaveno).
--        Jména mimo katalog IGNORUJE (žádný řádek) — tím čtečka pozná, že jméno
--        administrace nastavit neumí.
--
--   - jen service_role (vzor get_app_secrets_batch: servisní token nemá `sub`,
--     stráž je get_jwt_role, ne auth.uid()),
--   - čte jen `credential:<JMÉNO>` — systémová tajemství (service_role_key,
--     GITHUB_APP_PRIVATE_KEY …) tudy nedostane, ani když by je někdo do katalogu
--     deklaroval,
--   - AUDIT jedním řádkem na volání: jména (požadovaná z katalogu, nastavená,
--     ignorovaná), role; nikdy hodnoty. Čtečka drží mezipaměť ~60 s, takže
--     audit nezahltí audit_journal.
--
-- ⛔ JEDINÝ ČTENÁŘ HODNOT pověření `credential:*` (brána jeden-ctenar-povereni):
-- žádná jiná SQL funkce ani TS kód je z vault.decrypted_secrets / vault.secrets
-- nečte; obecné čtečky trezoru (get_app_secret, _batch, edge_app_secrets) prostor
-- vylučují. PŘECHODNÝ DOMOV (rozhodnutí 2026-10-02): vault `credential:*` za tímto
-- jedním rozhraním (+ čtečka @aisha/security createCredentialReader). Výměna domova
-- podle návrhu „jeden domov pověření" (2026-09-28) = jen implementace téhle funkce
-- a migrace dat — spotřebitelé se nemění.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_provider_credentials(p_env_vars text[])
RETURNS TABLE (env_var text, value text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := public.get_jwt_role();
  v_pozadovano text[];
  v_z_katalogu text[];
  v_nastaveno text[];
  v_ignorovano text[];
  v_spatny_tvar integer;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required' USING ERRCODE = '42501';
  END IF;

  IF p_env_vars IS NULL OR cardinality(p_env_vars) = 0 THEN
    RAISE EXCEPTION 'get_provider_credentials: žádné jméno pověření' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_env_vars) > 200 THEN
    RAISE EXCEPTION 'get_provider_credentials: víc než 200 jmen v jednom volání' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT n ORDER BY n), ARRAY[]::text[])
    INTO v_pozadovano
    FROM unnest(p_env_vars) AS n
   WHERE n IS NOT NULL;

  SELECT COALESCE(array_agg(c.env_var ORDER BY c.env_var), ARRAY[]::text[])
    INTO v_z_katalogu
    FROM public.provider_credential_catalog() c
   WHERE c.env_var = ANY (v_pozadovano);

  -- Přítomnost bez dešifrování (do auditu).
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO v_nastaveno
    FROM unnest(v_z_katalogu) AS k
   WHERE EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'credential:' || k);

  -- Ignorovaná jména zapsat jen ve tvaru jména proměnné; cokoli jiného jen spočítat —
  -- volající mohl omylem poslat hodnotu místo jména.
  SELECT COALESCE(array_agg(n ORDER BY n), ARRAY[]::text[])
    INTO v_ignorovano
    FROM unnest(v_pozadovano) AS n
   WHERE n <> ALL (v_z_katalogu) AND n ~ '^[A-Z][A-Z0-9_]{2,63}$';
  SELECT count(*)::integer
    INTO v_spatny_tvar
    FROM unnest(v_pozadovano) AS n
   WHERE n !~ '^[A-Z][A-Z0-9_]{2,63}$';

  INSERT INTO public.audit_journal (user_id, action, area, severity, entity_type, metadata)
  VALUES (
    NULL,
    'SERVICE_READ_PROVIDER_CREDENTIALS',
    'security',
    'info',
    'provider_credential',
    jsonb_build_object(
      'role', v_role,
      'requested', to_jsonb(v_z_katalogu),
      'set', to_jsonb(v_nastaveno),
      'ignored', to_jsonb(v_ignorovano[1:50]),
      'invalid_name_count', v_spatny_tvar,
      'storage', 'vault'
    )
  );

  RETURN QUERY
  SELECT k AS env_var, ds.decrypted_secret::text AS value
    FROM unnest(v_z_katalogu) AS k
    LEFT JOIN vault.decrypted_secrets ds ON ds.name = 'credential:' || k
   ORDER BY k;
END;
$$;

-- Výslovně i anon/authenticated: grant se po CREATE OR REPLACE nemění a jediný čtenář
-- hodnot nesmí mít cestu pro klienty ani přes dříve udělený grant.
REVOKE ALL ON FUNCTION public.get_provider_credentials(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_credentials(text[]) TO service_role;

COMMENT ON FUNCTION public.get_provider_credentials(text[]) IS
  'Služba: dávkové čtení pověření z katalogu (credential:<JMÉNO> v trezoru instance). Jména mimo katalog ignoruje; audit jedním řádkem na volání bez hodnot.';

-- ============================================================================
-- Source of Truth: set_provider_credential_if_absent
-- Popis: Přesun pověření Z PROSTŘEDÍ SLUŽBY do trezoru instance. Služba při
--        startu pro každé deklarované jméno, které má v env, zavolá tuhle
--        funkci; zapíše se JEN tehdy, když trezor pověření ještě nemá. Hodnotu
--        nastavenou v administraci NIKDY nepřepíše — administrace vyhrává.
--        Tím si každý fork svoje klíče z .env-prod přesune do VLASTNÍHO trezoru
--        sám, bez ručního kroku a bez toho, aby hodnota opustila jeho instanci.
--
--   - jen service_role (stráž get_jwt_role),
--   - jméno musí být v katalogu, hodnota projde stráží hodnoty,
--   - souběh dvou služeb: druhý zápis narazí na UNIQUE(name) → false, nic nepřepíše,
--   - audit „přesunuto z prostředí" jen při skutečném zápisu, bez hodnoty.
--
-- Vrací true = zapsáno teď; false = trezor pověření už měl (nic se nezměnilo).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_provider_credential_if_absent(
  p_env_var text,
  p_value text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := public.get_jwt_role();
  v_name text;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required' USING ERRCODE = '42501';
  END IF;

  v_name := public.provider_credential_require(p_env_var);
  PERFORM public.provider_credential_check_value(p_value);

  IF EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = v_name) THEN
    RETURN false;
  END IF;

  BEGIN
    PERFORM vault.create_secret(
      p_value,
      v_name,
      jsonb_build_object('updated_by', NULL, 'source', 'env')::text
    );
  EXCEPTION WHEN unique_violation THEN
    -- Jiná služba ho zapsala mezi kontrolou a zápisem — její hodnota platí.
    RETURN false;
  END;

  INSERT INTO public.audit_journal (user_id, action, area, severity, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    'PROVIDER_CREDENTIAL_MOVED_FROM_ENV',
    'security',
    'warning',
    'provider_credential',
    p_env_var,
    jsonb_build_object('env_var', p_env_var, 'role', v_role, 'source', 'env', 'storage', 'vault')
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_provider_credential_if_absent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_provider_credential_if_absent(text, text) TO service_role;

COMMENT ON FUNCTION public.set_provider_credential_if_absent(text, text) IS
  'Služba: přesune pověření z prostředí do trezoru instance, jen když tam ještě není (hodnotu z administrace nepřepíše). Audit bez hodnoty.';

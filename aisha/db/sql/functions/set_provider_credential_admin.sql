-- ============================================================================
-- Source of Truth: set_provider_credential_admin
-- Popis: Správa instance nastaví nebo nahradí pověření poskytovatele AI /
--        runtime / MCP serveru (token, API klíč). Každý fork = vlastní DB =
--        vlastní trezor, takže nastavení je per instance samo od sebe.
--
--   - jen role admin (jako set_api_key_admin),
--   - jméno musí být v katalogu (provider_credential_require — odvozeno z dat),
--   - hodnota: prázdná je chyba, mezera/konec řádku na kraji je chyba,
--   - zápis JEN do trezoru (vault.secrets, šifrovaně) pod `credential:<JMÉNO>`,
--   - audit bez hodnoty (jméno, vytvořeno/nahrazeno).
--
-- ⛔ Hodnota přichází JEN parametrem RPC (tělo JSON přes PostgREST) — nikdy
-- v textu SQL, kde by ji při chybě zalogoval log_min_error_statement.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_provider_credential_admin(
  p_env_var text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text;
  v_existing_id uuid;
  v_operation text;
  v_description text;
BEGIN
  IF NOT COALESCE(public.has_role(v_user_id, 'admin'), false) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  v_name := public.provider_credential_require(p_env_var);
  PERFORM public.provider_credential_check_value(p_value);

  v_description := jsonb_build_object('updated_by', v_user_id, 'source', 'admin')::text;

  SELECT s.id INTO v_existing_id FROM vault.secrets s WHERE s.name = v_name FOR UPDATE;

  IF v_existing_id IS NULL THEN
    PERFORM vault.create_secret(p_value, v_name, v_description);
    v_operation := 'created';
  ELSE
    PERFORM vault.update_secret(v_existing_id, p_value, v_name, v_description);
    v_operation := 'replaced';
  END IF;

  -- Audit BEZ hodnoty (ani délky, ani otisku): jméno a druh zásahu.
  INSERT INTO public.audit_journal (user_id, action, area, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'ADMIN_SET_PROVIDER_CREDENTIAL',
    'admin',
    'warning',
    'provider_credential',
    p_env_var,
    jsonb_build_object('env_var', p_env_var, 'operation', v_operation, 'storage', 'vault')
  );

  RETURN jsonb_build_object('success', true, 'env_var', p_env_var, 'operation', v_operation);
END;
$$;

REVOKE ALL ON FUNCTION public.set_provider_credential_admin(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_provider_credential_admin(text, text) TO authenticated;

COMMENT ON FUNCTION public.set_provider_credential_admin(text, text) IS
  'Admin: nastaví/nahradí pověření z katalogu (credential:<JMÉNO> v trezoru instance). Audit bez hodnoty.';

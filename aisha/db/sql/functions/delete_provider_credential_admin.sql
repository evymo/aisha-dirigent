-- ============================================================================
-- Source of Truth: delete_provider_credential_admin
-- Popis: Správa instance smaže pověření z trezoru (`credential:<JMÉNO>`).
--        Jméno musí mít tvar proměnné prostředí; NEMUSÍ být v katalogu — smazat
--        jde i osiřelé pověření, které už nikdo nedeklaruje (odinstalovaný
--        plugin, smazaný MCP server). Systémové tajemství smazat nejde: prefix
--        `credential:` ho nikdy nepojmenuje.
--
--   - jen role admin,
--   - audit bez hodnoty (jméno, jestli něco smazal).
--
-- Po smazání služba pověření nemá (čtečka vrátí null, nebo — dokud je v env
-- služby — PŘECHODNĚ hodnotu z prostředí s hlasitým varováním).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_provider_credential_admin(p_env_var text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted_id uuid;
BEGIN
  IF NOT COALESCE(public.has_role(v_user_id, 'admin'), false) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_env_var IS NULL OR p_env_var !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Neplatné jméno pověření — očekává se jméno proměnné prostředí ^[A-Z][A-Z0-9_]{2,63}$',
      ERRCODE = '22023';
  END IF;

  DELETE FROM vault.secrets s
   WHERE s.name = 'credential:' || p_env_var
  RETURNING s.id INTO v_deleted_id;

  INSERT INTO public.audit_journal (user_id, action, area, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'ADMIN_DELETE_PROVIDER_CREDENTIAL',
    'admin',
    'warning',
    'provider_credential',
    p_env_var,
    jsonb_build_object('env_var', p_env_var, 'deleted', v_deleted_id IS NOT NULL, 'storage', 'vault')
  );

  RETURN jsonb_build_object('success', true, 'env_var', p_env_var, 'deleted', v_deleted_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_provider_credential_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_provider_credential_admin(text) TO authenticated;

COMMENT ON FUNCTION public.delete_provider_credential_admin(text) IS
  'Admin: smaže pověření credential:<JMÉNO> z trezoru instance (i osiřelé). Audit bez hodnoty.';

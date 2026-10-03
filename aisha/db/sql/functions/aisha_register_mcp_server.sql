-- Function: aisha_register_mcp_server
-- Admin/staff registers a new MCP server into mcp_server_registry. Status starts
-- at 'discovered'; AISHA must then run aisha_test_mcp_server before bumping to
-- 'tested_ok' or 'tested_failed'. If exposes_llm=true and tests pass, AISHA
-- pairs it into ai_provider_registry as backend_kind='mcp_server'.

-- ⛔ VLASTNICTVÍ A POVĚŘENÍ (2026-09-29): `slug` je globální klíč. Dřív DO UPDATE
--    přepsal transport/endpoint/stdio_command serveru, který zaregistroval KDOKOLI
--    jiný, a ponechal mu `auth_kind`/`auth_env_var` i `status` — schválený server šel
--    přesměrovat i s jeho tajemstvím (aisha_test_mcp_server → svc-ai-chat pošle token
--    z `auth_env_var` na nový endpoint). Teď: existující registraci mění jen týž
--    vlastník (`source`, `registered_by` — IS NOT DISTINCT FROM, služba má NULL),
--    jinak 42501 s klíčem a vlastníkem. Při změně transportu, endpointu nebo příkazu
--    se vazba na tajemství NEPŘEVEZME: `auth_kind`/`auth_env_var` = jen to, co volající
--    deklaruje spolu se změnou (bez nich NULL), a `status` = 'discovered' (znovu otestovat).
CREATE OR REPLACE FUNCTION public.aisha_register_mcp_server(
  p_slug text,
  p_display_name text,
  p_transport text,
  p_endpoint_url text DEFAULT NULL,
  p_stdio_command text[] DEFAULT NULL,
  p_auth_kind text DEFAULT 'bearer',
  p_auth_env_var text DEFAULT NULL,
  p_capability_tags text[] DEFAULT '{}'::text[],
  p_exposes_llm boolean DEFAULT false,
  p_description text DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_user_id uuid;
  v_zdroj   text;
  v_kdo     uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'admin_or_staff role required' USING ERRCODE = '22023';
  END IF;

  IF p_slug IS NULL OR p_slug = '' THEN
    RAISE EXCEPTION 'p_slug is required' USING ERRCODE = '22023';
  END IF;
  IF p_transport NOT IN ('http', 'sse', 'stdio', 'websocket') THEN
    RAISE EXCEPTION 'Invalid transport: %', p_transport USING ERRCODE = '22023';
  END IF;
  IF p_transport IN ('http', 'sse', 'websocket') AND (p_endpoint_url IS NULL OR p_endpoint_url = '') THEN
    RAISE EXCEPTION 'p_endpoint_url is required for transport %', p_transport USING ERRCODE = '22023';
  END IF;
  IF p_transport = 'stdio' AND (p_stdio_command IS NULL OR array_length(p_stdio_command, 1) IS NULL) THEN
    RAISE EXCEPTION 'p_stdio_command is required for stdio transport' USING ERRCODE = '22023';
  END IF;

  v_user_id := auth.uid();

  SELECT r.source, r.registered_by INTO v_zdroj, v_kdo
    FROM mcp_server_registry r
   WHERE r.slug = p_slug
   FOR UPDATE;
  IF FOUND AND (v_zdroj IS DISTINCT FROM p_source OR v_kdo IS DISTINCT FROM v_user_id) THEN
    RAISE EXCEPTION 'MCP server % is registered by another owner (source %, registered_by %)',
      p_slug, COALESCE(v_zdroj, '(none)'), COALESCE(v_kdo::text, '(service)')
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO mcp_server_registry (
    slug, display_name, description, transport, endpoint_url, stdio_command,
    auth_kind, auth_env_var, capability_tags, exposes_llm, status,
    source, registered_by, metadata
  )
  VALUES (
    p_slug, p_display_name, p_description, p_transport, p_endpoint_url, p_stdio_command,
    p_auth_kind, p_auth_env_var, p_capability_tags, p_exposes_llm, 'discovered',
    p_source, v_user_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (slug) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      transport = EXCLUDED.transport,
      endpoint_url = EXCLUDED.endpoint_url,
      stdio_command = EXCLUDED.stdio_command,
      capability_tags = EXCLUDED.capability_tags,
      exposes_llm = EXCLUDED.exposes_llm,
      metadata = mcp_server_registry.metadata || EXCLUDED.metadata,
      -- Jiný cíl → vazba na tajemství jen znovu deklarovaná, server znovu k otestování.
      auth_kind = CASE WHEN (mcp_server_registry.transport, mcp_server_registry.endpoint_url, mcp_server_registry.stdio_command)
                            IS DISTINCT FROM (EXCLUDED.transport, EXCLUDED.endpoint_url, EXCLUDED.stdio_command)
                       THEN EXCLUDED.auth_kind ELSE mcp_server_registry.auth_kind END,
      auth_env_var = CASE WHEN (mcp_server_registry.transport, mcp_server_registry.endpoint_url, mcp_server_registry.stdio_command)
                               IS DISTINCT FROM (EXCLUDED.transport, EXCLUDED.endpoint_url, EXCLUDED.stdio_command)
                          THEN EXCLUDED.auth_env_var ELSE mcp_server_registry.auth_env_var END,
      status = CASE WHEN (mcp_server_registry.transport, mcp_server_registry.endpoint_url, mcp_server_registry.stdio_command)
                         IS DISTINCT FROM (EXCLUDED.transport, EXCLUDED.endpoint_url, EXCLUDED.stdio_command)
                    THEN 'discovered' ELSE mcp_server_registry.status END,
      updated_at = now()
  WHERE mcp_server_registry.source IS NOT DISTINCT FROM EXCLUDED.source
    AND mcp_server_registry.registered_by IS NOT DISTINCT FROM EXCLUDED.registered_by
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Souběh: registrace změnila vlastníka mezi kontrolou a zápisem — nic se nepřevzalo.
    RAISE EXCEPTION 'MCP server % is registered by another owner', p_slug USING ERRCODE = '42501';
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id, 'mcp.server_registered',
    jsonb_build_object(
      'mcp_server_id', v_id, 'slug', p_slug, 'transport', p_transport,
      'exposes_llm', p_exposes_llm, 'capability_tags', p_capability_tags
    )
  );

  RETURN jsonb_build_object('mcp_server_id', v_id, 'slug', p_slug, 'status', 'discovered');
END;
$$;

COMMENT ON FUNCTION public.aisha_register_mcp_server(text, text, text, text, text[], text, text, text[], boolean, text, text, jsonb) IS
  'Admin/staff registers a new MCP server. Starts at status=discovered; AISHA tests it before use.';

REVOKE ALL ON FUNCTION public.aisha_register_mcp_server(text, text, text, text, text[], text, text, text[], boolean, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_register_mcp_server(text, text, text, text, text[], text, text, text[], boolean, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_register_mcp_server(text, text, text, text, text[], text, text, text[], boolean, text, text, jsonb) TO service_role;

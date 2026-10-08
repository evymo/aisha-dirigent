-- ============================================================================
-- Source of Truth: provider_credential_catalog
-- Popis: KATALOG pověření, která si správa instance (každý fork = vlastní DB
--        a vlastní trezor) nastaví v administraci. ODVOZENÝ z dat — žádný seznam
--        jmen v kódu:
--          ai_provider_registry.auth_env_var      (poskytovatelé modelů)
--          ai_runtime_registry.credential_env_var (runtime, např. cli:claude-cli)
--          mcp_server_registry.auth_env_var       (MCP servery — sondy mcp_test)
--        Přidat poskytovatele/runtime/MCP server s deklarovaným jménem proměnné =
--        pověření se v administraci objeví samo; nic dalšího se neudržuje.
--
--        BEZ pověření, která generuje platforma (2026-10-02, rozhodnutí majitele):
--        poskytovatel s backend_kind = 'llm_gateway' (AISHA_LLM_GATEWAY_KEY, LLM_GW_API_KEY)
--        má klíč z cold-startu, který zná i druhá strana spojení — kdyby ho správa
--        vyměnila v trezoru, klienti by se s bránou rozešli. Odvozeno z vlastnosti
--        poskytovatele, ne ze seznamu jmen.
--
-- Vrací JMÉNA a kdo je používá — nikdy hodnotu (ta je v trezoru pod
-- `credential:<JMÉNO>`, viz get_provider_credentials). Jméno, které neodpovídá
-- ^[A-Z][A-Z0-9_]{2,63}$, do katalogu nepatří (deklaraci nikdo nečte jako hodnotu).
--
-- ⛔ VLASTNÍ JMENNÝ PROSTOR: řádky katalogu smí zakládat i pluginy
-- (materialize_backend_provider) a správa (MCP registr). Kdyby katalog ukazoval
-- přímo do vault.secrets, plugin s auth_env_var='GITHUB_APP_PRIVATE_KEY' by
-- přepsal/přečetl systémové tajemství. Proto se do trezoru přistupuje VŽDY přes
-- prefix `credential:` — jméno z katalogu systémové tajemství nikdy nepojmenuje.
--
-- Interní pomocník: volají ho jen SECURITY DEFINER funkce pověření (vlastník),
-- žádná role ho nevolá napřímo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provider_credential_catalog()
RETURNS TABLE (env_var text, used_by jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH deklarace AS (
    SELECT p.auth_env_var AS env_var, 'provider'::text AS kind, p.slug, p.display_name
      FROM public.ai_provider_registry p
     WHERE p.auth_env_var IS NOT NULL
       AND p.backend_kind <> 'llm_gateway'
    UNION ALL
    SELECT r.credential_env_var, 'runtime'::text, r.slug, r.display_name
      FROM public.ai_runtime_registry r
     WHERE r.credential_env_var IS NOT NULL
    UNION ALL
    SELECT m.auth_env_var, 'mcp_server'::text, m.slug, m.display_name
      FROM public.mcp_server_registry m
     WHERE m.auth_env_var IS NOT NULL
  )
  SELECT d.env_var,
         jsonb_agg(
           jsonb_build_object('kind', d.kind, 'slug', d.slug, 'display_name', d.display_name)
           ORDER BY d.kind, d.slug
         ) AS used_by
    FROM deklarace d
   WHERE d.env_var ~ '^[A-Z][A-Z0-9_]{2,63}$'
   GROUP BY d.env_var;
$$;

REVOKE ALL ON FUNCTION public.provider_credential_catalog() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.provider_credential_catalog() IS
  'Interní: katalog pověření odvozený z ai_provider_registry.auth_env_var ∪ ai_runtime_registry.credential_env_var ∪ mcp_server_registry.auth_env_var. Jen jména a kdo je používá, nikdy hodnoty.';

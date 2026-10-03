-- =============================================================================
-- get_available_plugins(p_kind, p_tenant_id) — KATALOG pluginů
-- =============================================================================
-- Vrací instalovatelné pluginy (status canary/ga), volitelně jen daného druhu.
-- S p_tenant_id vynechá pluginy, které si tenant vypnul
-- (plugin_tenant_overrides.enabled = false).
--
-- Volající (naměřeno 2026-09-15):
--   · SPA `/agents` (veřejná routa, loader bez RequireAuth) — anon i
--     authenticated, p_kind='agent', bez tenanta
--   · svc-plugin-system `/registry` a `resolvePlugin` — service_role, bez tenanta
--   · broker sandboxu `/sandbox/rpc` — service_role s parametry, které zvolí
--     PLUGIN (pokud instance funkci povolí v PLUGIN_RPC_WHITELIST; šablona
--     scaffoldu ji pluginům dává jako výchozí schopnost)
--
-- ⛔ KATALOG NENESE KONFIGURACI PLUGINU (2026-09-15). Dřív projektoval
-- `plugin_tenant_overrides.config_override` jako `config` — a v něm žijí
-- přihlašovací údaje konektorů (tokeny, hesla, API klíče dodavatelů). Funkce je
-- SECURITY DEFINER, takže RLS tabulky overrides neplatila: stačil anon klíč a
-- p_tenant_id. Rozhoduje ÚČEL, ne jména klíčů: tajemství v konfiguraci nejde
-- vyjmenovat, a proto ji katalog nevydá nikomu. Ani service_role — tu roli
-- nese i broker, kterým se ptá plugin. Konfigurace má domov v tabulce pod RLS
-- (tenant sám, admin/staff, služba); běhová cesta k ní patří k rozlišení
-- tenanta v svc-plugin-system, ne ke katalogu.
--
-- ⛔ p_tenant_id ČTE overrides TENANTA. RLS tabulky to dovoluje jen tenantovi
-- samotnému (`tenant_id = auth.uid()`) a admin/staff; DEFINER ji obchází, takže
-- tentýž nárok tu stojí explicitně (+ služba). Bez něj by anon zjistil, co si
-- cizí tenant vypnul. Nárok se počítá JEDNOU do proměnné a je TOTÁLNÍ:
-- `p_tenant_id = auth.uid()` je pro anon NULL a `NOT NULL` by guard otevřel.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_available_plugins(
  p_kind    text DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_smi_tenanta boolean;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    v_smi_tenanta := public.is_service_role()
                  OR COALESCE(p_tenant_id = auth.uid(), false)
                  OR public.is_admin_or_staff();
    IF NOT v_smi_tenanta THEN
      RAISE EXCEPTION 'Unauthorized: plugin overrides of another tenant'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_agg(row_to_json(sub))
  INTO v_result
  FROM (
    SELECT
      pc.id            AS plugin_id,
      pc.slug,
      pc.name,
      pc.description,
      pc.kind::text,
      pc.trust_tier::text,
      pc.status::text,
      pc.capabilities,
      COALESCE(pc.sandbox_policy, '{}'::jsonb)   AS sandbox,
      CASE
        WHEN pc.kind IN ('auth_provider', 'backend_provider') THEN 'cold'
        WHEN pc.lifecycle->>'load_strategy' = 'cold' THEN 'cold'
        ELSE 'hot'
      END AS load_strategy,
      pv.artifact_url,
      pv.artifact_sha256,
      pv.version
    FROM public.plugin_catalog pc
    -- Latest version (highest semver = latest created_at)
    LEFT JOIN LATERAL (
      SELECT artifact_url, artifact_sha256, version
      FROM public.plugin_versions
      WHERE plugin_id = pc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pv ON true
    -- Tenant override (if tenant_id provided and authorized above) — only the
    -- `enabled` flag is read; config_override never leaves this join.
    LEFT JOIN public.plugin_tenant_overrides pto
      ON pto.plugin_id = pc.id
      AND pto.tenant_id = p_tenant_id
    WHERE pc.status IN ('canary', 'ga')
      AND (p_kind IS NULL OR pc.kind::text = p_kind)
      -- If tenant override exists and disabled, exclude
      AND (pto.id IS NULL OR pto.enabled = true)
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_available_plugins(text, uuid) IS
  'Plugin catalog (canary/ga), optionally per kind; p_tenant_id (tenant itself, admin/staff or service_role only) hides plugins the tenant disabled. Never returns plugin configuration (config_override carries vendor credentials).';

REVOKE ALL ON FUNCTION public.get_available_plugins(text, uuid) FROM PUBLIC;
-- anon: veřejná routa /agents; authenticated: SPA přihlášeného; service_role:
-- svc-plugin-system (registry, resolvePlugin, broker).
GRANT EXECUTE ON FUNCTION public.get_available_plugins(text, uuid) TO anon, authenticated, service_role;

-- ============================================================================
-- Source of Truth: record_plugin_declaration
-- Popis: Host zapíše výsledek zapálení pluginu (běh jen-deklaruj) pro tenanta:
--        verzi, ok/failed a detail (počty zapsaných/odmítnutých rozvrhů, chyba).
--        Nová verze nebo selhání tak znamená opakování, úspěch klid.
--
-- ⛔ Do `detail` NIKDY hodnoty konfigurace ani pověření — jen počty, důvody
-- odmítnutí rozvrhů a zkrácený text chyby (host ho krátí na 200 znaků).
-- Bezpečnost: jen služba.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_plugin_declaration(
  p_plugin_slug    text,
  p_tenant_id      uuid,
  p_plugin_version text,
  p_status         text,
  p_detail         jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plugin_id uuid;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'record_plugin_declaration: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('ok', 'failed') THEN
    RAISE EXCEPTION 'record_plugin_declaration: status musí být ok|failed';
  END IF;
  IF p_tenant_id IS NULL OR NULLIF(btrim(COALESCE(p_plugin_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'record_plugin_declaration: tenant a verze jsou povinné';
  END IF;
  SELECT id INTO v_plugin_id FROM public.plugin_catalog WHERE slug = p_plugin_slug;
  IF v_plugin_id IS NULL THEN
    RAISE EXCEPTION 'record_plugin_declaration: plugin % neexistuje', p_plugin_slug;
  END IF;

  INSERT INTO public.plugin_declarations (plugin_id, tenant_id, plugin_version, status, detail, declared_at)
  VALUES (v_plugin_id, p_tenant_id, p_plugin_version, p_status,
          CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END, now())
  ON CONFLICT (plugin_id, tenant_id) DO UPDATE
    SET plugin_version = EXCLUDED.plugin_version,
        status         = EXCLUDED.status,
        detail         = EXCLUDED.detail,
        declared_at    = EXCLUDED.declared_at;
END;
$$;

COMMENT ON FUNCTION public.record_plugin_declaration(text, uuid, text, text, jsonb) IS
  'Records the outcome of a plugin ignition (declare-only run) for a tenant: version, ok/failed, detail without secrets. Service only.';

REVOKE ALL ON FUNCTION public.record_plugin_declaration(text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_plugin_declaration(text, uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_plugin_declaration(text, uuid, text, text, jsonb) TO service_role;

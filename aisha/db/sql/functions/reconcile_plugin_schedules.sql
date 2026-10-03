-- =============================================================================
-- reconcile_plugin_schedules(p_plugin_slug, p_tenant_id, p_declarations)
--
-- Zapíše rozvrhy, které plugin deklaroval v init() (ctx.schedule(cron, capability)),
-- pro jednoho tenanta — a VYPNE ty, které už nedeklaruje.
--
-- ⛔ NAMĚŘENO 2026-09-16: `plugin_schedules` nikdo neplnil ani nečetl;
-- `register_plugin_schedule` neměl volajícího a byl povolený KAŽDÉMU přihlášenému
-- bez kontroly nároku. Cron capability pluginů proto nikdy neběžely.
--
-- Jen služba (svc-plugin-system po úspěšném běhu pluginu). Deklarace se
-- VALIDUJÍ, nevěří se jim: capability musí být `cron.*` a v manifestu pluginu,
-- cron pět polí. Neplatné se nezapíšou a vrátí se v `odmitnuto` — host je nahlásí.
-- `next_run_at` spočítá host (parser cronu žije v Node, ne v SQL).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reconcile_plugin_schedules(
  p_plugin_slug  text,
  p_tenant_id    uuid,
  p_declarations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plugin   public.plugin_catalog%ROWTYPE;
  v_dekl     jsonb;
  v_cap      text;
  v_cron     text;
  v_next     timestamptz;
  v_platne   text[] := ARRAY[]::text[];
  v_odmitnuto jsonb := '[]'::jsonb;
  v_zapsano  int := 0;
  v_vypnuto  int := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'reconcile_plugin_schedules: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_plugin_slug IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'reconcile_plugin_schedules: plugin_slug a tenant_id jsou povinné';
  END IF;
  IF p_declarations IS NULL OR jsonb_typeof(p_declarations) <> 'array' THEN
    RAISE EXCEPTION 'reconcile_plugin_schedules: deklarace musí být pole';
  END IF;

  SELECT * INTO v_plugin FROM public.plugin_catalog WHERE slug = p_plugin_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconcile_plugin_schedules: plugin % neexistuje', p_plugin_slug;
  END IF;

  FOR v_dekl IN SELECT * FROM jsonb_array_elements(p_declarations) LOOP
    v_cap  := v_dekl->>'capability';
    v_cron := btrim(COALESCE(v_dekl->>'cron', ''));
    IF v_cap IS NULL THEN
      v_odmitnuto := v_odmitnuto || jsonb_build_object('deklarace', v_dekl, 'duvod', 'chybí capability (starý tvar schedule(cron, fn))');
    ELSIF v_cap NOT LIKE 'cron.%' OR NOT (v_plugin.capabilities ? v_cap) THEN
      v_odmitnuto := v_odmitnuto || jsonb_build_object('deklarace', v_dekl, 'duvod', 'capability není cron.* z manifestu pluginu');
    ELSIF v_cron !~ '^\S+\s+\S+\s+\S+\s+\S+\s+\S+$' THEN
      v_odmitnuto := v_odmitnuto || jsonb_build_object('deklarace', v_dekl, 'duvod', 'cron nemá pět polí');
    ELSIF v_cap = ANY(v_platne) THEN
      v_odmitnuto := v_odmitnuto || jsonb_build_object('deklarace', v_dekl, 'duvod', 'capability deklarovaná dvakrát');
    -- Manifest říká, co plugin UMÍ; zdroj dat, co SMÍ (plugin_capability_allowed).
    -- Neudělená schopnost se nezapíše a už zapsaný rozvrh vypne UPDATE níž
    -- (není v v_platne) — odebrání povolení tak rozvrh zastaví i bez nového běhu.
    ELSIF NOT public.plugin_capability_allowed(v_plugin.id, v_cap) THEN
      v_odmitnuto := v_odmitnuto || jsonb_build_object('deklarace', v_dekl, 'duvod', 'neudělená schopnost (granted_capabilities zdroje) nebo vypnutý zdroj');
    ELSE
      BEGIN
        v_next := NULLIF(v_dekl->>'next_run_at', '')::timestamptz;
      EXCEPTION WHEN others THEN
        v_next := NULL;
      END;
      INSERT INTO public.plugin_schedules (plugin_id, tenant_id, cron_expr, handler_capability, enabled, next_run_at)
      VALUES (v_plugin.id, p_tenant_id, v_cron, v_cap, true, v_next)
      ON CONFLICT (plugin_id, tenant_id, handler_capability) DO UPDATE
        SET cron_expr   = EXCLUDED.cron_expr,
            enabled     = true,
            -- změněný cron = nový termín; stejný cron nechá běžící rozpis být
            next_run_at = CASE WHEN plugin_schedules.cron_expr IS DISTINCT FROM EXCLUDED.cron_expr
                                 OR plugin_schedules.next_run_at IS NULL
                               THEN EXCLUDED.next_run_at
                               ELSE plugin_schedules.next_run_at END,
            updated_at  = now();
      v_platne  := v_platne || v_cap;
      v_zapsano := v_zapsano + 1;
    END IF;
  END LOOP;

  UPDATE public.plugin_schedules
     SET enabled = false, updated_at = now()
   WHERE plugin_id = v_plugin.id
     AND tenant_id = p_tenant_id
     AND enabled
     AND NOT (handler_capability = ANY(v_platne));
  GET DIAGNOSTICS v_vypnuto = ROW_COUNT;

  RETURN jsonb_build_object('zapsano', v_zapsano, 'vypnuto', v_vypnuto, 'odmitnuto', v_odmitnuto);
END;
$$;

COMMENT ON FUNCTION public.reconcile_plugin_schedules(text, uuid, jsonb) IS
  'Zapíše rozvrhy deklarované pluginem v init() pro tenanta (validované proti manifestu) a vypne nedeklarované. Jen služba.';

REVOKE ALL ON FUNCTION public.reconcile_plugin_schedules(text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_plugin_schedules(text, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_plugin_schedules(text, uuid, jsonb) TO service_role;

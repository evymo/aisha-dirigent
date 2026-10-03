-- ============================================================================
-- register_plugin_schedule — Register/update a cron-scheduled task for a plugin
-- Called by plugin-host when plugin calls SandboxContext.schedule()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_plugin_schedule(
  p_cron_expr text DEFAULT NULL,
  p_enabled boolean DEFAULT true,
  p_handler_capability text DEFAULT NULL,
  p_plugin_id uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_schedule_id uuid;
BEGIN
  -- ⛔ NAMĚŘENO 2026-09-16: funkce byla SECURITY DEFINER, povolená KAŽDÉMU
  -- přihlášenému a bez kontroly nároku — kdokoli mohl zapsat rozvrh cizímu
  -- pluginu a tenantovi, a jakmile plánovač rozvrhy spouští, byla by to cesta
  -- k běhu pluginu nad daty cizího tenanta. Rozvrhy zapisuje host
  -- (reconcile_plugin_schedules); ručně jen služba nebo admin/staff.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'register_plugin_schedule: jen služba nebo admin/staff' USING ERRCODE = '42501';
  END IF;
  IF p_plugin_id IS NULL OR p_tenant_id IS NULL OR p_handler_capability IS NULL THEN
    RAISE EXCEPTION 'plugin_id, tenant_id, and handler_capability are required';
  END IF;

  INSERT INTO public.plugin_schedules (plugin_id, tenant_id, cron_expr, handler_capability, enabled)
  VALUES (p_plugin_id, p_tenant_id, p_cron_expr, p_handler_capability, p_enabled)
  ON CONFLICT (plugin_id, tenant_id, handler_capability) DO UPDATE
    SET cron_expr = EXCLUDED.cron_expr,
        enabled = EXCLUDED.enabled,
        updated_at = now()
  RETURNING id INTO v_schedule_id;

  RETURN jsonb_build_object('schedule_id', v_schedule_id, 'ok', true);
END;
$$;

COMMENT ON FUNCTION public.register_plugin_schedule(text, boolean, text, uuid, uuid) IS 'Register or update a cron-scheduled task for a plugin.';

REVOKE ALL ON FUNCTION public.register_plugin_schedule(text, boolean, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_plugin_schedule(text, boolean, text, uuid, uuid) TO authenticated, service_role;

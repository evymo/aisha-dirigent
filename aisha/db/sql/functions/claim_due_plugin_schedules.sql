-- =============================================================================
-- claim_due_plugin_schedules(p_limit, p_lease_seconds)
--
-- Plánovač v svc-plugin-system si ATOMICKY zabere splatné rozvrhy (SKIP LOCKED)
-- a odloží je o pronájem, takže ani víc replik téhož hostu nespustí týž rozvrh
-- dvakrát. Po běhu host zapíše skutečný příští termín (set_plugin_schedule_next_run);
-- když host mezitím spadne, pronájem vyprší a rozvrh se zabere znovu.
--
-- Spouští se jen rozvrh pluginu v provozu (canary/ga) a tenanta, který si plugin
-- nevypnul (plugin_tenant_overrides.enabled) — tatáž pravidla jako katalog.
-- A jen schopnost, kterou zdroj dat pluginu povolil a který je zapnutý
-- (plugin_capability_allowed) — rozhoduje se při každém zabrání, ne jednou.
-- Vzor převzat z claim_queued_claude_run (svc-agent-runner poller).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_due_plugin_schedules(
  p_limit         integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 900
)
RETURNS TABLE (
  schedule_id        uuid,
  plugin_slug        text,
  tenant_id          uuid,
  handler_capability text,
  cron_expr          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'claim_due_plugin_schedules: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_lease_seconds IS NULL OR p_lease_seconds < 30 THEN
    RAISE EXCEPTION 'claim_due_plugin_schedules: limit >= 1 a pronájem >= 30 s';
  END IF;

  RETURN QUERY
  WITH splatne AS (
    SELECT s.id
      FROM public.plugin_schedules s
      JOIN public.plugin_catalog pc ON pc.id = s.plugin_id
      LEFT JOIN public.plugin_tenant_overrides pto
        ON pto.plugin_id = s.plugin_id AND pto.tenant_id = s.tenant_id
     WHERE s.enabled
       AND pc.status IN ('canary', 'ga')
       AND (pto.id IS NULL OR pto.enabled)
       -- Zdroj dat rozhoduje v okamžiku BĚHU, ne jen při zápisu rozvrhu:
       -- vypnutí zdroje nebo odebrání povolení zastaví i rozvrh zapsaný dřív.
       AND public.plugin_capability_allowed(s.plugin_id, s.handler_capability)
       AND s.next_run_at IS NOT NULL
       AND s.next_run_at <= now()
     ORDER BY s.next_run_at
     LIMIT p_limit
       FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.plugin_schedules ps
     SET last_run_at = now(),
         next_run_at = now() + make_interval(secs => p_lease_seconds),
         updated_at  = now()
    FROM splatne, public.plugin_catalog pc
   WHERE ps.id = splatne.id
     AND pc.id = ps.plugin_id
  RETURNING ps.id, pc.slug, ps.tenant_id, ps.handler_capability, ps.cron_expr;
END;
$$;

COMMENT ON FUNCTION public.claim_due_plugin_schedules(integer, integer) IS
  'Atomicky zabere splatné rozvrhy pluginů (SKIP LOCKED) a odloží je o pronájem. Jen služba.';

REVOKE ALL ON FUNCTION public.claim_due_plugin_schedules(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_plugin_schedules(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_plugin_schedules(integer, integer) TO service_role;

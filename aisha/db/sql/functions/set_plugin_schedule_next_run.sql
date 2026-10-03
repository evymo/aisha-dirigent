-- =============================================================================
-- set_plugin_schedule_next_run(p_schedule_id, p_next_run_at)
--
-- Po běhu naplánované capability host zapíše skutečný příští termín spočítaný
-- z cronu (claim_due_plugin_schedules ho mezitím držel na pronájmu). Jen služba.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_plugin_schedule_next_run(
  p_schedule_id uuid,
  p_next_run_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'set_plugin_schedule_next_run: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_schedule_id IS NULL OR p_next_run_at IS NULL THEN
    RAISE EXCEPTION 'set_plugin_schedule_next_run: schedule_id a next_run_at jsou povinné';
  END IF;
  UPDATE public.plugin_schedules
     SET next_run_at = p_next_run_at, updated_at = now()
   WHERE id = p_schedule_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.set_plugin_schedule_next_run(uuid, timestamptz) IS
  'Zapíše příští termín rozvrhu pluginu po běhu. Jen služba.';

REVOKE ALL ON FUNCTION public.set_plugin_schedule_next_run(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_plugin_schedule_next_run(uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plugin_schedule_next_run(uuid, timestamptz) TO service_role;

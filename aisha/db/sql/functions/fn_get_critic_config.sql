-- Source of Truth: fn_get_critic_config (Step 5)
-- Used by services/svc-ai-chat critic loop initialization.
-- Migration: aisha/db/migrations/20260518250000_critic_loop.sql

CREATE OR REPLACE FUNCTION public.fn_get_critic_config(p_profile_slug text)
RETURNS TABLE (
  critic_enabled         boolean,
  critic_threshold       numeric,
  critic_max_iterations  smallint,
  critic_strategies      text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT cp.critic_enabled, cp.critic_threshold,
         cp.critic_max_iterations, cp.critic_strategies
    FROM public.context_profiles cp
   WHERE cp.slug = p_profile_slug
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_critic_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_critic_config(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_critic_config(text) TO service_role;

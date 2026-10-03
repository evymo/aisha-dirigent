-- ============================================================================
-- Source of Truth: get_active_web_tracking
-- Purpose: THE consumer seam of web_tracking_registry. The web surface calls
--          this at boot and loads each returned tracker ONLY after the visitor
--          has granted its consent_category — the registry declares, this RPC
--          filters enabled+scope, the client's consent state gates loading.
--          A tracker that is disabled, out of scope, or unconsented is never
--          loaded; there is no other injection path.
-- SECURITY DEFINER so the anonymous web surface can read the deliberate
-- public shape (direct table read stays authenticated+scoped via RLS).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_active_web_tracking()
RETURNS TABLE (
  slug             text,
  provider         text,
  script_url       text,
  site_id          text,
  consent_category text,
  config           jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.slug, r.provider, r.script_url, r.site_id, r.consent_category,
         COALESCE(r.config, '{}'::jsonb) AS config
    FROM public.web_tracking_registry r
   WHERE r.is_enabled
     AND (
       r.scoped_to_instance_id IS NULL
       OR r.scoped_to_instance_id = NULLIF(current_setting('aisha.instance_id', true), '')::uuid
     )
   ORDER BY r.slug;
$$;

COMMENT ON FUNCTION public.get_active_web_tracking() IS
  'Web-surface enumeration of enabled trackers; the client loads each only after the visitor granted its consent_category.';

REVOKE ALL ON FUNCTION public.get_active_web_tracking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_web_tracking() TO anon, authenticated, service_role;

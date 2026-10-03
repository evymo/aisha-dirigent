-- Function: public.guard_partner_profile_privilege_columns
-- Description: BEFORE UPDATE guard on partner_profiles. Prevents a direct client from
--   self-escalating their audience tier by writing the privilege columns that
--   audience_compute_actor_tier derives tiers from:
--     is_certified           -> 'qualified' tier. No server function writes it, so only
--                               admin/staff may ever change it.
--     is_production_provider -> 'partner' tier (together with is_visible). Written only by
--                               submit_partner_certification (which sets the sanctioned
--                               transaction-local flag below) or by admin/staff.
--   is_visible is intentionally NOT guarded: it is user-controllable directory visibility
--   (update_my_partner_profile) and grants no tier on its own.
--   The sanctioned path is signalled by the transaction-local GUC
--   'aisha.partner_priv_write' = 'on', which only a SECURITY DEFINER server function can
--   set (set_config is not reachable as a PostgREST RPC), so a direct client cannot forge it.

CREATE OR REPLACE FUNCTION public.guard_partner_profile_privilege_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := COALESCE(public.is_admin_or_staff(auth.uid()), false);
  v_sanctioned boolean := COALESCE(current_setting('aisha.partner_priv_write', true) = 'on', false);
BEGIN
  -- is_certified: admin/staff only (no legitimate server writer; the flag does NOT sanction it).
  IF (NEW.is_certified IS DISTINCT FROM OLD.is_certified) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'partner_profiles.is_certified is server-managed (audience tier gate)'
      USING ERRCODE = '42501';
  END IF;

  -- is_production_provider: sanctioned definer path (submit_partner_certification) or admin/staff.
  IF (NEW.is_production_provider IS DISTINCT FROM OLD.is_production_provider)
     AND NOT v_is_admin AND NOT v_sanctioned THEN
    RAISE EXCEPTION 'partner_profiles.is_production_provider is server-managed (audience tier gate)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.guard_partner_profile_privilege_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_partner_profile_privilege_columns() TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_partner_profile_privilege_columns() TO service_role;

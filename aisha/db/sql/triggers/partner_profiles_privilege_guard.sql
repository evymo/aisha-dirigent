-- Trigger: partner_profiles_privilege_guard
-- Source of truth pair: aisha/db/sql/tables/partner_profiles.sql
-- Blocks client self-escalation of the audience-tier privilege columns
-- (is_certified / is_production_provider) — při UPDATE i při INSERT (do 2026-10-05 jen UPDATE: přihlášený
-- si založil vlastní profil rovnou s is_certified = true). Přehrává ho heals.sql. Lives in triggers/ (emitted AFTER functions)
-- so public.guard_partner_profile_privilege_columns() exists when it binds.
DROP TRIGGER IF EXISTS partner_profiles_privilege_guard ON public.partner_profiles;
CREATE TRIGGER partner_profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_partner_profile_privilege_columns();

-- Function: public.get_partner_profiles_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:14+01:00

CREATE OR REPLACE FUNCTION public.get_partner_profiles_admin()
 RETURNS TABLE(id uuid, user_id uuid, display_name text, business_name text, city text, country text, email text, phone text, is_production_provider boolean, is_visible boolean, certification_level text, certification_score numeric, certification_passed_at timestamptz, created_at timestamptz, services text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := jsonb_build_object('action', 'list_partners'),
      p_entity_id := NULL,
      p_entity_type := 'partner_profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin viewed partner profiles list',
      p_tags := ARRAY['admin', 'partners', 'list'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    pp.id,
    pp.user_id,
    pp.display_name,
    pp.business_name,
    COALESCE(pp.city, '')::text,
    COALESCE(pp.country, '')::text,
    pp.email,
    pp.phone,
    pp.is_production_provider,
    pp.is_visible,
    pp.certification_level::text,
    pp.certification_score,
    pp.certification_passed_at,
    pp.created_at,
    pp.services
  FROM public.partner_profiles pp
  ORDER BY pp.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_profiles_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_profiles_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_profiles_admin() TO authenticated;

-- Function: public.update_my_partner_profile
-- Arguments: p_display_name text, p_business_name text, p_description text, p_notes_for_visitors text, p_city text, p_country text, p_address text, p_email text, p_phone text, p_website text, p_services text[], p_languages text[], p_is_visible boolean, p_accepts_online_appointments boolean, p_accepts_in_person_appointments boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:19+01:00

CREATE OR REPLACE FUNCTION public.update_my_partner_profile(p_display_name text, p_business_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_notes_for_visitors text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_services text[] DEFAULT NULL::text[], p_languages text[] DEFAULT NULL::text[], p_is_visible boolean DEFAULT NULL::boolean, p_accepts_online_appointments boolean DEFAULT NULL::boolean, p_accepts_in_person_appointments boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'on'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_partner_id
  FROM public.partner_profiles
  WHERE user_id = v_user_id;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner profile not found';
  END IF;

  UPDATE public.partner_profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    business_name = COALESCE(p_business_name, business_name),
    description = COALESCE(p_description, description),
    notes_for_visitors = COALESCE(p_notes_for_visitors, notes_for_visitors),
    city = COALESCE(p_city, city),
    country = COALESCE(p_country, country),
    address = COALESCE(p_address, address),
    email = COALESCE(p_email, email),
    phone = COALESCE(p_phone, phone),
    website = COALESCE(p_website, website),
    services = COALESCE(p_services, services),
    languages = COALESCE(p_languages, languages),
    is_visible = COALESCE(p_is_visible, is_visible),
    accepts_online_appointments = COALESCE(p_accepts_online_appointments, accepts_online_appointments),
    accepts_in_person_appointments = COALESCE(p_accepts_in_person_appointments, accepts_in_person_appointments),
    updated_at = now()
  WHERE id = v_partner_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'partner'::journal_area,
      p_entity_id := v_partner_id::TEXT,
      p_entity_type := 'partner_profile',
      p_severity := 'info'::journal_severity,
      p_summary := 'Partner updated their own profile',
    p_user_id := v_user_id
  );

  RETURN v_partner_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_my_partner_profile(p_display_name text, p_business_name text, p_description text, p_notes_for_visitors text, p_city text, p_country text, p_address text, p_email text, p_phone text, p_website text, p_services text[], p_languages text[], p_is_visible boolean, p_accepts_online_appointments boolean, p_accepts_in_person_appointments boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_partner_profile(p_display_name text, p_business_name text, p_description text, p_notes_for_visitors text, p_city text, p_country text, p_address text, p_email text, p_phone text, p_website text, p_services text[], p_languages text[], p_is_visible boolean, p_accepts_online_appointments boolean, p_accepts_in_person_appointments boolean) TO authenticated;

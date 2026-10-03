-- Function: public.get_completed_study_contributions_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:43+01:00

CREATE OR REPLACE FUNCTION public.get_completed_study_contributions_admin()
 RETURNS TABLE(id uuid, study_id uuid, user_id uuid, contribution_type text, amount numeric, currency text, token_type text, message text, is_anonymous boolean, status text, stripe_payment_intent_id text, created_at timestamptz, updated_at timestamptz, study_name text, study_code text, user_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'study_contributions',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing study contributions with user info',
      p_tags := ARRAY['phi','admin','contributions'],
      p_user_id := v_user_id
  );
  
  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    sc.user_id,
    sc.contribution_type::text,
    sc.amount,
    COALESCE(sc.currency, public.commerce_base_currency()) AS currency,
    COALESCE(sc.token_type, '') AS token_type,
    COALESCE(sc.message, '') AS message,
    COALESCE(sc.is_anonymous, false) AS is_anonymous,
    COALESCE(sc.status::text, 'pending') AS status,
    COALESCE(sc.stripe_payment_intent_id, '') AS stripe_payment_intent_id,
    sc.created_at,
    sc.updated_at,
    COALESCE(s.name, 'Unknown Study') AS study_name,
    COALESCE(s.code, '') AS study_code,
    COALESCE(p.display_name, 'Anonymous') AS user_name
  FROM public.study_contributions sc
  LEFT JOIN public.studies s ON s.id = sc.study_id
  LEFT JOIN public.profiles p ON p.user_id = sc.user_id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_completed_study_contributions_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_completed_study_contributions_admin() TO authenticated;

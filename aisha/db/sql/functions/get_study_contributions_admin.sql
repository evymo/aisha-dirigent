-- Function: public.get_study_contributions_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:34+01:00

CREATE OR REPLACE FUNCTION public.get_study_contributions_admin()
 RETURNS TABLE(id uuid, study_id uuid, user_id uuid, contribution_type text, amount numeric, currency text, token_type text, message text, is_anonymous boolean, status text, stripe_payment_intent_id text, created_at timestamptz, updated_at timestamptz, study_name text, study_code text, user_display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;
  
  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'study_contributions_admin', 
    'research'::journal_area, 'info'::journal_severity,
    'Admin viewed all study contributions'
  );
  
  RETURN QUERY
  SELECT sc.id, sc.study_id, sc.user_id, sc.contribution_type::text,
         sc.amount, 
         COALESCE(sc.currency, public.commerce_base_currency()) AS currency, 
         sc.token_type, 
         sc.message,
         COALESCE(sc.is_anonymous, false) AS is_anonymous, 
         COALESCE(sc.status::text, 'pending') AS status, 
         sc.stripe_payment_intent_id,
         sc.created_at, sc.updated_at,
         COALESCE(s.name, '') AS study_name,
         COALESCE(s.code, '') AS study_code,
         COALESCE(p.display_name, '') AS user_display_name
  FROM public.study_contributions sc
  LEFT JOIN public.studies s ON s.id = sc.study_id
  LEFT JOIN public.profiles p ON p.user_id = sc.user_id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_contributions_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_contributions_admin() TO authenticated;

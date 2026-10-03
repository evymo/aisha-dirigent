-- Function: public.can_invite_to_study
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:55+01:00

CREATE OR REPLACE FUNCTION public.can_invite_to_study(p_study_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Check if user is admin
  IF public.is_admin_or_staff(auth.uid()) THEN
    RETURN true;
  END IF;

  -- Check if user is an approved study consultant for this study
  RETURN EXISTS (
    SELECT 1 FROM public.studies s
    JOIN public.study_consultants sc ON sc.study_id = s.id
    JOIN public.partner_profiles pp ON pp.id = sc.partner_id
    WHERE s.id = p_study_id  -- Use parameter name, not column name
    AND s.invitation_permission = 'consultants_allowed'
    AND pp.user_id = auth.uid()
    AND sc.status = 'approved'
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.can_invite_to_study(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_invite_to_study(p_study_id uuid) TO authenticated;

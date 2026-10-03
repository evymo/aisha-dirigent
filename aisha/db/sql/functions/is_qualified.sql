-- Function: public.is_qualified
-- Arguments: p_user_id uuid (defaults to the caller)
-- Description: Non-forgeable "qualified member" marker — true iff the user has a
--   server-authored passing qualification_results row. qualification_results is
--   written only by assign_member_role_after_qualification (SECURITY DEFINER) and
--   clients hold no write access to it, so this cannot be self-asserted.
-- Security: SECURITY DEFINER; boolean gate (leaks no data beyond qualified-or-not).
--   Cross-user lookups are restricted to admin/staff/service; anyone else resolves
--   to themselves.

CREATE OR REPLACE FUNCTION public.is_qualified(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target uuid;
BEGIN
  v_target := CASE
    WHEN p_user_id IS NULL THEN auth.uid()
    WHEN p_user_id = auth.uid() THEN p_user_id
    WHEN public.is_service_role() OR public.is_admin_or_staff(auth.uid()) THEN p_user_id
    ELSE auth.uid()
  END;

  IF v_target IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.qualification_results qr
    WHERE qr.user_id = v_target AND qr.passed = true
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.is_qualified(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_qualified(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_qualified(p_user_id uuid) TO service_role;

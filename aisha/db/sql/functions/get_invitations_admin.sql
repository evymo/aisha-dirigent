-- Function: public.get_invitations_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:49+01:00

CREATE OR REPLACE FUNCTION public.get_invitations_admin()
 RETURNS TABLE(id uuid, code text, email text, role text, study_id uuid, study_name text, created_by uuid, created_by_name text, created_at timestamptz, expires_at timestamptz, max_uses integer, used_count integer, is_active boolean, prefill_first_name text, prefill_last_name text, prefill_phone text, prefill_notes text, claims jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'invitations',
    'user_management'::journal_area, 'info'::journal_severity,
    'Admin viewed invitations list'
  );

  RETURN QUERY
  SELECT 
    i.id,
    i.code,
    i.email,
    i.role,
    i.study_id,
    COALESCE(s.name, '') AS study_name,
    i.created_by,
    COALESCE(p.display_name, '') AS created_by_name,
    i.created_at,
    i.expires_at,
    i.max_uses,
    i.used_count,
    i.is_active,
    i.prefill_first_name,
    i.prefill_last_name,
    i.prefill_phone,
    i.prefill_notes,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'claim_id', ic.id,
          'user_id', ic.user_id,
          'claimed_at', ic.claimed_at,
          'user_name', COALESCE(cp.display_name, cp.email, 'Unknown')
        ) ORDER BY ic.claimed_at DESC)
        FROM invitation_claims ic
        LEFT JOIN profiles cp ON cp.user_id = ic.user_id
        WHERE ic.invitation_id = i.id
      ),
      '[]'::jsonb
    ) AS claims
  FROM public.invitations i
  LEFT JOIN public.studies s ON s.id = i.study_id
  LEFT JOIN public.profiles p ON p.user_id = i.created_by
  ORDER BY i.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_invitations_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitations_admin() TO authenticated;

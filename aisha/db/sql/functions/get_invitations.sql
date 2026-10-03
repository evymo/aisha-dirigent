-- Function: public.get_invitations
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:48+01:00

CREATE OR REPLACE FUNCTION public.get_invitations()
 RETURNS TABLE(id uuid, code text, study_id uuid, role text, email text, created_by uuid, created_at timestamptz, expires_at timestamptz, max_uses integer, used_count integer, is_active boolean, prefill_first_name text, prefill_last_name text, prefill_phone text, prefill_notes text, study_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_admin BOOLEAN;
    v_is_partner BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    v_is_admin := public.is_admin_or_staff(v_user_id);
    v_is_partner := public.has_permission(v_user_id, 'view_partner_dashboard');

    IF NOT v_is_admin AND NOT v_is_partner THEN
        RAISE EXCEPTION 'Access denied: insufficient permissions';
    END IF;

    IF v_is_admin THEN
        RETURN QUERY
        SELECT 
            i.id, i.code, i.study_id, i.role, i.email, i.created_by,
            i.created_at, i.expires_at, i.max_uses, i.used_count, i.is_active,
            i.prefill_first_name, i.prefill_last_name, i.prefill_phone, i.prefill_notes,
            s.name AS study_name
        FROM public.invitations i
        LEFT JOIN public.studies s ON s.id = i.study_id
        ORDER BY i.created_at DESC;
    ELSE
        RETURN QUERY
        SELECT 
            i.id, i.code, i.study_id, i.role, i.email, i.created_by,
            i.created_at, i.expires_at, i.max_uses, i.used_count, i.is_active,
            i.prefill_first_name, i.prefill_last_name, i.prefill_phone, i.prefill_notes,
            s.name AS study_name
        FROM public.invitations i
        LEFT JOIN public.studies s ON s.id = i.study_id
        WHERE i.created_by = v_user_id
        ORDER BY i.created_at DESC;
    END IF;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_invitations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_invitations() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_invitations() TO authenticated;

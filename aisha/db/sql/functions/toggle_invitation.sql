-- Function: public.toggle_invitation
-- Arguments: p_invitation_id uuid, p_is_active boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:11+01:00

CREATE OR REPLACE FUNCTION public.toggle_invitation(p_invitation_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;

    UPDATE public.invitations SET is_active = p_is_active WHERE id = p_invitation_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.toggle_invitation(p_invitation_id uuid, p_is_active boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_invitation(p_invitation_id uuid, p_is_active boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_invitation(p_invitation_id uuid, p_is_active boolean) TO authenticated;

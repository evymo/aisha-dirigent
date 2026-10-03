-- Function: public.delete_translation_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:27+01:00

CREATE OR REPLACE FUNCTION public.delete_translation_admin(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
SET search_path TO 'public'
 SET search_path = public
AS $function$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin role required';
    END IF;
    DELETE FROM public.translations WHERE id = p_id;

    PERFORM public.write_audit_journal(
        p_action_type := 'delete'::public.journal_action_type,
        p_area := 'system'::public.journal_area,
        p_details := NULL,
        p_entity_id := p_id::text,
        p_entity_type := 'translation',
        p_new_values := NULL,
        p_old_values := NULL,
        p_severity := 'info'::public.journal_severity,
        p_summary := 'Deleted translation',
        p_tags := ARRAY['admin', 'translation', 'delete'],
        p_user_id := auth.uid()
    );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_translation_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_translation_admin(p_id uuid) TO authenticated;

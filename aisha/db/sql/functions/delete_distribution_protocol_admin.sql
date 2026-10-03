-- Function: public.delete_distribution_protocol_admin
-- Arguments: p_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.delete_distribution_protocol_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'manage_studies') THEN
    RAISE EXCEPTION 'Access denied: manage_studies permission required';
  END IF;

  DELETE FROM public.distribution_protocols WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'studies'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'distribution_protocols',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Admin deleted distribution protocol',
      p_tags := ARRAY['admin','studies','distribution_protocols'],
      p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_distribution_protocol_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_distribution_protocol_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_distribution_protocol_admin(uuid) TO service_role;

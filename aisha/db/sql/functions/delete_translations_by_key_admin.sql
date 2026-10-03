-- Function: public.delete_translations_by_key_admin
-- Arguments: p_key text, p_namespace text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:27+01:00

CREATE OR REPLACE FUNCTION public.delete_translations_by_key_admin(p_key text, p_namespace text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin access required');
  END IF;

  IF p_namespace IS NULL OR btrim(p_namespace) = '' THEN
    DELETE FROM public.translations
    WHERE key = p_key;
  ELSE
    DELETE FROM public.translations
    WHERE key = p_key
      AND namespace = p_namespace;
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'system'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'translation',
      p_new_values := jsonb_build_object('key', p_key, 'namespace', p_namespace),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Deleted translation by key: ' || p_key,
      p_tags := ARRAY['admin', 'translation', 'delete'],
      p_user_id := auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_translations_by_key_admin(p_key text, p_namespace text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_translations_by_key_admin(p_key text, p_namespace text) TO authenticated;

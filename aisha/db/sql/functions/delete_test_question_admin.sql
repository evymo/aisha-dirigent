-- Function: public.delete_test_question_admin
-- Arguments: p_question_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:27+01:00

CREATE OR REPLACE FUNCTION public.delete_test_question_admin(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin check
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete test questions';
  END IF;

  DELETE FROM public.test_questions WHERE id = p_question_id;

  -- Audit log with correct signature and 'warning' instead of 'warn'
  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_details := jsonb_build_object('question_id', p_question_id),
      p_entity_id := p_question_id::text,
      p_entity_type := 'test_question',
      p_severity := 'warning'::journal_severity,
      p_summary := 'Test question deleted by admin',
    p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_test_question_admin(p_question_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_test_question_admin(p_question_id uuid) TO authenticated;

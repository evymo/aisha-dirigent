-- Function: public.delete_question_block_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:25+01:00

CREATE OR REPLACE FUNCTION public.delete_question_block_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usage_count integer := 0;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_usage_count
  FROM public.questionnaire_blocks qb
  WHERE qb.block_id = p_id;

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete question block that is linked to questionnaires' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.question_blocks WHERE id = p_id;

  IF FOUND THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'delete'::journal_action_type,
        p_area := 'research'::journal_area,
        p_entity_id := p_id::text,
        p_entity_type := 'question_block',
        p_summary := 'Deleted question block',
    p_user_id := auth.uid()
  );
  END IF;

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_question_block_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_question_block_admin(p_id uuid) TO authenticated;

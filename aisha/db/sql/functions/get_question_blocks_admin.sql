-- Function: public.get_question_blocks_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.732Z

CREATE OR REPLACE FUNCTION public.get_question_blocks_admin()
 RETURNS TABLE(
   id uuid,
   base_locale text,
   code text,
   config jsonb,
   created_at timestamptz,
   description_key text,
   is_active boolean,
   is_required_default boolean,
   question_type text,
   sort_order integer,
   text_key text,
   updated_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'question_block',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read question block',
      p_tags := ARRAY['admin', 'question_block'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    qb.id,
    qb.base_locale,
    qb.code,
    qb.config,
    qb.created_at,
    COALESCE(qb.description_key, '') AS description_key,
    qb.is_active,
    qb.is_required_default,
    qb.question_type,
    qb.sort_order,
    COALESCE(qb.text_key, '') AS text_key,
    qb.updated_at
  FROM public.question_blocks qb
  ORDER BY qb.sort_order, qb.code;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_question_blocks_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_blocks_admin() TO authenticated;


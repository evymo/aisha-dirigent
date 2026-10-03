-- Function: public.get_question_block_types_admin
-- Description: Returns active question block type metadata with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_question_block_types_admin()
 RETURNS TABLE(
   id uuid,
   component_type text,
   default_config jsonb,
   description_key text,
   icon text,
   is_active boolean,
   name_key text,
   sort_order integer,
   supports_multiselect boolean,
   supports_options boolean,
   supports_scale boolean,
   supports_tags boolean,
   type_key text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_entity_type := 'question_block_type',
      p_summary := 'Admin listed question block types',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    bt.id,
    bt.component_type,
    bt.default_config,
    bt.description_key,
    bt.icon,
    bt.is_active,
    bt.name_key,
    bt.sort_order,
    bt.supports_multiselect,
    bt.supports_options,
    bt.supports_scale,
    bt.supports_tags,
    bt.type_key
  FROM question_block_types bt
  WHERE bt.is_active = true
  ORDER BY bt.sort_order, bt.type_key;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_question_block_types_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_block_types_admin() TO authenticated;

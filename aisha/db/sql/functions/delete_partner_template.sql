-- Function: public.delete_partner_template
-- Arguments: p_template_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:24+01:00

CREATE OR REPLACE FUNCTION public.delete_partner_template(p_template_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_partner_id UUID;
  v_template_partner_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get partner_id for current user
  SELECT id INTO v_partner_id 
  FROM partner_profiles 
  WHERE user_id = v_user_id;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'User is not a partner';
  END IF;

  -- Verify ownership
  SELECT partner_id INTO v_template_partner_id
  FROM partner_templates
  WHERE id = p_template_id;

  IF v_template_partner_id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  IF v_template_partner_id != v_partner_id AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Not authorized to delete this template';
  END IF;

  -- Delete template
  DELETE FROM partner_templates WHERE id = p_template_id;

  -- Audit log
  INSERT INTO audit_journal (action, action_type, area, entity_type, entity_id, summary, severity, user_id) VALUES ('DELETE_PARTNER_TEMPLATE', 'delete', 'partner', 'partner_template', p_template_id::text, 'Partner template deleted', 'info', v_user_id);

  RETURN TRUE;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_partner_template(p_template_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_partner_template(p_template_id uuid) TO authenticated;

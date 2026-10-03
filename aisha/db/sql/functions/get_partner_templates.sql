-- Function: public.get_partner_templates
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:16+01:00

CREATE OR REPLACE FUNCTION public.get_partner_templates(p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, partner_id uuid, name text, description text, category text, is_active boolean, is_default boolean, blocks jsonb, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_partner_id UUID;
BEGIN
  -- Get partner ID for current user
  SELECT pp.id INTO v_user_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();
  
  -- If no partner_id specified, use current user's partner
  IF p_partner_id IS NULL THEN
    p_partner_id := v_user_partner_id;
  END IF;
  
  -- Check authorization
  IF p_partner_id != v_user_partner_id AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Not authorized to view these templates';
  END IF;
  
  RETURN QUERY
  SELECT 
    pt.id,
    pt.partner_id,
    pt.name,
    pt.description,
    pt.category,
    pt.is_active,
    pt.is_default,
    pt.blocks,
    pt.created_at,
    pt.updated_at
  FROM partner_templates pt
  WHERE pt.partner_id = p_partner_id
  ORDER BY pt.is_default DESC, pt.name ASC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_templates(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_templates(p_partner_id uuid) TO authenticated;

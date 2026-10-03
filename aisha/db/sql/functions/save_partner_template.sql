-- Function: public.save_partner_template
-- Arguments: p_name text, p_blocks jsonb, p_id uuid, p_description text, p_category text, p_is_active boolean, p_is_default boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:05+01:00

CREATE OR REPLACE FUNCTION public.save_partner_template(p_name text, p_blocks jsonb, p_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_category text DEFAULT 'general'::text, p_is_active boolean DEFAULT true, p_is_default boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID;
  v_template_id UUID;
BEGIN
  -- Get partner ID for current user
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();
  
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'User is not a partner';
  END IF;
  
  IF p_id IS NOT NULL THEN
    -- Update existing template
    UPDATE partner_templates
    SET 
      name = p_name,
      description = p_description,
      category = p_category,
      is_active = p_is_active,
      is_default = p_is_default,
      blocks = p_blocks,
      updated_at = now()
    WHERE id = p_id AND partner_id = v_partner_id
    RETURNING id INTO v_template_id;
    
    IF v_template_id IS NULL THEN
      RAISE EXCEPTION 'Template not found or not authorized';
    END IF;
  ELSE
    -- Insert new template
    INSERT INTO partner_templates (partner_id, name, description, category, is_active, is_default, blocks)
    VALUES (v_partner_id, p_name, p_description, p_category, p_is_active, p_is_default, p_blocks)
    RETURNING id INTO v_template_id;
  END IF;
  
  -- If this is set as default, unset other defaults in same category
  IF p_is_default THEN
    UPDATE partner_templates
    SET is_default = false
    WHERE partner_id = v_partner_id 
      AND category = p_category 
      AND id != v_template_id;
  END IF;
  
  RETURN v_template_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.save_partner_template(p_name text, p_blocks jsonb, p_id uuid, p_description text, p_category text, p_is_active boolean, p_is_default boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_partner_template(p_name text, p_blocks jsonb, p_id uuid, p_description text, p_category text, p_is_active boolean, p_is_default boolean) TO authenticated;

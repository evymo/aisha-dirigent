-- Function: audience_tag_resource

CREATE OR REPLACE FUNCTION public.audience_tag_resource(p_label text, p_resource_type text, p_resource_id uuid, p_color text DEFAULT 'gray'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label_id UUID;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: audience_tag_resource requires admin/staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- partner_id = kontext partnera volajícího (může být NULL — admin/staff bez
  -- partnerského profilu); story_id jen pro štítek příběhu. Konflikt = tentýž
  -- štítek nad týmž zdrojem (částečný index story_labels_resource_label_key).
  INSERT INTO public.story_labels (label, color, resource_type, resource_id, story_id, partner_id)
  VALUES (p_label, p_color, p_resource_type, p_resource_id,
          CASE WHEN p_resource_type = 'story' THEN p_resource_id END,
          public.get_current_partner_id())
  ON CONFLICT (resource_type, resource_id, label) WHERE resource_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_label_id;
  RETURN v_label_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_tag_resource(text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_tag_resource(text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_tag_resource(text,text,uuid,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_tag_resource(text,text,uuid,text) TO service_role;

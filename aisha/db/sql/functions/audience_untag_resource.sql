-- Function: audience_untag_resource

CREATE OR REPLACE FUNCTION public.audience_untag_resource(p_label text, p_resource_type text, p_resource_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.story_labels
  WHERE label = p_label AND resource_type = p_resource_type AND resource_id = p_resource_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_untag_resource(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_untag_resource(text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_untag_resource(text,text,uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_untag_resource(text,text,uuid) TO service_role;

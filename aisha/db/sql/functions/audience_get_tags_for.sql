-- Function: audience_get_tags_for

CREATE OR REPLACE FUNCTION public.audience_get_tags_for(p_resource_type text, p_resource_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: authentication required to read tags' USING ERRCODE = '42501';
  END IF;
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_staff() THEN
    IF p_resource_type = 'actor' THEN
      IF NOT public.audience_user_can_see_creator_stats(p_resource_id) THEN
        RAISE EXCEPTION 'Access denied: cannot read tags for actor %', p_resource_id USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'Access denied: tag read for resource_type % requires admin/staff', p_resource_type USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN (
    SELECT array_agg(DISTINCT label ORDER BY label)
    FROM public.story_labels
    WHERE resource_type = p_resource_type AND resource_id = p_resource_id
  );
END;
$function$

;

REVOKE ALL ON FUNCTION audience_get_tags_for(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_get_tags_for(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_get_tags_for(text,uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_get_tags_for(text,uuid) TO service_role;

-- Function: audience_admin_bulk_tag

CREATE OR REPLACE FUNCTION public.audience_admin_bulk_tag(p_actor_ids uuid[], p_label text, p_color text DEFAULT 'gray'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.story_labels (label, color, resource_type, resource_id, story_id, partner_id)
  SELECT p_label, p_color, 'actor', actor_id, NULL, public.get_current_partner_id()
  FROM unnest(p_actor_ids) actor_id
  ON CONFLICT (resource_type, resource_id, label) WHERE resource_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.audience_log_event(
    'bulk_tag',
    'audience_admin_bulk_tag',
    'tag',
    NULL,
    format('Bulk-tagged %s actors with label "%s"', v_inserted, p_label),
    jsonb_build_object('label', p_label, 'actor_ids', p_actor_ids, 'inserted', v_inserted)
  );

  RETURN v_inserted;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_bulk_tag(uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_bulk_tag(uuid[],text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_bulk_tag(uuid[],text,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_bulk_tag(uuid[],text,text) TO service_role;

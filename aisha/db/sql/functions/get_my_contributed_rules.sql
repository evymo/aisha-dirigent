-- Function: public.get_my_contributed_rules
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_contributed_rules()
 RETURNS TABLE(id uuid, slug text, title text, summary text, category text, status text, visibility text, is_verified boolean, subscriber_count integer, usage_count integer, rating_avg numeric, rating_count integer, version integer, published_at timestamptz, created_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT pp.id INTO v_partner_id
  FROM partner_profiles pp WHERE pp.user_id = auth.uid();

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    er.id, er.slug, er.title, er.summary,
    er.category::text, er.status::text, er.visibility,
    er.is_verified, er.subscriber_count, er.usage_count,
    er.rating_avg, er.rating_count, er.version,
    er.published_at, er.created_at, er.updated_at
  FROM expert_rules er
  WHERE er.author_partner_id = v_partner_id
  ORDER BY er.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_contributed_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_contributed_rules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_contributed_rules() TO service_role;

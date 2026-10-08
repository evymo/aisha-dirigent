-- Function: public.get_my_rule_subscriptions
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_rule_subscriptions()
 RETURNS TABLE(id uuid, expert_rule_id uuid, rule_slug text, rule_title text, rule_summary text, rule_category text, author_display_name text, author_avatar_url text, is_verified boolean, subscribed_at timestamptz, rating_avg numeric, usage_count integer, last_used_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ers.id,
    er.id AS expert_rule_id,
    er.slug AS rule_slug,
    er.title AS rule_title,
    er.summary AS rule_summary,
    er.category::text AS rule_category,
    pp.display_name AS author_display_name,
    pp.avatar_url AS author_avatar_url,
    er.is_verified,
    ers.subscribed_at,
    er.rating_avg,
    ers.usage_count,
    ers.last_used_at
  FROM expert_rule_subscriptions ers
  JOIN expert_rules er ON er.id = ers.rule_id
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
  JOIN partner_profiles pp ON pp.id = er.author_partner_id
  WHERE ers.user_id = auth.uid() AND ers.is_active = true
  ORDER BY ers.subscribed_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_rule_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_rule_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_rule_subscriptions() TO service_role;

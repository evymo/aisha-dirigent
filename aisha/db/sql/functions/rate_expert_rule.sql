-- Function: public.rate_expert_rule
-- Arguments: p_rule_id uuid, p_rating integer, p_review_text text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.rate_expert_rule(p_rule_id uuid, p_rating integer, p_review_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_new_avg numeric;
  v_new_count int;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- Must be subscribed
  PERFORM 1 FROM expert_rule_subscriptions
  WHERE user_id = v_caller_id AND rule_id = p_rule_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You must subscribe to a rule before rating it';
  END IF;

  INSERT INTO expert_rule_ratings (rule_id, user_id, rating, review_text)
  VALUES (p_rule_id, v_caller_id, p_rating, p_review_text)
  ON CONFLICT (rule_id, user_id) DO UPDATE SET
    rating = EXCLUDED.rating,
    review_text = EXCLUDED.review_text,
    updated_at = now();

  -- Recalculate averages
  SELECT avg(rating)::numeric(3,2), count(*) INTO v_new_avg, v_new_count
  FROM expert_rule_ratings WHERE rule_id = p_rule_id;

  UPDATE expert_rules SET rating_avg = v_new_avg, rating_count = v_new_count
  WHERE id = p_rule_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.rate_expert_rule(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_expert_rule(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_expert_rule(uuid, integer, text) TO service_role;

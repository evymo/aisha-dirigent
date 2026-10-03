-- Function: public.get_consented_users_longevity_scores
-- Arguments: p_limit integer DEFAULT 50
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_consented_users_longevity_scores(p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, display_name text, overall_score numeric, trend text, trend_percentage numeric, domains jsonb, assessed_at timestamp with time zone, assessment_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authorization: Must be authenticated and be a partner with consents
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'sensitive data_READ',
    jsonb_build_object(
      'area', 'partner',
      'severity', 'info',
      'entity_type', 'longevity_score',
      'action_detail', 'consented_users_scores',
      'limit', p_limit
    )
  );

  RETURN QUERY
  WITH consented AS (
    -- Get user IDs where current user (as partner) has consent
    SELECT DISTINCT dsc.user_id AS user_id
    FROM data_sharing_consents dsc
    JOIN partner_profiles pp ON pp.id = dsc.partner_id
    WHERE pp.user_id = auth.uid()
      AND dsc.revoked_at IS NULL
  ),
  latest_scores AS (
    -- Get latest longevity score for each consented user
    SELECT DISTINCT ON (ls.user_id)
      ls.user_id,
      ls.overall_score,
      ls.domains,
      ls.created_at AS assessed_at
    FROM longevity_scores ls
    JOIN consented c ON c.user_id = ls.user_id
    ORDER BY ls.user_id, ls.created_at DESC
  ),
  score_counts AS (
    -- Count total assessments per user
    SELECT ls.user_id, COUNT(*)::INTEGER AS assessment_count
    FROM longevity_scores ls
    JOIN consented c ON c.user_id = ls.user_id
    GROUP BY ls.user_id
  ),
  trends AS (
    -- Calculate trend from last two assessments
    SELECT 
      ls.user_id,
      CASE 
        WHEN COUNT(*) < 2 THEN 'neutral'::TEXT
        WHEN (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[1] > 
             (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[2] THEN 'up'::TEXT
        WHEN (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[1] < 
             (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[2] THEN 'down'::TEXT
        ELSE 'neutral'::TEXT
      END AS trend,
      CASE 
        WHEN COUNT(*) < 2 THEN 0
        ELSE ABS(
          (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[1] - 
          (array_agg(ls.overall_score ORDER BY ls.created_at DESC))[2]
        )
      END AS trend_percentage
    FROM longevity_scores ls
    JOIN consented c ON c.user_id = ls.user_id
    GROUP BY ls.user_id
  )
  SELECT 
    lsc.user_id,
    COALESCE(p.display_name, 'Member ' || LEFT(lsc.user_id::TEXT, 8)) AS display_name,
    lsc.overall_score,
    COALESCE(tr.trend, 'neutral') AS trend,
    COALESCE(tr.trend_percentage, 0) AS trend_percentage,
    lsc.domains,
    lsc.assessed_at,
    COALESCE(sc.assessment_count, 0) AS assessment_count
  FROM latest_scores lsc
  LEFT JOIN profiles p ON p.user_id = lsc.user_id
  LEFT JOIN score_counts sc ON sc.user_id = lsc.user_id
  LEFT JOIN trends tr ON tr.user_id = lsc.user_id
  ORDER BY lsc.assessed_at DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_consented_users_longevity_scores(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consented_users_longevity_scores(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consented_users_longevity_scores(integer) TO service_role;

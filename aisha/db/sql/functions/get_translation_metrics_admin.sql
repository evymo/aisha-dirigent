CREATE OR REPLACE FUNCTION public.get_translation_metrics_admin(
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  content_type text,
  provider text,
  model text,
  locale text,
  translation_count bigint,
  avg_token_count numeric,
  avg_latency_ms numeric,
  avg_quality_score numeric,
  human_reviewed_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0001';
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'TRANSLATION_METRICS_READ',
    jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'p_days', p_days
    )
  );

  RETURN QUERY
  -- Topic translations
  SELECT
    'topic'::text AS content_type,
    ktt.provider,
    ktt.model,
    ktt.locale,
    count(*)::bigint AS translation_count,
    round(avg(ktt.token_count)::numeric, 0) AS avg_token_count,
    round(avg(ktt.latency_ms)::numeric, 0) AS avg_latency_ms,
    round(avg(ktt.quality_score)::numeric, 2) AS avg_quality_score,
    count(*) FILTER (WHERE ktt.is_human_reviewed)::bigint AS human_reviewed_count
  FROM knowledge_topic_translations ktt
  WHERE ktt.created_at >= now() - (p_days || ' days')::interval
  GROUP BY ktt.provider, ktt.model, ktt.locale

  UNION ALL

  -- Post translations
  SELECT
    'post'::text AS content_type,
    kpt.provider,
    kpt.model,
    kpt.locale,
    count(*)::bigint AS translation_count,
    round(avg(kpt.token_count)::numeric, 0) AS avg_token_count,
    round(avg(kpt.latency_ms)::numeric, 0) AS avg_latency_ms,
    round(avg(kpt.quality_score)::numeric, 2) AS avg_quality_score,
    count(*) FILTER (WHERE kpt.is_human_reviewed)::bigint AS human_reviewed_count
  FROM knowledge_post_translations kpt
  WHERE kpt.created_at >= now() - (p_days || ' days')::interval
  GROUP BY kpt.provider, kpt.model, kpt.locale

  ORDER BY content_type, translation_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_translation_metrics_admin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_translation_metrics_admin(integer) TO authenticated;

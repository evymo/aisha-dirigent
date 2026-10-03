-- Function: log_knowledge_attribution
-- Purpose: AISHA logs which expert rules were used for a story and their relevance

CREATE OR REPLACE FUNCTION log_knowledge_attribution(
  p_story_id uuid,
  p_attributions jsonb  -- array of { rule_id, rule_owner_id, usage_intensity, relevance_score, quality_score, usage_context }
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_count int := 0;
  v_attr jsonb;
  v_total_weight numeric;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify story exists
  IF NOT EXISTS (SELECT 1 FROM partner_stories WHERE id = p_story_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Story not found');
  END IF;

  -- Process each attribution
  FOR v_attr IN SELECT * FROM jsonb_array_elements(p_attributions)
  LOOP
    INSERT INTO knowledge_attribution (
      story_id,
      rule_id,
      author_id,
      usage_intensity,
      relevance_score,
      quality_score,
      attribution_weight,
      context_used
    ) VALUES (
      p_story_id,
      (v_attr->>'rule_id')::uuid,
      (v_attr->>'author_id')::uuid,
      COALESCE((v_attr->>'usage_intensity')::numeric, 1.0),
      COALESCE((v_attr->>'relevance_score')::numeric, 0.5),
      COALESCE((v_attr->>'quality_score')::numeric, 0.5),
      -- Composite weight: intensity * relevance * quality
      ROUND(
        COALESCE((v_attr->>'usage_intensity')::numeric, 1.0) *
        COALESCE((v_attr->>'relevance_score')::numeric, 0.5) *
        COALESCE((v_attr->>'quality_score')::numeric, 0.5),
        4
      ),
      COALESCE(v_attr->>'context_used', 'consultation')
    )
    ON CONFLICT (story_id, rule_id) DO UPDATE SET
      usage_intensity = EXCLUDED.usage_intensity,
      relevance_score = EXCLUDED.relevance_score,
      quality_score = EXCLUDED.quality_score,
      attribution_weight = EXCLUDED.attribution_weight,
      context_used = EXCLUDED.context_used,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  -- Normalize weights so they sum to 1.0 within this story
  SELECT COALESCE(SUM(attribution_weight), 0)
  INTO v_total_weight
  FROM knowledge_attribution
  WHERE story_id = p_story_id;

  IF v_total_weight > 0 THEN
    UPDATE knowledge_attribution
    SET attribution_weight = ROUND(attribution_weight / v_total_weight, 4)
    WHERE story_id = p_story_id;
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'KNOWLEDGE_ATTRIBUTED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'knowledge_attribution',
      'story_id', p_story_id,
      'attributions_count', v_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'attributions_logged', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION log_knowledge_attribution(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_knowledge_attribution(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION log_knowledge_attribution(uuid,jsonb) TO service_role;

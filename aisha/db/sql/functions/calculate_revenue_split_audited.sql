-- Function: calculate_revenue_split_audited
-- Purpose: Calculate revenue split for a completed booking/story
-- Revenue model:
--   PROJECT:     70% specialist, 20% knowledge contributors, 10% platform
--   MAINTENANCE: 70% platform,  20% knowledge contributors, 10% specialist

CREATE OR REPLACE FUNCTION calculate_revenue_split_audited(
  p_project_revenue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_revenue RECORD;
  v_specialist_user_id uuid;
  v_specialist_pct numeric(5,2);
  v_platform_pct numeric(5,2);
  v_knowledge_pct numeric(5,2) := 20.00;
  v_knowledge_total numeric(10,2);
  v_specialist_amount numeric(10,2);
  v_platform_amount numeric(10,2);
  v_attribution RECORD;
  v_total_weight numeric;
  v_split_count integer := 0;
BEGIN
  -- 1. Fetch revenue record
  SELECT pr.*, ps.partner_id
  INTO v_revenue
  FROM project_revenue pr
  JOIN partner_stories ps ON ps.id = pr.story_id
  WHERE pr.id = p_project_revenue_id;

  IF v_revenue IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Revenue record not found');
  END IF;

  IF v_revenue.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Revenue already calculated');
  END IF;

  -- 2. Get specialist user_id
  SELECT user_id INTO v_specialist_user_id
  FROM partner_profiles
  WHERE id = v_revenue.partner_id;

  -- 3. Determine split percentages by revenue type
  IF v_revenue.revenue_type = 'project' THEN
    v_specialist_pct := 70.00;
    v_platform_pct := 10.00;
  ELSIF v_revenue.revenue_type = 'maintenance' THEN
    v_specialist_pct := 10.00;
    v_platform_pct := 70.00;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unknown revenue type');
  END IF;

  -- 4. Calculate amounts
  v_specialist_amount := ROUND(v_revenue.total_amount * v_specialist_pct / 100, 2);
  v_platform_amount := ROUND(v_revenue.total_amount * v_platform_pct / 100, 2);
  v_knowledge_total := v_revenue.total_amount - v_specialist_amount - v_platform_amount;

  -- 5. Delete any existing splits (idempotent recalculation)
  DELETE FROM revenue_splits WHERE project_revenue_id = p_project_revenue_id;

  -- 6. Insert specialist split
  INSERT INTO revenue_splits (
    project_revenue_id, recipient_type, recipient_id,
    percentage, amount, attribution_details
  ) VALUES (
    p_project_revenue_id, 'specialist', v_specialist_user_id,
    v_specialist_pct, v_specialist_amount,
    jsonb_build_object('role', 'dirigent', 'partner_id', v_revenue.partner_id)
  );
  v_split_count := v_split_count + 1;

  -- 7. Insert platform split
  INSERT INTO revenue_splits (
    project_revenue_id, recipient_type, recipient_id,
    percentage, amount, attribution_details
  ) VALUES (
    p_project_revenue_id, 'platform', NULL,
    v_platform_pct, v_platform_amount,
    jsonb_build_object('role', 'platform')
  );
  v_split_count := v_split_count + 1;

  -- 8. Calculate knowledge contributor splits (weighted by attribution)
  SELECT COALESCE(SUM(attribution_weight), 0)
  INTO v_total_weight
  FROM knowledge_attribution
  WHERE story_id = v_revenue.story_id
    AND attribution_weight > 0
    AND author_id IS NOT NULL;

  IF v_total_weight > 0 THEN
    -- Distribute knowledge pool proportionally by attribution_weight
    FOR v_attribution IN
      SELECT
        author_id,
        SUM(attribution_weight) AS total_author_weight,
        COUNT(*) AS rules_used
      FROM knowledge_attribution
      WHERE story_id = v_revenue.story_id
        AND attribution_weight > 0
        AND author_id IS NOT NULL
      GROUP BY author_id
    LOOP
      INSERT INTO revenue_splits (
        project_revenue_id, recipient_type, recipient_id,
        percentage, amount, attribution_details
      ) VALUES (
        p_project_revenue_id,
        'knowledge_contributor',
        v_attribution.author_id,
        ROUND(v_knowledge_pct * v_attribution.total_author_weight / v_total_weight, 2),
        ROUND(v_knowledge_total * v_attribution.total_author_weight / v_total_weight, 2),
        jsonb_build_object(
          'author_weight', v_attribution.total_author_weight,
          'total_weight', v_total_weight,
          'rules_used', v_attribution.rules_used
        )
      );
      v_split_count := v_split_count + 1;
    END LOOP;
  ELSE
    -- No knowledge attribution — knowledge share goes to platform
    UPDATE revenue_splits
    SET amount = amount + v_knowledge_total,
        percentage = percentage + v_knowledge_pct,
        attribution_details = attribution_details || jsonb_build_object(
          'knowledge_pool_absorbed', true,
          'reason', 'no_attributions'
        )
    WHERE project_revenue_id = p_project_revenue_id
      AND recipient_type = 'platform';
  END IF;

  -- 9. Update revenue status
  UPDATE project_revenue
  SET status = 'calculated', calculated_at = now(), updated_at = now()
  WHERE id = p_project_revenue_id;

  -- 10. Audit log
  -- user_id = auth.uid() (nullable): callable by service_role (revenue workflow)
  -- where auth.uid() is NULL; the COALESCE fallback to '00000000-…0000' is not a
  -- real aisha_auth.users id → audit_journal_user_id_fkey violation that would
  -- abort the whole calculation. NULL is FK-safe.
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'REVENUE_SPLIT_CALCULATED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'project_revenue',
      'entity_id', p_project_revenue_id,
      'total_amount', v_revenue.total_amount,
      'revenue_type', v_revenue.revenue_type::text,
      'splits_count', v_split_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'splits_count', v_split_count,
    'total_amount', v_revenue.total_amount,
    'specialist_amount', v_specialist_amount,
    'knowledge_amount', v_knowledge_total,
    'platform_amount', v_platform_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION calculate_revenue_split_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_revenue_split_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_revenue_split_audited(uuid) TO service_role;

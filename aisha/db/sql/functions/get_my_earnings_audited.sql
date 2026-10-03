-- Function: get_my_earnings_audited
-- Purpose: Specialist views their earnings dashboard with aggregations

-- p_period: 'month', 'quarter', 'year', 'all'
CREATE OR REPLACE FUNCTION get_my_earnings_audited(
  p_period text DEFAULT 'all',
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_partner_id uuid;
  v_date_from timestamptz;
  v_result jsonb;
  v_totals RECORD;
  v_items jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Get partner_id for current user
  SELECT id INTO v_partner_id
  FROM partner_profiles
  WHERE user_id = v_user_id;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No specialist profile');
  END IF;

  -- 2. Calculate date range
  v_date_from := CASE p_period
    WHEN 'month' THEN date_trunc('month', now())
    WHEN 'quarter' THEN date_trunc('quarter', now())
    WHEN 'year' THEN date_trunc('year', now())
    ELSE '1970-01-01'::timestamptz
  END;

  -- 3. Get totals
  SELECT
    COALESCE(SUM(rs.amount) FILTER (WHERE rs.status = 'settled'), 0) AS total_earned,
    COALESCE(SUM(rs.amount) FILTER (WHERE rs.status = 'pending'), 0) AS total_pending,
    COUNT(DISTINCT pr.id) AS total_projects,
    COALESCE(SUM(pr.total_amount), 0) AS gross_revenue
  INTO v_totals
  FROM revenue_splits rs
  JOIN project_revenue pr ON pr.id = rs.project_revenue_id
  WHERE rs.recipient_type = 'specialist'
    AND rs.recipient_id = v_partner_id
    AND pr.created_at >= v_date_from;

  -- 4. Get detail items
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'revenue_id', pr.id,
      'story_id', pr.story_id,
      'revenue_type', pr.revenue_type,
      'gross_amount', pr.total_amount,
      'my_split', rs.amount,
      'split_pct', rs.split_pct,
      'status', rs.status,
      'created_at', pr.created_at
    ) AS item
    FROM revenue_splits rs
    JOIN project_revenue pr ON pr.id = rs.project_revenue_id
    WHERE rs.recipient_type = 'specialist'
      AND rs.recipient_id = v_partner_id
      AND pr.created_at >= v_date_from
    ORDER BY pr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  -- 5. Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'EARNINGS_VIEWED',
    jsonb_build_object(
      'area', 'marketplace',
      'severity', 'info',
      'entity_type', 'earnings_dashboard',
      'period', p_period
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'total_earned_czk', v_totals.total_earned,
    'total_pending_czk', v_totals.total_pending,
    'gross_revenue_czk', v_totals.gross_revenue,
    'total_projects', v_totals.total_projects,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION get_my_earnings_audited(text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_earnings_audited(text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_earnings_audited(text,int,int) TO service_role;

-- =============================================================================
-- Function: update_user_leaderboard_entry
-- Description: Updates leaderboard entry for a single user (lightweight update)
-- Usage: Called by trigger on token_allocations or manually after token changes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_user_leaderboard_entry(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_balance numeric;
  v_period record;
  v_period_balance numeric;
BEGIN
  -- Ensure periods exist
  PERFORM ensure_leaderboard_periods();
  
  -- Get user's total balance
  SELECT COALESCE(SUM(balance), 0)
  INTO v_user_balance
  FROM token_allocations
  WHERE user_id = p_user_id;
  
  -- Update or insert for each period
  FOR v_period IN 
    SELECT id, period_type, period_start, period_end
    FROM leaderboard_periods
    WHERE period_end >= CURRENT_DATE
      AND period_start <= CURRENT_DATE
  LOOP
    -- For simplicity, use total balance for all periods
    -- (token_allocations doesn't have created_at, only updated_at)
    v_period_balance := v_user_balance;
    
    -- Upsert leaderboard entry
    INSERT INTO leaderboard_entries (
      period_id, 
      user_id, 
      total_points,
      rank,
      updated_at
    )
    VALUES (
      v_period.id,
      p_user_id,
      v_period_balance,
      0, -- Will be updated by ranking
      NOW()
    )
    ON CONFLICT (period_id, user_id)
    DO UPDATE SET
      total_points = EXCLUDED.total_points,
      updated_at = NOW();
  END LOOP;
  
  -- Recalculate rankings for affected periods
  UPDATE leaderboard_entries le
  SET rank = ranked.new_rank
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (PARTITION BY period_id ORDER BY total_points DESC) as new_rank
    FROM leaderboard_entries
    WHERE period_id IN (
      SELECT id FROM leaderboard_periods 
      WHERE period_end >= CURRENT_DATE
        AND period_start <= CURRENT_DATE
    )
  ) ranked
  WHERE le.id = ranked.id;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION public.update_user_leaderboard_entry(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_leaderboard_entry(uuid) FROM authenticated;

-- Documentation
COMMENT ON FUNCTION public.update_user_leaderboard_entry(uuid) IS 
'Updates leaderboard entry for a single user. Called by trigger on token_allocations.';

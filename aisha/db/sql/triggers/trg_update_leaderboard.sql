-- =============================================================================
-- Trigger: trg_update_leaderboard
-- Description: Auto-updates leaderboard when token allocations change
-- Fires: AFTER INSERT OR UPDATE OF balance ON token_allocations
-- =============================================================================

-- Drop existing trigger if exists (idempotent)
DROP TRIGGER IF EXISTS trg_update_leaderboard ON token_allocations;

-- Create trigger
CREATE TRIGGER trg_update_leaderboard
  AFTER INSERT OR UPDATE OF balance ON token_allocations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_leaderboard();

-- Documentation
COMMENT ON FUNCTION public.trigger_update_leaderboard() IS 
'Trigger function that updates leaderboard entries when token allocations change.';

CREATE OR REPLACE FUNCTION public.trigger_update_leaderboard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update leaderboard for the affected user
  PERFORM update_user_leaderboard_entry(NEW.user_id);
  RETURN NEW;
END;
$$;

-- Permissions: Trigger function - prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_update_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_update_leaderboard() TO authenticated;

-- Trigger: set_updated_at_leaderboard_reward_config

CREATE TRIGGER set_updated_at_leaderboard_reward_config
  BEFORE UPDATE ON public.leaderboard_reward_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

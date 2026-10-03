-- Trigger: update_leaderboard_entries_updated_at
-- Table: leaderboard_entries

CREATE TRIGGER update_leaderboard_entries_updated_at
BEFORE UPDATE
ON public.leaderboard_entries
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

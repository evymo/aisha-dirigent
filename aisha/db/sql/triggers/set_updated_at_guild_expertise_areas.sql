-- Trigger: set_updated_at_guild_expertise_areas

CREATE TRIGGER set_updated_at_guild_expertise_areas
  BEFORE UPDATE ON public.guild_expertise_areas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

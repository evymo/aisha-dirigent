-- Trigger: set_updated_at_guild_member_expertise

CREATE TRIGGER set_updated_at_guild_member_expertise
  BEFORE UPDATE ON public.guild_member_expertise
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

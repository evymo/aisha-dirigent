-- Trigger: update_member_distribution_plans_updated_at

CREATE TRIGGER update_member_distribution_plans_updated_at
  BEFORE UPDATE ON public.member_distribution_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

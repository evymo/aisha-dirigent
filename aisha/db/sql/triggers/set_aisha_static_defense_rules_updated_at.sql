-- Trigger: set_aisha_static_defense_rules_updated_at
-- Pairs with aisha_static_defense_rules.updated_at column. RPC paths
-- (aisha_propose_static_defense_rule, aisha_publish_static_defense_rule)
-- write updated_at explicitly, but any direct UPDATE (admin SQL session,
-- Appsmith UI direct edit) gets the same auto-bump.

CREATE TRIGGER set_aisha_static_defense_rules_updated_at
  BEFORE UPDATE ON public.aisha_static_defense_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

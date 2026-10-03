-- Trigger: update_user_wallets_updated_at
-- Table: user_wallets

CREATE TRIGGER update_user_wallets_updated_at
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

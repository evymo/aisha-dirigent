-- Trigger: on_token_transaction_created_update_wallet
-- Table: token_transactions

CREATE TRIGGER on_token_transaction_created_update_wallet
  AFTER INSERT ON public.token_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_wallet_balance();

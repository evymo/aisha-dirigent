-- Trigger: ledger_participation_updated_at
-- Table: ledger_participation

CREATE TRIGGER ledger_participation_updated_at
  BEFORE UPDATE ON public.ledger_participation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

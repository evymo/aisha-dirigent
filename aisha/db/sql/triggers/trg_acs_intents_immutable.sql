-- Trigger: trg_acs_intents_immutable
-- Table: acs_intents

DROP TRIGGER IF EXISTS trg_acs_intents_immutable ON public.acs_intents;
CREATE TRIGGER trg_acs_intents_immutable
  BEFORE UPDATE OR DELETE ON public.acs_intents
  FOR EACH ROW EXECUTE FUNCTION acs_intents_block_mutation();

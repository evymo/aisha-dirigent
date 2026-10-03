-- Table: obligation_register
-- Evidence layer (E5): obligations extracted from contracts. LEGAL CONTENT IS
-- NEVER AUTHORITATIVE WITHOUT A HUMAN — rows land with human_confirmed=false
-- (engine emits obligations as NEEDS_REVIEW, verbatim citation + char span
-- back to the clause). due_rule drives deadline watchers (F4).

CREATE TABLE IF NOT EXISTS public.obligation_register (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contract_id uuid NOT NULL,
  obliged_party text NOT NULL,
  action text NOT NULL,
  due_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
  consequence text,
  source_clause jsonb NOT NULL,
  human_confirmed boolean DEFAULT false NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT obligation_register_contract_fk FOREIGN KEY (contract_id) REFERENCES public.contract_register(id) ON DELETE CASCADE,
  CONSTRAINT obligation_register_due_rule_shape CHECK (due_rule ? 'kind'),
  CONSTRAINT obligation_register_source_clause_shape CHECK (
    source_clause ? 'section' AND source_clause ? 'char_start' AND source_clause ? 'char_end'
  ),
  CONSTRAINT obligation_register_confirmed_consistency CHECK (NOT human_confirmed OR confirmed_at IS NOT NULL)
);

ALTER TABLE public.obligation_register ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.obligation_register IS
  'Obligations per contract (obliged_party, action, due_rule, consequence, clause span). Always born unconfirmed.';

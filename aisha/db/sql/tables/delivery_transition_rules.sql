-- Table: delivery_transition_rules

CREATE TABLE IF NOT EXISTS public.delivery_transition_rules (
  id integer DEFAULT nextval('delivery_transition_rules_id_seq'::regclass) NOT NULL,
  from_status text,
  to_status text NOT NULL,
  requires_role text,
  is_active boolean DEFAULT true NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.delivery_transition_rules ENABLE ROW LEVEL SECURITY;

-- Table: variable_symbol_sequences

CREATE TABLE IF NOT EXISTS public.variable_symbol_sequences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
  current_value integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.variable_symbol_sequences ENABLE ROW LEVEL SECURITY;

-- Table: invoice_sequences

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  prefix text DEFAULT 'FAK'::text NOT NULL,
  year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
  current_value integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

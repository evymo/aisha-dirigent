-- Table: bank_transactions

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fio_transaction_id text,
  amount numeric NOT NULL,
  currency text,
  variable_symbol text,
  sender_account text,
  sender_name text,
  transaction_date date,
  message text,
  matched_order_id uuid,
  match_status text DEFAULT 'unmatched'::text NOT NULL,
  match_notes text,
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  match_type text,
  PRIMARY KEY (id)
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

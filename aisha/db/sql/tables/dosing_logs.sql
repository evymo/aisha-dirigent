-- Table: dosing_logs
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS dosing_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  study_id uuid,
  dose_ml numeric(10,2),
  dose_date date DEFAULT CURRENT_DATE,
  dose_time time,
  vial_id uuid REFERENCES public.product_vials ON DELETE SET NULL,
  batch_number text,
  notes text,
  side_effects text,
  created_at timestamptz DEFAULT now(),
  dosed_at timestamptz,
  study_registration_id uuid,
  distribution_protocol_id uuid,
  is_custom_distribution bool DEFAULT false,
  report_type text DEFAULT 'daily'::text,
  report_period_start date,
  report_period_end date,
  product_id uuid,
  logged_at timestamptz DEFAULT now(),
  dose_amount text,
  dose_unit text,
  dose_count int4 DEFAULT 1,
  taken_with_food bool DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT dosing_logs_distribution_protocol_id_fkey FOREIGN KEY (distribution_protocol_id) REFERENCES distribution_protocols(id) ON DELETE SET NULL,
  CONSTRAINT dosing_logs_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT dosing_logs_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id),
  CONSTRAINT dosing_logs_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT dosing_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE dosing_logs ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned sensitive data table
GRANT SELECT, INSERT, UPDATE, DELETE ON dosing_logs TO authenticated;
GRANT ALL ON dosing_logs TO service_role;

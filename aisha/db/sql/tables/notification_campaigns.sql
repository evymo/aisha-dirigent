-- Table: notification_campaigns
-- Stores admin-managed notification campaigns with translation keys and audience rules.

CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  title_key text NOT NULL,
  body_key text NOT NULL,
  base_locale text NOT NULL DEFAULT 'en'::text,
  link text,
  data jsonb,
  audience_type text NOT NULL DEFAULT 'all'::text,
  audience_filter jsonb,
  send_push boolean NOT NULL DEFAULT true,
  send_inapp boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_campaigns_base_locale_fkey FOREIGN KEY (base_locale) REFERENCES public.supported_languages(code),
  CONSTRAINT notification_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT notification_campaigns_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT notification_campaigns_audience_type_check CHECK (audience_type IN ('all', 'study', 'questionnaire_due', 'user_list', 'surface_section'))
);

ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT ARRAY['push'::text, 'inapp'::text];

-- ⛔ `CREATE TABLE IF NOT EXISTS` na BĚŽÍCÍ databázi neudělá nic, takže rozšíření
-- množiny `audience_type` výše by doteklo jen při cold startu. Na existující
-- instanci se omezení musí vyměnit výslovně — idempotentně, protože heals.sql
-- běží při KAŽDÉM migrate.
--
-- Nová hodnota `surface_section` = publikum podle SEKCE povrchu: kampaň dostane
-- ten, kdo tu sekci smí vidět (`surface_audience_allows`), tedy oprávnění plyne
-- z vazeb, ne z role.
ALTER TABLE public.notification_campaigns
  DROP CONSTRAINT IF EXISTS notification_campaigns_audience_type_check;
ALTER TABLE public.notification_campaigns
  ADD CONSTRAINT notification_campaigns_audience_type_check
  CHECK (audience_type IN ('all', 'study', 'questionnaire_due', 'user_list', 'surface_section'));


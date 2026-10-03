-- ============================================================================
-- Source of Truth: lead_submissions
-- Purpose: Inbound contact / quote / inquiry leads captured from public web
--          pages (the seeded GrapesJS templates' contact forms and the platform
--          marketing contact section). One row per submitted form.
-- Managed by: public.capture_lead() RPC (anon-callable, SECURITY DEFINER).
--             Operators read/triage via is_admin_or_staff(); writes are RPC-only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lead_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which page/template produced the lead (e.g. 'electrician-trade',
  -- 'site-supervision', 'website'). Used to route + segment the inbox.
  source      text        NOT NULL DEFAULT 'website',
  name        text        NOT NULL,
  -- Free-form contact handle: email OR phone (templates ask for "email or
  -- phone"; the platform contact form asks for email). Stored verbatim.
  contact     text        NOT NULL,
  -- Optional reason / category (e.g. the platform form's collaboration|urgent|
  -- partnership|general). NULL for forms that don't ask.
  subject     text,
  message     text        NOT NULL,
  -- Visitor UI locale at submit time (en|cs|de|fr|ru|th), best-effort.
  locale      text,
  -- Triage lifecycle.
  status      text        NOT NULL DEFAULT 'new',
  -- Extensible context (page_path, utm_*, referrer, …) — never PII-critical.
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_submissions_status_valid
    CHECK (status IN ('new', 'read', 'archived', 'spam')),
  CONSTRAINT lead_submissions_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT lead_submissions_contact_len
    CHECK (char_length(contact) BETWEEN 1 AND 320),
  CONSTRAINT lead_submissions_message_len
    CHECK (char_length(message) BETWEEN 1 AND 5000),
  CONSTRAINT lead_submissions_source_len
    CHECK (char_length(source) BETWEEN 1 AND 100),
  CONSTRAINT lead_submissions_subject_len
    CHECK (subject IS NULL OR char_length(subject) <= 200)
);

COMMENT ON TABLE public.lead_submissions IS
  'Inbound contact/quote leads from public web pages. Written only via public.capture_lead(); read by admin/staff.';
COMMENT ON COLUMN public.lead_submissions.source IS
  'Originating page/template id — routes and segments the operator inbox.';
COMMENT ON COLUMN public.lead_submissions.contact IS
  'Free-form contact handle (email or phone) exactly as the visitor entered it.';
COMMENT ON COLUMN public.lead_submissions.status IS
  'Triage state: new | read | archived | spam.';

-- Indexes live in aisha/db/sql/indexes/ (one CREATE INDEX per file, emitted
-- after tables in the baseline) per the SQL source-separation convention:
--   indexes/idx_lead_submissions_status_created.sql  (operator inbox: status + created_at DESC)
--   indexes/idx_lead_submissions_source.sql          (segment by originating page/template)

ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;

-- Policies live in aisha/db/sql/policies/ (emitted AFTER functions in the
-- baseline, so they may reference is_admin_or_staff()):
--   policies/Public_web_leads_readable_by_admin_staff.sql
--   policies/Service_role_full_access_to_lead_submissions.sql
-- Public inserts go through the SECURITY DEFINER capture_lead() RPC, which runs
-- as owner and bypasses RLS — so anon never touches this table directly.

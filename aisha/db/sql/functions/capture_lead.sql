-- ============================================================================
-- Source of Truth: capture_lead
-- Purpose: Public, anon-callable intake for contact/quote/inquiry leads from
--          seeded web pages. Validates + normalizes input, inserts one
--          lead_submissions row, and writes a PII-free audit entry.
-- Security: SECURITY DEFINER so anonymous visitors can write a single row into
--           the RLS-locked lead_submissions table WITHOUT direct table access.
--           Intentionally public (no auth check) — this is a public web form.
--           access.mjs exempts anon-granted definers from SEC_DEF_NO_AUTH; the
--           table is non-PHI, so SEC_DEF_ANON_GRANT/CONSENT do not apply.
-- Input is hard-bounded (length caps) to limit abuse; further spam mitigation
-- (rate limiting / captcha) is a deployment-layer concern — see docs follow-up.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.capture_lead(
  p_name     text,
  p_contact  text,
  p_message  text,
  p_source   text  DEFAULT 'website',
  p_subject  text  DEFAULT NULL,
  p_locale   text  DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_name    text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_source  text := btrim(coalesce(nullif(p_source, ''), 'website'));
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_locale  text := nullif(btrim(coalesce(p_locale, '')), '');
BEGIN
  -- Validate / reject unexpected shapes (CLAUDE.md: validate all input).
  IF v_name = '' OR char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'capture_lead: invalid name' USING ERRCODE = '22023';
  END IF;
  IF v_contact = '' OR char_length(v_contact) > 320 THEN
    RAISE EXCEPTION 'capture_lead: invalid contact' USING ERRCODE = '22023';
  END IF;
  IF v_message = '' OR char_length(v_message) > 5000 THEN
    RAISE EXCEPTION 'capture_lead: invalid message' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NOT NULL AND char_length(v_subject) > 200 THEN
    v_subject := left(v_subject, 200);
  END IF;
  IF char_length(v_source) > 100 THEN
    v_source := left(v_source, 100);
  END IF;
  IF v_locale IS NOT NULL AND v_locale NOT IN ('en', 'cs', 'de', 'fr', 'ru', 'th') THEN
    v_locale := NULL;
  END IF;

  INSERT INTO public.lead_submissions
    (source, name, contact, subject, message, locale, metadata)
  VALUES
    (v_source, v_name, v_contact, v_subject, v_message, v_locale,
     coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;

  -- Audit: IDs + routing metadata only — never the lead's PII (name/contact/message).
  INSERT INTO public.audit_journal
    (user_id, action_type, action, entity_type, entity_id, area, severity, summary, metadata)
  VALUES
    (auth.uid(), 'create', 'lead_submission.created', 'lead_submission', v_id::text,
     'web', 'info', 'Public web lead submitted',
     jsonb_build_object('source', v_source, 'has_subject', v_subject IS NOT NULL, 'locale', v_locale));

  RETURN v_id;
END;
$$;

-- Public web form: anon may submit; authenticated/service inherit. No direct
-- table grant — the SECURITY DEFINER body is the only write path.
REVOKE ALL ON FUNCTION public.capture_lead(text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_lead(text, text, text, text, text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.capture_lead(text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_lead(text, text, text, text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.capture_lead(text, text, text, text, text, text, jsonb) IS
  'Public anon-callable lead intake for seeded web pages. Validates, inserts one lead_submissions row, audits (no PII). Returns the new lead id.';

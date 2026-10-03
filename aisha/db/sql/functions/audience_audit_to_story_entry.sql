-- Function: audience_audit_to_story_entry

CREATE OR REPLACE FUNCTION public.audience_audit_to_story_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_story_id UUID;
  v_partner_id UUID;
BEGIN
  -- Only process CRM-relevant areas
  IF NEW.area NOT IN ('outreach', 'crm_ops', 'crm') THEN
    RETURN NEW;
  END IF;

  -- Skip if user_id missing (system events without actor context)
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Story-per-actor only applies to partner-tier contacts: partner_stories
  -- requires partner_id (NOT NULL FK → partner_profiles). For non-partner
  -- actors, skip the story promotion silently — the audit row already persisted;
  -- the story timeline is best-effort and must never break the audited op.
  SELECT id INTO v_partner_id FROM public.partner_profiles WHERE user_id = NEW.user_id LIMIT 1;
  IF v_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find or create partner_story for this user (title + partner_id are NOT NULL)
  SELECT id INTO v_story_id FROM public.partner_stories WHERE user_id = NEW.user_id LIMIT 1;
  IF v_story_id IS NULL THEN
    INSERT INTO public.partner_stories (partner_id, user_id, title, created_at, last_activity_at)
    VALUES (v_partner_id, NEW.user_id,
            'Audience timeline — ' || COALESCE((SELECT display_name FROM public.profiles WHERE user_id = NEW.user_id), NEW.user_id::text),
            now(), now())
    RETURNING id INTO v_story_id;
  ELSE
    UPDATE public.partner_stories SET last_activity_at = now() WHERE id = v_story_id;
  END IF;

  -- Insert story entry referencing the audit row
  INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by, occurred_at)
  VALUES (
    v_story_id,
    'audit_event',
    NEW.summary,
    jsonb_build_object(
      'audit_id', NEW.id,
      'action_type', NEW.action_type,
      'action', NEW.action,
      'entity_type', NEW.entity_type,
      'area', NEW.area,
      'severity', NEW.severity
    ) || COALESCE(NEW.details, '{}'::jsonb),
    NEW.user_id,
    NEW.created_at
  );

  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_audit_to_story_entry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_audit_to_story_entry() TO service_role;

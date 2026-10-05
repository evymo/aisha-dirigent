-- View: public.audience_admin_followup_queue_v
-- Fronta otevřených TAKTŮ (ADR-003 K2): co je dluženo, komu, do kdy — nad
-- story_pulse_beats, ne nad ai_tasks. Kompatibilní sloupce zůstávají
-- (task_id = id taktu, actor_*, note, due_at, status, assigned_to_user_id,
-- bucket, days_until_due), přibývá původ (source_type/source_id = krok běhu)
-- a subjekt (twin/actor/story). Subjekt 'twin' se na aktéra překládá přes
-- potvrzenou referenci účtu, takže fronta unese i entity bez účtu (jméno
-- dvojčete místo profilu).
CREATE OR REPLACE VIEW public.audience_admin_followup_queue_v AS
WITH acct AS (
  SELECT r.twin_id, r.source_key::uuid AS user_id
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL
    AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
),
b AS (
  SELECT bt.*,
         CASE WHEN bt.subject_type = 'actor' THEN bt.subject_id
              WHEN bt.subject_type = 'twin'  THEN (SELECT a.user_id FROM acct a WHERE a.twin_id = bt.subject_id LIMIT 1)
         END AS actor_user_id
  FROM public.story_pulse_beats bt
  WHERE bt.status = 'open'
)
SELECT
  b.id                    AS task_id,
  b.actor_user_id,
  COALESCE(p.display_name, t.label, ps.title) AS actor_name,
  p.email                 AS actor_email,
  b.note,
  b.due_at,
  b.status,
  b.assigned_to_user_id,
  CASE
    WHEN b.due_at < now()                       THEN 'overdue'
    WHEN b.due_at < now() + interval '1 day'    THEN 'today'
    WHEN b.due_at < now() + interval '7 days'   THEN 'this_week'
    ELSE 'later'
  END AS bucket,
  EXTRACT(day FROM (b.due_at - now()))::integer AS days_until_due,
  b.created_at,
  b.updated_at,
  b.beat_type,
  b.source_type,
  b.source_id,
  b.subject_type,
  b.subject_id,
  CASE WHEN b.subject_type = 'twin' THEN b.subject_id
       WHEN b.subject_type = 'actor' THEN (SELECT a.twin_id FROM acct a WHERE a.user_id = b.subject_id LIMIT 1)
  END AS twin_id
FROM b
LEFT JOIN public.profiles p ON p.user_id = b.actor_user_id
LEFT JOIN public.twin_entities t ON b.subject_type = 'twin' AND t.id = b.subject_id
LEFT JOIN public.partner_stories ps ON b.subject_type = 'story' AND ps.id = b.subject_id;

COMMENT ON VIEW public.audience_admin_followup_queue_v IS
  'Open beats bucketed (overdue/today/this_week/later) with the subject resolved to an actor when it has an account. Backed by story_pulse_beats since ADR-003 K2 (ai_tasks retired).';

-- ⛔ Pohled s právy vlastníka (mimo RLS podkladu) — čte se JEN přes DEFINER
-- blokové funkce get_audience_view_*_block (is_admin_or_staff + jmenný prostor
-- audience_admin_*_v). Přímý grant klientské roli tu stráž obchází (nález
-- 2026-10-04); REVOKE i z authenticated kvůli explicitním grantům z heals
-- a default privileges na běžící DB.
REVOKE ALL ON public.audience_admin_followup_queue_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_followup_queue_v TO service_role;

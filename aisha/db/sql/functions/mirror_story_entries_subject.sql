-- Function: public.mirror_story_entries_subject
-- Makes the documented legacy-story binding guarantee durable: when a story_entries
-- row is inserted with only the legacy story_id set (no polymorphic subject_id),
-- mirror it into (subject_type='story', subject_id=story_id). story_entries.subject_id
-- is NOT NULL with no default, so without this the seed + any legacy direct insert
-- would violate the not-null constraint. The discussion RPC
-- (create_discussion_entry_audited) sets subject_id explicitly, so this is a no-op
-- for it — it only backfills the legacy story_id-only path.

CREATE OR REPLACE FUNCTION public.mirror_story_entries_subject()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.subject_id IS NULL AND NEW.story_id IS NOT NULL THEN
    NEW.subject_id := NEW.story_id;
    -- subject_type defaults to 'story'; keep it consistent for the mirrored row.
    IF NEW.subject_type IS NULL OR NEW.subject_type = '' THEN
      NEW.subject_type := 'story';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

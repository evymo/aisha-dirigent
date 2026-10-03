-- Trigger: trg_actor_note_vectorize
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_actor_note_vectorize AFTER INSERT OR UPDATE OF content ON public.story_entries FOR EACH ROW WHEN ((new.entry_type = ANY (ARRAY['actor_note'::text, 'audit_event'::text]))) EXECUTE FUNCTION audience_note_vectorize();

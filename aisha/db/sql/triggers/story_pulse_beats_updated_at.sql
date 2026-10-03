-- Trigger: story_pulse_beats_updated_at
-- Source of truth pair: aisha/db/sql/tables/story_pulse_beats.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.
DROP TRIGGER IF EXISTS story_pulse_beats_updated_at ON public.story_pulse_beats;
CREATE TRIGGER story_pulse_beats_updated_at
  BEFORE UPDATE ON public.story_pulse_beats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

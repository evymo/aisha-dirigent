-- Trigger: voice_rooms_updated_at
-- Table: voice_rooms

CREATE TRIGGER voice_rooms_updated_at
  BEFORE UPDATE ON public.voice_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

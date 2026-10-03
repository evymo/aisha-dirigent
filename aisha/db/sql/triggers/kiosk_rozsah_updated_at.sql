-- Trigger: kiosk_rozsah_updated_at
-- Source of truth pair: aisha/db/sql/tables/kiosk_rozsah.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.
DROP TRIGGER IF EXISTS kiosk_rozsah_updated_at ON public.kiosk_rozsah;
CREATE TRIGGER kiosk_rozsah_updated_at
  BEFORE UPDATE ON public.kiosk_rozsah
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

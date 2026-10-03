-- Trigger: update_hero_slides_updated_at
-- Table: hero_slides

CREATE TRIGGER update_hero_slides_updated_at
    BEFORE UPDATE ON public.hero_slides
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

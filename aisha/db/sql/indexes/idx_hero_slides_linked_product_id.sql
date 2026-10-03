-- Index: idx_hero_slides_linked_product_id
-- Table: hero_slides

CREATE INDEX IF NOT EXISTS idx_hero_slides_linked_product_id ON public.hero_slides(linked_product_id);

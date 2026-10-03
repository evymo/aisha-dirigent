-- Grants: knowledge_multimodal_pages

GRANT SELECT ON public.knowledge_multimodal_pages TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.knowledge_multimodal_pages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.knowledge_multimodal_pages TO service_role;

-- Index: idx_pws_authorized_twin
-- Nárokové rameno „twin vazba": výrazový index na TEXT hodnotě
-- (input_data->>'authorized_twin_id') — táž třída jako
-- idx_li_source_registry_id_text: generický textový výraz místo castu na typ,
-- který cizí hodnota mít nemusí.
CREATE INDEX IF NOT EXISTS idx_pws_authorized_twin
  ON public.production_workflow_steps (((input_data->>'authorized_twin_id')));

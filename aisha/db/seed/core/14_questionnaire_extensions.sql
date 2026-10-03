-- STEP 14: Questionnaire Extensions
-- Description: question_block_types — typy bloků, ze kterých instance skládá
--   vlastní dotazníky (funkce platformy). Obsah dotazníků (bloky, otázky,
--   vazby) patří do vrstvy instance, ne do platformy.
-- Created: 2026-02-10
-- ============================================================================

-- ============================================================================
-- 1. Seed question_block_types metadata
-- ============================================================================

INSERT INTO question_block_types (type_key, name_key, description_key, icon, component_type, supports_options, supports_scale, supports_tags, supports_multiselect, default_config, is_active, sort_order)
VALUES
  ('boolean', 'questionnaires.block_types.boolean.name', 'questionnaires.block_types.boolean.description', 'ToggleLeft', 'BooleanInput', false, false, false, false, '{}', true, 1),
  ('checkbox', 'questionnaires.block_types.checkbox.name', 'questionnaires.block_types.checkbox.description', 'CheckSquare', 'CheckboxInput', true, false, false, true, '{"layout": "list"}', true, 2),
  ('date', 'questionnaires.block_types.date.name', 'questionnaires.block_types.date.description', 'Calendar', 'DateInput', false, false, false, false, '{"format": "YYYY-MM-DD"}', true, 3),
  ('feeling_preset', 'questionnaires.block_types.feeling_preset.name', 'questionnaires.block_types.feeling_preset.description', 'SmilePlus', 'FeelingPresetInput', false, false, false, false, '{}', true, 4),
  ('number', 'questionnaires.block_types.number.name', 'questionnaires.block_types.number.description', 'Hash', 'NumberInput', false, false, false, false, '{"min": 0}', true, 5),
  ('radio', 'questionnaires.block_types.radio.name', 'questionnaires.block_types.radio.description', 'CircleDot', 'RadioInput', true, false, false, false, '{"layout": "list"}', true, 6),
  ('scale', 'questionnaires.block_types.scale.name', 'questionnaires.block_types.scale.description', 'SlidersHorizontal', 'ScaleInput', false, true, false, false, '{"min": 0, "max": 10, "step": 1, "showValue": true}', true, 7),
  ('select', 'questionnaires.block_types.select.name', 'questionnaires.block_types.select.description', 'ListFilter', 'SelectInput', true, false, false, false, '{}', true, 8),
  ('tags', 'questionnaires.block_types.tags.name', 'questionnaires.block_types.tags.description', 'Tags', 'TagsInput', true, false, true, true, '{"layout": "grid", "columns": 2, "multiSelect": false}', true, 9),
  ('text', 'questionnaires.block_types.text.name', 'questionnaires.block_types.text.description', 'Type', 'TextInput', false, false, false, false, '{"maxLength": 255}', true, 10),
  ('textarea', 'questionnaires.block_types.textarea.name', 'questionnaires.block_types.textarea.description', 'AlignLeft', 'TextareaInput', false, false, false, false, '{"rows": 4, "maxLength": 2000}', true, 11)
ON CONFLICT (type_key) DO UPDATE SET
  name_key = EXCLUDED.name_key,
  description_key = EXCLUDED.description_key,
  icon = EXCLUDED.icon,
  component_type = EXCLUDED.component_type,
  supports_options = EXCLUDED.supports_options,
  supports_scale = EXCLUDED.supports_scale,
  supports_tags = EXCLUDED.supports_tags,
  supports_multiselect = EXCLUDED.supports_multiselect,
  default_config = EXCLUDED.default_config,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

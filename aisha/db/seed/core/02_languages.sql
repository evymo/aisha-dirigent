-- STEP 3: Supported Languages (all 6 languages from i18n segments)
-- ============================================================================

INSERT INTO public.supported_languages (code, name_native, name_key, is_active, is_default, sort_order) VALUES
  -- FK sentinel for the knowledge locale axis (Brick3). Every knowledge_items/
  -- chunks/embeddings row defaults locale='global', so this row MUST exist before
  -- any knowledge_* write or the locale FK 23503-fails at cold-start. is_default
  -- false (not a real UI language); sort_order 0 keeps it ahead of the real list.
  ('global', 'Global', 'languages.global.name', true, false, 0),
  ('cs', 'Čeština', 'languages.cs.name', true, false, 1),
  ('en', 'English', 'languages.en.name', true, true, 2),
  ('de', 'Deutsch', 'languages.de.name', true, false, 3),
  ('fr', 'Français', 'languages.fr.name', true, false, 4),
  ('ru', 'Русский', 'languages.ru.name', true, false, 5),
  ('th', 'ไทย', 'languages.th.name', true, false, 6),
  -- FK sentinels for DB CONTENT locales that instance web corpora may carry
  -- beyond the 6 active UI-segment languages. The web design tooling
  -- (export-web-seed / translate-template-i18n.mjs, whose DEEPL_LANG_MAP
  -- includes it+es) can emit a translated corpus for these, and
  -- translations.locale FK-references supported_languages(code) — so without a
  -- row here the instance seed 23503-fails (observed: instance/01_web.sql ships
  -- 36 keys × {it,es}). is_active=false keeps them OUT of the active language
  -- switcher: DB-content locales and frontend UI-segment locales are DISTINCT
  -- axes (see scripts/i18n/sql-seed-check.mjs header). Promote to is_active=true
  -- only once the frontend segments (src/i18n/segments) also cover them.
  ('it', 'Italiano',  'languages.it.name', false, false, 7),
  ('es', 'Español',   'languages.es.name', false, false, 8)
ON CONFLICT (code) DO UPDATE SET
  name_native = EXCLUDED.name_native,
  name_key = EXCLUDED.name_key,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- Seed translations for language names
INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at) VALUES
('cs', 'common', 'languages.cs.name', 'Čeština', NOW(), NOW()),
('cs', 'common', 'languages.en.name', 'Angličtina', NOW(), NOW()),
('cs', 'common', 'languages.de.name', 'Němčina', NOW(), NOW()),
('cs', 'common', 'languages.fr.name', 'Francouzština', NOW(), NOW()),
('cs', 'common', 'languages.ru.name', 'Ruština', NOW(), NOW()),
('cs', 'common', 'languages.th.name', 'Thajština', NOW(), NOW()),
('en', 'common', 'languages.cs.name', 'Czech', NOW(), NOW()),
('en', 'common', 'languages.en.name', 'English', NOW(), NOW()),
('en', 'common', 'languages.de.name', 'German', NOW(), NOW()),
('en', 'common', 'languages.fr.name', 'French', NOW(), NOW()),
('en', 'common', 'languages.ru.name', 'Russian', NOW(), NOW()),
('en', 'common', 'languages.th.name', 'Thai', NOW(), NOW()),
('de', 'common', 'languages.cs.name', 'Tschechisch', NOW(), NOW()),
('de', 'common', 'languages.en.name', 'Englisch', NOW(), NOW()),
('de', 'common', 'languages.de.name', 'Deutsch', NOW(), NOW()),
('de', 'common', 'languages.fr.name', 'Französisch', NOW(), NOW()),
('de', 'common', 'languages.ru.name', 'Russisch', NOW(), NOW()),
('de', 'common', 'languages.th.name', 'Thailändisch', NOW(), NOW()),
('fr', 'common', 'languages.cs.name', 'Tchèque', NOW(), NOW()),
('fr', 'common', 'languages.en.name', 'Anglais', NOW(), NOW()),
('fr', 'common', 'languages.de.name', 'Allemand', NOW(), NOW()),
('fr', 'common', 'languages.fr.name', 'Français', NOW(), NOW()),
('fr', 'common', 'languages.ru.name', 'Russe', NOW(), NOW()),
('fr', 'common', 'languages.th.name', 'Thaï', NOW(), NOW()),
('ru', 'common', 'languages.cs.name', 'Чешский', NOW(), NOW()),
('ru', 'common', 'languages.en.name', 'Английский', NOW(), NOW()),
('ru', 'common', 'languages.de.name', 'Немецкий', NOW(), NOW()),
('ru', 'common', 'languages.fr.name', 'Французский', NOW(), NOW()),
('ru', 'common', 'languages.ru.name', 'Русский', NOW(), NOW()),
('ru', 'common', 'languages.th.name', 'Тайский', NOW(), NOW()),
('th', 'common', 'languages.cs.name', 'เช็ก', NOW(), NOW()),
('th', 'common', 'languages.en.name', 'อังกฤษ', NOW(), NOW()),
('th', 'common', 'languages.de.name', 'เยอรมัน', NOW(), NOW()),
('th', 'common', 'languages.fr.name', 'ฝรั่งเศส', NOW(), NOW()),
('th', 'common', 'languages.ru.name', 'รัสเซีย', NOW(), NOW()),
('th', 'common', 'languages.th.name', 'ไทย', NOW(), NOW())
ON CONFLICT (locale, namespace, key) DO NOTHING;

-- Seed dynamic translations for questionnaire blocks (namespace: questionnaires)
-- Historical migrations seeded some questionnaires.* keys into namespace 'common'.
-- Copy those values into 'questionnaires' without overwriting admin edits.
WITH langs AS (
  SELECT code
  FROM public.supported_languages
  WHERE is_active = true
),
block_keys AS (
  SELECT qb.text_key AS key
  FROM public.question_blocks qb
  WHERE qb.text_key IS NOT NULL AND qb.text_key <> ''
  UNION
  SELECT qb.description_key AS key
  FROM public.question_blocks qb
  WHERE qb.description_key IS NOT NULL AND qb.description_key <> ''
),
source_rows AS (
  SELECT t.locale, t.key, t.value
  FROM public.translations t
  JOIN langs l ON l.code = t.locale
  JOIN block_keys bk ON bk.key = t.key
  WHERE t.namespace = 'common'
    AND t.value IS NOT NULL
    AND t.value <> ''
)
INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at)
SELECT sr.locale, 'questionnaires', sr.key, sr.value, now(), now()
FROM source_rows sr
ON CONFLICT (locale, namespace, key) DO NOTHING;

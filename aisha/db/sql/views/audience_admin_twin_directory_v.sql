-- View: public.audience_admin_twin_directory_v
-- Registr dvojčat (ADR-003 K1): JEDEN seznam všech projekcí — entity s účtem
-- i bez něj (kolega, externí kontakt, organizace) — obohacený o čočku
-- zapojení tam, kde entita účet má. Účty, které dvojče ještě nemají (před
-- backfillem), se NESMÍ ztratit: přidávají se jako řádky s twin_id NULL a
-- twin_status 'unbound', aby registr nikdy nelhal o tom, kdo existuje.
-- Engagement sloupce jsou NULL = neměřeno (nikdy nula) u entit bez účtu/zdroje.
-- Čte se výhradně přes get_audience_view_table_block (DEFINER, is_admin_or_staff
-- + jmenný prostor audience_admin_*_v).
CREATE OR REPLACE VIEW public.audience_admin_twin_directory_v AS
WITH acct AS (
  SELECT r.twin_id, r.source_key::uuid AS user_id
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account'
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
    AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
),
base AS (
  SELECT t.id AS twin_id, t.entity_type, t.label, t.status AS twin_status, a.user_id, t.created_at
  FROM public.twin_entities t
  LEFT JOIN acct a ON a.twin_id = t.id
  UNION ALL
  SELECT NULL::uuid, 'person'::text, COALESCE(p.display_name, p.email), 'unbound'::text, p.user_id, p.created_at
  FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM acct a WHERE a.user_id = p.user_id)
)
SELECT
  b.twin_id,
  b.entity_type,
  b.label,
  b.twin_status,
  b.user_id,
  p.email,
  p.preferred_language,
  tier.member_tier,
  tier.specializations,
  tier.audience_size,
  tier.last_active_at,
  -- Štítky DVOJČETE i jeho účtu (sjednoceně). Do 2026-09-15 jen účtu (overlay),
  -- takže entita bez účtu štítek dostat nemohla a akce „Přidat štítek" nad
  -- záznamem z Raynetu padala. Typ (text[]) i pozice sloupce beze změny.
  ( SELECT array_agg(DISTINCT sl.label ORDER BY sl.label)
      FROM public.story_labels sl
     WHERE (sl.resource_type = 'twin'  AND b.twin_id IS NOT NULL AND sl.resource_id = b.twin_id)
        OR (sl.resource_type = 'actor' AND b.user_id IS NOT NULL AND sl.resource_id = b.user_id) ) AS tags,
  ovl.assigned_to_partner_id,
  ( SELECT string_agg(rel.relation_kind || ' → ' || COALESCE(tt.label, tt.entity_type), ', ' ORDER BY rel.relation_kind, tt.label)
      FROM public.twin_relations rel
      JOIN public.twin_entities tt ON tt.id = rel.target_twin_id
     WHERE rel.source_twin_id = b.twin_id AND rel.valid_to IS NULL ) AS relations,
  ( SELECT count(*) FROM public.story_pulse_beats bt
     WHERE bt.status = 'open'
       AND ((bt.subject_type = 'twin'  AND bt.subject_id = b.twin_id)
         OR (bt.subject_type = 'actor' AND bt.subject_id = b.user_id)) ) AS open_beats,
  ( SELECT min(bt.due_at) FROM public.story_pulse_beats bt
     WHERE bt.status = 'open'
       AND ((bt.subject_type = 'twin'  AND bt.subject_id = b.twin_id)
         OR (bt.subject_type = 'actor' AND bt.subject_id = b.user_id)) ) AS next_due_at,
  ( SELECT max(COALESCE(se.occurred_at, se.created_at)) FROM public.story_entries se
     WHERE ((se.subject_type = 'twin'  AND se.subject_id = b.twin_id)
         OR (se.subject_type = 'actor' AND se.subject_id = b.user_id)) ) AS last_touch_at,
  agg.app_accesses_30d,
  agg.events_created_30d,
  agg.email_open_rate_90d,
  ( SELECT count(*) FROM public.openclaw_notifications o
     WHERE b.user_id IS NOT NULL AND o.user_id = b.user_id
       AND o.created_at > (now() - interval '90 days') ) AS communications_90d,
  b.created_at,
  -- ⛔ NOVÝ SLOUPEC PATŘÍ NA KONEC. `CREATE OR REPLACE VIEW` umí sloupce jen
  -- PŘIDÁVAT ZA POSLEDNÍ; vložení doprostřed je pro Postgres přejmenování všech
  -- následujících. Naměřeno v prod 2026-09-06 10:02Z: `relation_kinds` stálo za
  -- `relations`, migrate spadl na „cannot change name of view column open_beats
  -- to relation_kinds", stack zůstal bez gateway a API dalo 502. Na jednorázové
  -- databázi se to neprojeví — tam pohled VZNIKÁ, v provozu se NAHRAZUJE.
  --
  -- Tytéž vazby JAKO DRUHY, ne jako věta: `relations` je pro čtenáře (kdo s kým),
  -- tohle je pro filtr — osa „vazba" porovnává PRVEK pole (filters op 'contains', K5).
  ( SELECT array_agg(DISTINCT rel.relation_kind)
      FROM public.twin_relations rel
     WHERE rel.source_twin_id = b.twin_id AND rel.valid_to IS NULL ) AS relation_kinds
FROM base b
LEFT JOIN public.profiles p ON p.user_id = b.user_id
LEFT JOIN public.audience_actor_tier_v tier ON tier.user_id = b.user_id
LEFT JOIN public.audience_actor_overlay_v ovl ON ovl.actor_user_id = b.user_id
LEFT JOIN public.audience_actor_aggregate_latest_v agg ON agg.user_id = b.user_id;

COMMENT ON VIEW public.audience_admin_twin_directory_v IS
  'Registr dvojčat: entity jádra (s účtem i bez) + čočka zapojení. Řádky bez twin_id = účty před backfillem (twin_status unbound). Drives the extranet registr section (ADR-003 K1).';

-- View: public.audience_admin_twin_relations_v
-- Vazby a účasti jednoho dvojčete v obou směrech (ADR-003): hrany grafu
-- (twin_relations, platnost od–do) + kontextové role (story_participants ve
-- story kohorty/skupiny) promítnuté jako řádky téhož tvaru. Detail `twin`
-- v extranetu z toho kreslí "zastupuje / člen / role v".
CREATE OR REPLACE VIEW public.audience_admin_twin_relations_v AS
SELECT
  rel.source_twin_id AS twin_id,
  'out'::text        AS direction,
  rel.relation_kind,
  rel.target_twin_id AS other_twin_id,
  COALESCE(tt.label, tt.entity_type) AS other_label,
  tt.entity_type     AS other_entity_type,
  rel.valid_from,
  rel.valid_to,
  (rel.valid_to IS NULL) AS is_active
FROM public.twin_relations rel
JOIN public.twin_entities tt ON tt.id = rel.target_twin_id
UNION ALL
SELECT
  rel.target_twin_id AS twin_id,
  'in'::text         AS direction,
  rel.relation_kind,
  rel.source_twin_id AS other_twin_id,
  COALESCE(ts.label, ts.entity_type) AS other_label,
  ts.entity_type     AS other_entity_type,
  rel.valid_from,
  rel.valid_to,
  (rel.valid_to IS NULL) AS is_active
FROM public.twin_relations rel
JOIN public.twin_entities ts ON ts.id = rel.source_twin_id
UNION ALL
-- kontextová role = účast ve story skupiny; "druhá strana" je skupina
SELECT
  acct.twin_id       AS twin_id,
  'role'::text       AS direction,
  ('role_in:' || sp.role) AS relation_kind,
  NULL::uuid         AS other_twin_id,
  COALESCE(s.name, ps.title) AS other_label,
  'cohort'::text     AS other_entity_type,
  sp.joined_at       AS valid_from,
  NULL::timestamptz  AS valid_to,
  true               AS is_active
FROM public.story_participants sp
JOIN public.partner_stories ps ON ps.id = sp.story_id
LEFT JOIN public.studies s ON s.id = ps.study_id
JOIN public.twin_external_refs acct
  ON acct.ref_kind = 'account' AND acct.state = 'confirmed' AND acct.valid_to IS NULL
 AND acct.source_key = sp.user_id::text;

COMMENT ON VIEW public.audience_admin_twin_relations_v IS
  'Vazby (twin_relations, oba směry) a kontextové role (story_participants) jednoho dvojčete. Drives the extranet twin detail (ADR-003).';

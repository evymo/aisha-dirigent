-- View: public.audience_admin_twin_composition_v
-- Z ČEHO SE KOMUNITA SKLÁDÁ — dvojčata po druhu a zdroji, s mírou zapojení.
--
-- ⛔ NAMĚŘENO 2026-09-07: statistiky měřily starý model (15 osob), zatímco
-- systém běží nad dvojčaty (370: 264 osob, 106 organizací). Tenhle pohled je
-- ta nejzákladnější otázka, na kterou dosud nebylo kde odpovědět: KDO tu je.
--
-- Zdroj se bere z POTVRZENÉ identitní reference. Nepotvrzené se nepočítají —
-- návrh, který nikdo neratifikoval, není tvrzení o původu; jinak by se
-- 908 čekajících návrhů promítlo do statistiky jako fakt.
CREATE OR REPLACE VIEW public.audience_admin_twin_composition_v AS
 SELECT t.entity_type,
    COALESCE(r.source, 'bez zdroje') AS source,
    count(*) AS twin_count,
    count(*) FILTER (WHERE ev.event_count > 0) AS with_activity,
    count(*) FILTER (WHERE ev.last_at > (now() - '90 days'::interval)) AS active_90d,
    count(*) FILTER (WHERE rel.relation_count > 0) AS with_relations,
    COALESCE(sum(ev.event_count), 0::bigint) AS total_events
   FROM twin_entities t
   LEFT JOIN LATERAL (
     SELECT x.source FROM twin_external_refs x
      WHERE x.twin_id = t.id AND x.state = 'confirmed' AND x.valid_to IS NULL
      ORDER BY x.created_at LIMIT 1) r ON true
   LEFT JOIN LATERAL (
     SELECT count(*) AS event_count, max(e.occurred_at) AS last_at
       FROM twin_events e WHERE e.twin_id = t.id AND e.event_type <> 'parameter') ev ON true
   LEFT JOIN LATERAL (
     SELECT count(*) AS relation_count FROM twin_relations rr
      WHERE (rr.source_twin_id = t.id OR rr.target_twin_id = t.id) AND rr.valid_to IS NULL) rel ON true
  GROUP BY 1, 2;

COMMENT ON VIEW public.audience_admin_twin_composition_v IS
  'Složení komunity: dvojčata po druhu a zdroji, kolik z nich má aktivitu,
   vazby a nedávný dotek. Odpovídá na otázku "kdo tu je".';

REVOKE ALL ON public.audience_admin_twin_composition_v FROM PUBLIC;
GRANT SELECT ON public.audience_admin_twin_composition_v TO authenticated, service_role;

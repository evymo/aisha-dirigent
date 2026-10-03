-- ============================================================================
-- Source of Truth: twin_events
-- Popis: Události dvojčat (jízda, příjezd, přiřazení řidič↔vůz, plánovaný
--        úkol, výpadek GPS…) — append-only doménová vrstva, na které se
--        potkávají tvary: plán (úkol zdroje) × skutečnost (telemetrie) ×
--        doklad (dokument v li_*/document_registry přes story).
--        Idempotentní import: dedup přes partial unique index
--        uq_twin_events_source_ref (source, event_type, source_ref) —
--        opakovaný import stejného okna aktualizuje ended_at/attrs,
--        nevytváří duplicitu (vzor wd_rides).
--        ended_at IS NULL = událost trvá / rozpracovaná (vzor wd_rides.end_time).
--        Temporální vazby (přiřazení řidič↔vůz) jsou událost s ended_at,
--        NIKDY mutable sloupec na entitě.
--        story_id = vazba na obchodní případ (story spine) — bez FK: story
--        žije ve vlastní doméně, událost ji jen referencuje.
--        Spravováno: twin_record_events_audited (service/adaptéry).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.twin_events (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text         NOT NULL,
  twin_id         uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  related_twin_id uuid         REFERENCES public.twin_entities(id) ON DELETE SET NULL,
  place_twin_id   uuid         REFERENCES public.twin_entities(id) ON DELETE SET NULL,
  story_id        uuid,
  occurred_at     timestamptz  NOT NULL,
  ended_at        timestamptz,
  attrs           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  source          text         NOT NULL,
  source_ref      text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_events_event_type_not_blank CHECK (btrim(event_type) <> ''),
  CONSTRAINT twin_events_source_not_blank CHECK (btrim(source) <> ''),
  CONSTRAINT twin_events_time_order CHECK (ended_at IS NULL OR ended_at >= occurred_at)
);

COMMENT ON TABLE public.twin_events IS 'Události dvojčat (append-only) — místo setkání plán×skutečnost×doklad; dedup importu přes (source, event_type, source_ref)';
COMMENT ON COLUMN public.twin_events.event_type IS 'Volný slug (ride/arrival/assignment/task_planned/gps_gap…) — slovník je doménová/instance volba';
COMMENT ON COLUMN public.twin_events.related_twin_id IS 'Druhá strana vazby — u jízdy řidič k vozidlu, u přiřazení vůz k řidiči';
COMMENT ON COLUMN public.twin_events.place_twin_id IS 'Místo události jako twin entita (Place) — příjezd/odjezd/nakládka';
COMMENT ON COLUMN public.twin_events.story_id IS 'Obchodní případ (story spine), v němž událost figuruje — bez FK, story je vlastní doména';
COMMENT ON COLUMN public.twin_events.ended_at IS 'NULL = trvá / rozpracovaná (jízda bez konce, otevřené přiřazení)';
COMMENT ON COLUMN public.twin_events.source_ref IS 'Externí id události ve zdroji (Id_jizda, task id…) — klíč idempotence importu';

ALTER TABLE public.twin_events ENABLE ROW LEVEL SECURITY;

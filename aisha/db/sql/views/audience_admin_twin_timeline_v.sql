-- View: public.audience_admin_twin_timeline_v
-- Osa jednoho dvojčete (ADR-003 K1/K3): typové záznamy story_entries, jejichž
-- subjekt je dvojče samo (subject_type 'twin') NEBO účet, který na dvojče
-- ukazuje potvrzenou referencí (subject_type 'actor') — A DÁLE události
-- twin_events (ingest: e-maily, schůzky, komunikace). Jeden řádek = jedna
-- stopa; `twin_id` je klíč filtru pro detail, `user_id` čočka pro účty.
-- Čte se přes get_audience_view_timeline_block (DEFINER, is_admin_or_staff).
--
-- ⛔ JEDNA OSA, NE DVĚ. Osa dvojčete odpovídá na otázku „co se s ním dělo".
-- Rozdělit ji na „záznamy" a „události" by nutilo člověka číst dvě osy a
-- spojovat si je v hlavě — to je práce, kterou má odvést systém.
-- NAMĚŘENO 2026-09-07 v produkci: twin_events měla 1 578 řádků (email 1380,
-- communication 118, meeting 75, parameter 5) a `view_table_usage` pro ni
-- nevracel ANI JEDEN pohled. Data bez čtenáře — v databázi vše správně, ale
-- osa ukazovala 47 záznamů místo 1 625 stop, což vypadá jako chybějící import.
--
-- ⛔ SLOUPCE SE NESMÍ PŘEROVNAT. `CREATE OR REPLACE VIEW` umí sloupce jen
-- PŘIDAT NA KONEC; vložení doprostřed je přejmenování a v provozu spadne
-- (naměřeno 2026-09-06, API 502). Union proto drží týž seznam i pořadí.
-- Hlídá src/tests/db/pohled-jde-nahradit.test.ts.
CREATE OR REPLACE VIEW public.audience_admin_twin_timeline_v AS
WITH acct AS (
  SELECT r.twin_id, r.source_key::uuid AS user_id
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL
    AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
SELECT
  COALESCE(CASE WHEN se.subject_type = 'twin'  THEN se.subject_id END, a.twin_id)  AS twin_id,
  COALESCE(CASE WHEN se.subject_type = 'actor' THEN se.subject_id END, t.user_id)  AS user_id,
  se.id            AS entry_id,
  se.entry_type,
  se.content,
  se.is_internal,
  COALESCE(se.occurred_at, se.created_at) AS occurred_at,
  se.created_by,
  se.story_id,
  se.metadata
FROM public.story_entries se
LEFT JOIN acct a ON se.subject_type = 'actor' AND a.user_id = se.subject_id
LEFT JOIN acct t ON se.subject_type = 'twin'  AND t.twin_id = se.subject_id
WHERE se.subject_type IN ('twin', 'actor')

UNION ALL

-- Události z ingestu (e-maily, schůzky, komunikace).
-- ⛔ `parameter` NENÍ dotek, ale HODNOTA dvojčete (`demo_region = Praha`) — pohání
-- osu přepínače, na časové ose kontaktů nemá co dělat. Vyloučeno JMENOVITĚ, a ne
-- naopak výčtem toho, co se ukazuje: nový druh události se pak objeví sám, místo
-- aby TIŠE ZMIZEL. Po dnešku (data bez čtenáře) je viditelnost přednější.
-- `content` se NEVYMÝŠLÍ — nese předmět; naměřeno 2026-09-07, že `subject` má
-- 100 % událostí mimo `parameter`. Když by chyběl, zůstane NULL: prázdno je
-- poctivější než dopsaný text.
SELECT
  te.twin_id                                   AS twin_id,
  ev.user_id                                   AS user_id,
  te.id                                        AS entry_id,
  te.event_type                                AS entry_type,
  NULLIF(btrim(te.attrs->>'subject'), '')      AS content,
  false                                        AS is_internal,
  COALESCE(te.occurred_at, te.created_at)      AS occurred_at,
  NULL::uuid                                   AS created_by,
  te.story_id                                  AS story_id,
  te.attrs                                     AS metadata
FROM public.twin_events te
LEFT JOIN acct ev ON ev.twin_id = te.twin_id
WHERE te.twin_id IS NOT NULL
  AND te.event_type <> 'parameter';

COMMENT ON VIEW public.audience_admin_twin_timeline_v IS
  'Typed records and ingested events on one twin''s axis (subject twin, or the account bound to it). Filter by twin_id for the extranet twin detail (ADR-003).';

-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) čte podklad MIMO jeho RLS.
-- Čte se JEN přes DEFINER blokové funkce get_audience_view_*_block (stráž
-- is_admin_or_staff + jmenný prostor audience_admin_*_v). Přímý grant klientské
-- roli tu stráž obcházel přes /rest/v1/ (naměřeno na čisté DB main 0f992f647:
-- authenticated SELECT, u followup_queue/twin_directory i DML z default privileges).
-- REVOKE i z anon/authenticated: na běžící DB žijí explicitní granty z dřívějších
-- bloků heals a z ALTER DEFAULT PRIVILEGES při každém DROP+CREATE pohledu.
-- Třídu hlídá src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.audience_admin_twin_timeline_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_twin_timeline_v TO service_role;

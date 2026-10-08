-- Policy: graph_nodes admin staff read
-- Step:   Step 7 (Hippocampus Graph RAG)
-- Patched by: aisha/db/migrations/20260519030000_fix_owner_user_id_typo.sql
--             (ps.owner_user_id → ps.user_id — partner_stories.owner_user_id
--             was never a column; the canonical owner reference is user_id).
-- Patched by: aisha/db/migrations/20260520060000_rbac_4clause_unification.sql
--             (added is_stack_default clause so the predicate matches the
--             workbench Phase 6/7 canonical pattern).
--
-- ⛔ NAMĚŘENO 2026-10-05 (nezávislá revize nad mainem 8b7637acc): politika vydala přihlášenému
-- KAŽDÝ globální uzel (holé `story_id IS NULL`) a KAŽDÝ uzel výchozího příběhu (holé
-- `ps.is_stack_default = true`). Uzel nese titulek svého zdroje (entity_label), takže šly ven
-- titulky soukromých položek znalostí (globálních i výchozího příběhu), soukromých expertních
-- pravidel, útržky agentních pamětí (Memory = memory_type + 80 znaků obsahu), návrhy a audit.
--
-- ČÍ JE UZEL (z kódu, ne odhadem — bootstrap Step 7.1 a fn_apply_graph_extraction_audited):
--   KnowledgeItem  ← knowledge_items  titulek položky, story_id = příběh položky
--   ExpertRule     ← expert_rules     titulek pravidla, story_id NULL
--   Story / Run    ← partner_stories / ai_runs, story_id = příběh zdroje
--   Concept        ← extrakce LLM z běhu, story_id = příběh běhu (zdroj žádný)
--   Memory / Proposal / AuditEvent / Agent ← agent_memories / improvement_proposals /
--                     audit_journal / agent_catalog, story_id NULL
--
-- PRAVIDLO (2026-10-06):
--   · správa vše;
--   · uzel z položky znalostí nebo z expertního pravidla vidí jen ten, kdo smí číst ZDROJOVÝ řádek
--     napřímo. Poddotaz se vyhodnocuje právy tazatele, takže rozhodují politiky knowledge_items
--     a expert_rules — domov viditelnosti v podobě pro politiky (množina
--     knowledge_visibilities_for_caller: `members` jen přihlášenému, `guild` jen gildě, `private`
--     nikomu mimo správu), čitelný stav, položka příběhu jen vlastníkovi a účastníkovi. Příběh
--     UZLU tu nerozhoduje (uzel zapsaný do jiného příběhu než položka titulek nevydá);
--   · ostatní uzly (Story, Run, Concept) vlastník a účastník příběhu uzlu — i výchozího příběhu,
--     ale jen ti: Concept výchozího příběhu je výtah LLM z běhů kohokoli a jeho zdroj (co přesně
--     z běhu vzešlo) se na uzlu nedá změřit — fail-closed;
--   · globální uzel bez zdroje znalostí (Memory, Proposal, AuditEvent, Agent, Concept bez příběhu)
--     jen správa: vlastník takového uzlu buď z kódu není jednoznačný (Concept), nebo je zdroj
--     soukromý / jen pro správu a čtení uzlu napřímo nikdo nepotřebuje — fail-closed.
-- Holé „výchozí příběh = každému“ tu už není: tabulka knowledge_items položky výchozího příběhu
-- mimo vlastníka a účastníky nevydá a uzel nevydá víc než jeho zdroj. Podle štítku výchozí příběh
-- otevírají jen cesty běhu (citace, graf běhu, seznam položek příběhu), kde je běh sdílený.
-- Proč ne `public.knowledge_visibility_searchable(…)` přímo jako v citacích: politika se vyhodnocuje
-- právy tazatele a ten domov (ani knowledge_audience_in_guild) spustit nesmí — každé čtení by
-- skončilo „permission denied“ (brána politika-vola-jen-spustitelne). Podobou domova pro politiky
-- je množina štítků, kterou nesou politiky zdrojových tabulek.
-- Měří src/tests/db/pribeh-a-beh-cteni-podle-id.runtime.test.ts; tvar drží brána
-- rbac-4clause-unification. Graf čtený definer funkcemi (citace, graf běhu, vrstva graph_context)
-- se politikou neřídí — viz fn_get_run_graph_context a fn_graph_multihop.
-- ⚠ ZNÁMÁ MEZ (pojmenovaná, ne tichá): fn_graph_multihop je DEFINER s GRANT authenticated a vrací
-- entity_label uzlů dosažitelných po hranách BEZ kontroly viditelnosti (p_story_id NULL → všechny) —
-- titulky soukromých položek, pamětí a auditu přes hranu z uzlu, který tazatel číst smí. Tahle
-- politika ji NEzavírá; samostatná oprava (fronta, týž domov autority zdroje).

DROP POLICY IF EXISTS "graph_nodes admin staff read" ON public.graph_nodes;
CREATE POLICY "graph_nodes admin staff read" ON public.graph_nodes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.is_admin_or_staff((SELECT auth.uid())))
    OR CASE graph_nodes.source_table
      WHEN 'knowledge_items' THEN EXISTS (
        SELECT 1 FROM public.knowledge_items ki
         WHERE ki.id = graph_nodes.source_id
      )
      WHEN 'expert_rules' THEN EXISTS (
        SELECT 1 FROM public.expert_rules er
         WHERE er.id = graph_nodes.source_id
      )
      ELSE EXISTS (
        SELECT 1 FROM public.partner_stories ps
         WHERE ps.id = graph_nodes.story_id
           AND (
             ps.user_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.story_participants sp
                WHERE sp.story_id = ps.id AND sp.user_id = auth.uid()
             )
           )
      )
    END
  );

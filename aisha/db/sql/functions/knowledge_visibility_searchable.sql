-- ============================================================================
-- Source of Truth: knowledge_visibility_searchable
-- Popis: JEDEN domov pravidla „s jakou viditelností se GLOBÁLNÍ položka znalostí vydá tomu,
--        kdo k ní nemá přístup přes správu“ — pro KAŽDOU cestu čtení: politiky tabulky
--        knowledge_items i expert_rules (čtení napřímo přes PostgREST, přes množinu
--        knowledge_visibilities_for_caller), hledání v2 a v3, čtení podle id, vrstvu mozku (zásady, rysy
--        osobnosti), citace a graf běhu, čtenáře expertních pravidel (přes expert_rule_visible_to). Kdo funkci volat musí, drží brána
--        znalosti-viditelnost-kazda-cesta (každá funkce, která čte knowledge_items, je
--        zařazená; čtenář globálních položek domov volá a vlastní výčet viditelností nenese).
--
--   public   každému
--   members  jen přihlášenému — tomu, PRO KOHO se čte, když má identitu. Anonym a služba bez
--            publika identitu nemají. Rozhodnutí majitele 2026-10-04: nepřihlášený „vidí jen
--            public“. Stejně to mají pravidla (get_expert_rules) a témata.
--   guild    jen gildě — kdo v ní je, říká public.knowledge_audience_in_guild (dnes: má profil
--            partnera; ⛔ otevřené rozhodnutí majitele „gilda jen přijatí do clusteru a po testech“).
--   cokoli jiného (private, neznámá hodnota, NULL)  ne — private vidí jen správa, a to vlastní
--            větví volajícího (is_admin_or_staff), ne tady.
--
-- Obě pravdivostní hodnoty spočítá volající JEDNOU z toho, pro koho se čte; bez identity jsou
-- obě false — výjimka pro službu bez publika není. Výjimka podle TYPU položky (zásady a rysy
-- „vždy“) tu není a nesmí být ani u volajících: štítek viditelnosti znamená všude totéž.
--
-- Změřeno 2026-10-04/05: hledání mělo výčet ('public', 'members', 'guild') bez ohledu na
-- tazatele (interní téma správy zapisované jako `guild` našel hledáním i anonym); politika
-- tabulky a čtení podle id nesly vlastní výčet ('public', 'members'), takže `members` šlo
-- anonymovi; zásady a rysy šly ven s jakoukoli viditelností.
--
-- ROLÍM API SE NEVYDÁVÁ: volají ji definer funkce (běží právy vlastníka) a plánovač ji do jejich
-- dotazů vkládá — žádné volání na řádek v hledání. Politiky tabulek (vyhodnocují se právy tazatele)
-- se ptají public.knowledge_visibilities_for_caller(): ta pro identitu VOLAJÍCÍHO spočítá JEDNOU za
-- dotaz množinu štítků, které TADY vyjdou true — pravidlo zůstává na jednom místě.
-- „Je v gildě“ má vlastní domov: public.knowledge_audience_in_guild(uživatel).
--
-- OTEVŘENÉ ROZHODNUTÍ majitele (tahle funkce ho nemění, brána ho drží pojmenované):
--   interní téma se do znalostí zapisuje jako `guild` (sync_topic_version_to_knowledge_item).
--
-- Čistá funkce bez čtení tabulek: plánovač ji do dotazu vkládá, nevzniká volání na řádek.
--
-- Signatura se změnila výměnou (přibylo „je přihlášen“). Dvouvstupový tvar zahazuje heals.sql —
-- v tomhle souboru jeho DROP není záměrně: generátor baseline bere každé `public.f(…)` v souborech
-- funkcí jako volání a dvouvstupové by ohlásil jako chybějící přetížení. Tím zároveň hlídá, že
-- žádný volající se dvěma vstupy nezbyl.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.knowledge_visibility_searchable(p_visibility text, p_signed_in boolean, p_in_guild boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_visibility = 'public' THEN true
    WHEN p_visibility = 'members' THEN COALESCE(p_signed_in, false)
    WHEN p_visibility = 'guild' THEN COALESCE(p_in_guild, false)
    ELSE false
  END
$$;

-- Není to RPC: volají ji jen definer funkce (právy vlastníka) a pomocník pro politiky tabulek.
REVOKE ALL ON FUNCTION public.knowledge_visibility_searchable(text, boolean, boolean) FROM PUBLIC;

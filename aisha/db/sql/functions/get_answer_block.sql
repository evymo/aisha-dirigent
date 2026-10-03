-- get_answer_block — blok „Zeptej se".
--
-- Kontrakt bloku: první sloupec je prozaická odpověď, každý další je číslo/údaj
-- zobrazený vedle ní (AskPanel to čte podle DEKLAROVANÝCH sloupců, ne podle jmen).
--
-- ── 2026-07-30: SCOPE JAKO VEKTOR, ZANESENÝ DO SYSTÉMU ──────────────────────
-- Dřív tahle funkce poslala otázku odpovídači a vrátila dva sloupce. Scope si
-- odpovídač HÁDAL z textu otázky a nikde se nezapsalo, kdo se pod jakým pohledem
-- co dozvěděl. Dvě důsledky, oba naměřené, ne teoretické:
--   ŠUM — dva zdroje pravdy o scope (volba uživatele × slova v otázce) a silnější
--   byl ten nezamýšlený: „kolik je hodin?" → přehled nájemců, coverage FULL
--   (produkce 07-29, zapsáno v hlavičce answer_verified_facts).
--   ODPOVĚDNOST — funkce spočítala `intent` a `source` a poslala na drát jen
--   `answer` + `coverage`. Doklad o tom, čím je odpověď podložená, se zahodil
--   v posledním kroku.
-- Odteď: scope je AUTORITATIVNÍ vstup (`p_params.scope`, vektor souřadnic),
-- rozřeší ho JEDINÝ vlastník pravidla (`scope_effective`), běh se ZAPÍŠE do
-- `ai_runs` + `ai_trace_events` s vazbou na story (`scope_story_id`) a vrácená
-- provenance nese `scope_requested` / `scope_effective` / `run_id`.
--
-- PROČ JE FUNKCE VOLATILE (byla `stable`): zapisuje běh. Deklarovat ji dál jako
-- stable by byla lež směrem k plánovači i k PostgRESTu.
--
-- ZPĚTNÁ KOMPATIBILITA JAKO VLASTNOST, NE JAKO OHLED: nová pole v `provenance`
-- se posílají VÝHRADNĚ tomu, kdo scope poslal. Ajv je all-or-nothing — jedno
-- neznámé pole zneplatní CELÝ blok, get_block_data se nezavolá a na obrazovce je
-- „data se nepodařilo načíst". Povrchy se přitom nasazují jinou kadencí než jádro
-- (jádro NEpřebuduje povrch), takže obě pořadí nasazení musí být bezpečná:
-- starý klient scope neposílá → dostane bajtově tutéž obálku jako dřív.
-- Běh se ale zapisuje VŽDY: autoritou je záznam, ne jeho ozvěna v odpovědi.

create or replace function public.get_answer_block(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := coalesce(p_params->>'question', p_params->>'q', '');
  v_a jsonb;
  v_scope_req jsonb;
  v_story jsonb;
  v_run uuid;
  v_run_note text;
  v_prov jsonb;
  /** Na CO odpověď ukazuje (entity_kind + id), když se dal najít přesný klíč. */
  v_target jsonb;
  v_cols jsonb := jsonb_build_array(
    jsonb_build_object('key','odpoved','label_key','app.cols.answer'),
    jsonb_build_object('key','pokryti','label_key','app.cols.coverage'),
    -- Zdroj patří VEDLE odpovědi. Odpovídač ho počítá od začátku; do 07-30 ho
    -- tenhle blok zahazoval, takže na obrazovce stálo tvrzení bez doložení.
    jsonb_build_object('key','zdroj','label_key','app.cols.source'));
  v_empty jsonb := jsonb_build_object(
    'data', jsonb_build_object('columns', v_cols, 'rows', '[]'::jsonb),
    'provenance', jsonb_build_object(
      'source_slug',  'answer_verified_facts',
      'trace_id',     'answer_chain:answer',
      'freshness_at', now()));
begin
  -- ⛔ FAIL-CLOSED STRÁŽ — a musí ověřovat NÁROK, ne jen přihlášení.
  --
  -- `security definer` obchází RLS, takže tahle funkce si autorizaci musí udělat
  -- SAMA. Do 2026-08-01 se ptala jen „je někdo přihlášen?", a to nestačí:
  -- naměřeno na produkci, že uživatel BEZ JEDINÉ ROLE dostal z chatu celkový
  -- roční nájem i největšího nájemce jménem — zatímco z každého bloku nad TÝMIŽ
  -- daty dostal 0 řádků. Sesterská cesta mlčela, tahle mluvila; přesně tak se
  -- tenhle druh díry pozná.
  --
  -- Nárok se tu proto ptá stejně, jak ho RLS vyhodnocuje blokům. Odpověď je
  -- PRÁZDNÁ, ne chyba — kdo nemá nárok, se nemá dozvědět ani to, že se ptal na
  -- něco existujícího; a prázdná větev zůstává bajtově stejná i pro volajícího
  -- se scope.
  if not (public.is_service_role() or public.is_admin_or_staff()) then
    return v_empty;
  end if;

  if v_q = '' then
    return v_empty;
  end if;

  -- Vadný vektor je CHYBA, ne tichý průchod: odpovědět nezúženě na dotaz, který
  -- si zúžení vyžádal, je přesně ta lež, kvůli které tenhle mechanismus vznikl.
  -- Padne jen tenhle blok (App loguje a přeskočí ho), ne celá konzole.
  v_scope_req := public.scope_normalize(p_params->'scope');

  -- Instanční konfigurace PROCHÁZÍ, neinterpretuje se tady: `source_params`
  -- bloku jsou už v `p_params` (get_block_data je slévá s parametry volajícího),
  -- takže vzory nájemních položek — vlastnost PODNIKU, ne platformy — dorazí
  -- k odpovídači, aniž by je platforma musela znát. Bez nich derivace mlčí
  -- a přizná to, místo aby si domyslela.
  v_a := public.answer_verified_facts(
           v_q,
           coalesce(p_params->>'style', 'strucny'),
           v_scope_req,
           coalesce(p_params->'config', '{}'::jsonb));

  -- ── ZÁPIS BĚHU ────────────────────────────────────────────────────────────
  -- Vazba na story je to, co dělá z odpovědi přiřaditelný akt: běh vždy patří ke
  -- story. Když scope story neurčuje, `scope_story_id` vrátí NULL i DŮVOD —
  -- trigger běh zakotví do stack-default story a důvod jde do metadat, takže
  -- „tenhle pohled ještě není uzel" je čitelný fakt, ne mlčení.
  v_story := public.scope_story_id(v_scope_req);
  begin
    v_run := public.create_ai_run(
      'chat',
      nullif(v_story->>'story_id','')::uuid,
      v_uid,
      jsonb_build_object(
        'source',       'answer_verified_facts',
        'deterministic', true,
        'scope',        v_a->'scope',
        'story_origin', v_story->>'origin',
        'story_detail', v_story->>'detail'),
      -- Odpověď je deterministické čtení ověřených faktů: žádné volání modelu,
      -- tedy nula. Bez tohohle by se běh admitoval proti p90 odhadu druhu
      -- „chat" a na přečerpané story by se ZÁZNAM ztratil právě tam, kde je
      -- odpovědnost nejdůležitější.
      0);

    insert into public.ai_trace_events
      (run_id, event_type, agent_slug, operation, status, duration_ms, cost_json,
       request_summary, response_summary)
    values
      (v_run, 'memory_read', 'answer', 'answer_verified_facts', 'ok', 0,
       jsonb_build_object('usd', 0),
       -- Co se ptalo a POD JAKÝM vektorem. Bez otázky je záznam nečitelný,
       -- bez vektoru nepřiřaditelný.
       jsonb_build_object('question', v_q, 'scope', v_a->'scope',
                          'scope_dropped', v_a->'scope_dropped'),
       jsonb_build_object('intent', v_a->>'intent', 'coverage', v_a->>'coverage',
                          'source', v_a->>'source'));

    perform public.finish_ai_run(v_run, 'succeeded', jsonb_build_object(
      'intent', v_a->>'intent', 'coverage', v_a->>'coverage', 'source', v_a->>'source',
      'scope', v_a->'scope', 'scope_dropped', v_a->'scope_dropped'));
  exception when others then
    -- VÝJIMKA JE DIAGNOSTIKA: odpověď už vznikla z dat, na která volající PRÁVO
    -- MÁ (RLS ji pustila), takže ji nezadržíme — ale důvod, proč není záznam,
    -- se PŘIZNÁ v provenance. Tichý discard by z chybějícího záznamu udělal
    -- neexistující problém. Typický případ: spend admission vrátí ask/deny.
    v_run := null;
    v_run_note := left(coalesce(sqlerrm, 'run not recorded'), 200);
  end;

  v_prov := jsonb_build_object(
    'source_slug',  'answer_verified_facts',
    'trace_id',     'answer_chain:answer',
    'freshness_at', now());

  -- Nová pole jen tomu, kdo se pod pohledem ptal (viz hlavička).
  if v_scope_req <> '[]'::jsonb then
    v_prov := v_prov || jsonb_build_object(
      'scope_requested', v_scope_req,
      'scope_effective', coalesce(v_a->'scope', '[]'::jsonb),
      'scope_dropped',   coalesce(v_a->'scope_dropped', '[]'::jsonb))
      || case when v_run is not null
              then jsonb_build_object('run_id', v_run::text)
              else jsonb_build_object('run_note', coalesce(v_run_note, 'run not recorded')) end;
  end if;

  -- ── CÍL: „a je to tenhle záznam" ──────────────────────────────────────────
  --
  -- Odpověď uměla TVRDIT, ale ne UKÁZAT. Aby na dotaz „kde je dodák 12345"
  -- mohl klient ten doklad otevřít, musí odpověď nést cíl — a ten kanál vzniká
  -- DŘÍV než chytrost, protože bez něj je nasměrování nevyjádřitelné, ať je
  -- rozřazení záměru jakkoli dobré.
  --
  -- ⭐ NEROZŠIŘUJE SE TÍM KLASIFIKACE. `resolve_entity_reference` hledá EXAKTNÍ
  --    shodu klíče, nehádá záměr: každé slovo otázky se zkusí jako klíč a uspěje
  --    jen jednoznačná shoda. Přidat místo toho další regex do klasifikátoru by
  --    bylo stavění na tom, co už jednou selhalo.
  --
  -- ⚠️ VÝHRADNĚ NA VYŽÁDÁNÍ (`p_params.want_target`). Ajv je all-or-nothing:
  --    jedno neznámé pole zneplatní CELÝ blok a na obrazovce je „data se
  --    nepodařilo načíst". Povrchy se nasazují jinou kadencí než jádro, takže
  --    starý klient nepožádá a dostane bajtově tutéž obálku jako dosud —
  --    přesně týž postup jako u scope polí výš.
  if coalesce((p_params->>'want_target')::boolean, false) then
    select jsonb_build_object('entity_kind', r.entity_kind,
                              'entity_id',   r.entity_id::text,
                              'label',       r.label)
      into v_target
      from unnest(regexp_split_to_array(v_q, '[^[:alnum:]/_-]+')) tok
      cross join lateral public.resolve_entity_reference(tok) r
     -- Krátké tokeny se nezkoušejí: „a", „to", „DL" by trefily leda náhodou
     -- a náhodná shoda je horší než žádná — poslala by člověka na cizí doklad.
     where length(tok) >= 4
     limit 1;
  end if;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'columns', v_cols,
      'rows', jsonb_build_array(jsonb_build_object(
        'odpoved', v_a->>'answer',
        'pokryti', v_a->>'coverage',
        'zdroj',   coalesce(v_a->>'source', '')))),
    'provenance', v_prov)
    || case when v_target is not null
            then jsonb_build_object('target', v_target)
            else '{}'::jsonb end;
end;
$$;

comment on function public.get_answer_block(jsonb) is
  'Ask block: scope vector is the authoritative input (p_params.scope), resolved by scope_effective, the run is recorded in ai_runs/ai_trace_events with its story binding, and provenance returns scope_requested/scope_effective/run_id — but only to a caller that asked under a scope, so older bundles keep the byte-identical envelope.';

REVOKE ALL ON FUNCTION public.get_answer_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_block(jsonb) TO authenticated, service_role;

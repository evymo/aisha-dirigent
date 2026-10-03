-- Sekce extranetu, které volající SMÍ vidět — SLOUČENÝ tvar navigace.
--
-- Sekce jsou DATA (surface_layouts.surface je otevřený text) — klient je tedy
-- musí OBJEVIT, ne znát. Tři prameny, v tomhle pořadí síly:
--
--   1. rozvržení (surface_layouts) — sekce s bloky; RLS default-deny rozhoduje,
--      kdo ji vidí (SECURITY INVOKER, viz níž)
--   2. šablona (surface_sections) — skupina, pořadí, ikona, klíč jména,
--      deklarované NEAKTIVNÍ sekce; publikum šablonové sekce hlídá
--      surface_audience_allows (rozvržení žádné nemá, RLS by ji neořezala)
--   3. override (surface_section_overrides) — co si zákazník přejmenoval
--      v administraci; efektivní hodnota = coalesce(override, šablona)
--
-- ⚠️ ZMĚNA ROZHODNUTÍ (2026-07-29): dřívější verze sekce bez bloků ZAMLČELA
-- („sekce, kde by se nevykreslilo nic, je v navigaci horší než žádná").
-- To platilo, dokud stavy byly dva. Třetí stav je lepší odpověď na týž
-- problém: sekce deklarovaná šablonou, ale bez napojeného zdroje, se vrací
-- jako state='inactive' s reason_key — viditelná, neklikatelná, s důvodem.
-- Skrýt ji tvrdí zákazníkovi, že to produkt neumí; prázdná aktivní vypadá
-- jako chyba. Sekce, kterou nedeklaruje ani rozvržení, ani šablona,
-- neexistuje pořád.
--
-- Tvar položky (aditivní vůči původnímu — staří klienti čtou section +
-- block_count a nové osy ignorují):
--   { section, block_count, title_key?, icon?, group_key?, group_order,
--     position, state: 'active'|'inactive', reason_key? }
--
-- SECURITY INVOKER: běží jako volající, takže o viditelnosti sekcí s bloky
-- rozhoduje RLS nad surface_layouts. Uživatel bez grantů dostane prázdné pole,
-- ne chybu — neprozrazovat existenci sekce, na kterou nemá nárok.

create or replace function public.list_surface_sections()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with lay as (
    -- Číslo v navigaci = kolik bloků sekce VYKRESLÍ. Blok detailu stojí v sekci
    -- jen kvůli oprávnění (dispečer pustí jen umístěný blok) a kreslí se až po
    -- prokliku — `presentation:"detail"`, stejné pravidlo jako shell
    -- (PRESENTATION_DETAIL_ONLY). Řádek sekce zůstává i s nulou.
    select l.surface,
           count(*) filter (where coalesce(b.source_params->>'presentation', '') <> 'detail') as n
    from public.surface_layouts l
    join public.surface_blocks b on b.id = l.block_id and b.is_active
    where l.is_active
    group by l.surface
  ),
  tpl as (
    select s.surface, s.title_key, s.icon, s.group_key, s.group_order,
           s.position, s.state, s.reason_key, s.audience, s.presence
    from public.surface_sections s
    where s.is_active
  ),
  merged as (
    select
      coalesce(t.surface, l.surface)                            as surface,
      coalesce(l.n, 0)                                          as n,
      coalesce(o.title_key,  t.title_key)                       as title_key,
      coalesce(o.icon,       t.icon)                            as icon,
      coalesce(o.group_key,  t.group_key)                       as group_key,
      coalesce(o.group_order, t.group_order, 0)                 as group_order,
      coalesce(o.position,   t.position, 0)                     as position,
      -- Bez bloků není co otevřít, ať šablona tvrdí cokoli — proto se stav
      -- 'inactive' vynucuje i tehdy, když by deklarace říkala 'active'.
      case when coalesce(l.n, 0) = 0 then 'inactive'
           else coalesce(o.state, t.state, 'active') end        as state,
      coalesce(o.reason_key, t.reason_key)                      as reason_key,
      t.audience                                                as audience,
      t.presence                                                as presence
    from tpl t
    full outer join lay l on l.surface = t.surface
    left join public.surface_section_overrides o on o.surface = coalesce(t.surface, l.surface)
  )
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'section',     m.surface,
        'block_count', m.n,
        'title_key',   m.title_key,
        'icon',        m.icon,
        'group_key',   m.group_key,
        'group_order', m.group_order,
        'position',    m.position,
        'state',       m.state,
        'reason_key',  m.reason_key
      ))
      order by m.group_order, m.position, m.surface
    ),
    '[]'::jsonb
  )
  from merged m
  where
    (
      -- sekce s bloky: viditelnost už rozhodla RLS nad surface_layouts (INVOKER)
      m.n > 0
      -- šablonová (typicky neaktivní) sekce: publikum hlídá sdílený interpret;
      -- bez deklarace audience ({} default) ji vidí každý přihlášený
      or (m.audience is not null
          and public.surface_audience_allows(auth.uid(), m.audience))
    )
    -- ⭐ SONDA DAT (2026-09-28): běžný uživatel sekci, ve které pro něj nic
    -- není, nevidí, i když do ní přístup má. Správa vidí vždy.
    and (m.presence is null
         or public.is_admin_or_staff()
         or public.surface_presence_ok(m.presence));
$$;

-- Grants: authenticated + service_role (NOT anon, #566 floor); RLS na
-- surface_layouts je skutečná hranice přístupu (SECURITY INVOKER).
REVOKE ALL ON FUNCTION public.list_surface_sections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_surface_sections() TO authenticated, service_role;

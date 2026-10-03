# Zadání — Verifikace Definition of Done

Spusť DoD gates aktivního zadání a reportuj pass/fail. Používej PŘED handbackem delegované práce.

## Arguments: $ARGUMENTS

## Instructions

1. **Načti aktivní zadání**: přečti `.aisha/zadani.json` → `wp_id` + `file`. Pokud neexistuje a `$ARGUMENTS` obsahuje WP id (např. `WP-04`), použij `docs/planning/zadani/WP-04-*.md`. Bez obojího: informuj uživatele a navrhni `/delegate <wp-id>`.

2. **Přečti sekci §7 (Definition of Done)** souboru zadání a extrahuj checklist příkazů.

3. **Spusť každý gate příkaz** ze zadání (typicky podmnožina):
   - `npm run test:gates`
   - `npm run build`
   - `npx tsc --noEmit`
   - `npx eslint <dotčené soubory>`
   - `npm run i18n:*` (pokud dotčeno)
   - `npm run func:validate` / `npm run db:migrate:local` (pokud dotčeno)

4. **Reportuj tabulku**: | Gate | Výsledek | Poznámka | — u failů přilož prvních ~10 řádků chyby. Nikdy nefalšuj výsledek; fail = fail.

5. **Projdi sekci §8 (Verifikace chování)** a proveď kroky, které jdou provést v tomto prostředí; ostatní vypiš jako „manuální krok pro handback" (např. kroky vyžadující prod přístup nebo Docker).

6. **Verdikt**:
   - Vše zelené + §8 ověřeno → „READY TO HANDBACK" + připrav handback dle §10 (branch, PR title, shrnutí).
   - Cokoliv červené → vypiš co opravit; pokud příčina spadá do eskalačních triggerů §9, doporuč eskalaci na Tier-A.

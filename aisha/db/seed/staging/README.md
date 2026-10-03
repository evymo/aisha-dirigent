# Staging Seeds

Seed soubory v této složce **nejsou** zahrnuty do `seed.compiled.sql`.

Slouží jako příprava pro budoucí integraci do hlavního seed systému (`core/` nebo `translations/`).

## Kdy sem umístit soubor

- Data, která ještě nepotřebujeme v lokálním dev prostředí
- Data, která jsou součástí migrací (produkce), ale pro local dev je chceme mít připravená jako seed
- Prototypy seedů před finálním zařazením

## Jak integrovat

1. Přesuň soubor do `core/` nebo `translations/`
2. Spusť `npm run db:seed:compile`
3. Ověř `npx supabase db reset`

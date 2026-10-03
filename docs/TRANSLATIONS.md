# Dynamické překlady (DB Translations)

## Struktura

Dynamické překlady jsou uloženy v tabulce `translations` a slouží pro:
- Produkty, studie, hero slidy
- Dotazníky (questionnaires)
- Souhlasy (consents)
- Achievementy
- Subscription packages

**Statické překlady** (UI texty) jsou v `src/i18n/segments/` - viz `docs/I18N_STANDARDS.md`.

---

## Seed soubory

```
supabase/seed/translations/
└── 00_translations.sql    # Všechny dynamické překlady
```

Seed se kompiluje přes `npm run db:seed:compile` a aplikuje přes `npm run db:seed`.

---

## Jak přidat nové překlady

### 1. Přes Admin UI (doporučeno)
1. Jdi do Admin → Překlady
2. Vytvoř/edituj překlad
3. Export do seedu (viz níže)

### 2. Přímo do SQL
```sql
INSERT INTO translations (key, locale, value, namespace) 
VALUES ('products.my_product.name', 'cs', 'Můj produkt', 'products')
ON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value;
```

---

## Export překladů z DB do seedu

```bash
# Lokální DB
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A << 'PSQL_EOF' > supabase/seed/translations/00_translations.sql
SELECT 'INSERT INTO translations (key, locale, value, namespace) VALUES (' ||
       quote_literal(key) || ', ' ||
       quote_literal(locale) || ', ' ||
       quote_literal(value) || ', ' ||
       quote_literal(namespace) || ') ON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value;'
FROM translations
ORDER BY namespace, key, locale;
PSQL_EOF
```

---

## Namespaces

| Namespace | Účel |
|-----------|------|
| `products` | Názvy a popisy produktů |
| `studies` | Názvy a popisy studií |
| `hero` | Hero slider texty |
| `questionnaires` | Bloky dotazníků |
| `consents` | Texty souhlasů |
| `achievements` | Achievementy |
| `subscription_packages` | Subscription packages |
| `archive` | Archivní dokumenty |

---

## RPC funkce

| Funkce | Účel | Role |
|--------|------|------|
| `get_translations_for_namespace(p_namespace, p_locale)` | Překlady pro namespace | anon, authenticated |
| `get_translations_with_status(p_namespace)` | Admin - s flagy stale/missing | authenticated |
| `upsert_translations(p_translations)` | Admin - hromadný upsert | authenticated (admin) |
| `delete_translations_by_key(p_namespace, p_key)` | Admin - smazání klíče | authenticated (admin) |

---

## Workflow pro změny

1. **Edituj v Admin UI** nebo přímo v DB
2. **Exportuj do seedu** (viz příkaz výše)
3. **Otestuj lokálně**: `npm run db:seed:compile && npm run supabase:reset`
4. **Commitni změny** v `supabase/seed/translations/00_translations.sql`

---

## Troubleshooting

### Překlady se nezobrazují
1. Zkontroluj zda existují: `SELECT COUNT(*) FROM translations WHERE namespace = 'X';`
2. Zkontroluj permissions funkce: `SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'get_translations_for_namespace';`

### Admin překlady nefungují
Funkce `get_translations_with_status` vyžaduje `authenticated` roli. Ověř GRANT:
```sql
GRANT EXECUTE ON FUNCTION get_translations_with_status(text) TO authenticated;
```

# Database ↔ Frontend Consistency Tests

**Status:** ✅ Aktivní v CI pipeline  
**Soubor:** `src/tests/db/db-frontend-consistency.test.ts`  
**Účel:** Automatická detekce nekonzistence mezi SQL source soubory a TypeScript kódem

---

## Problém který řeší

### Typický bug:
```typescript
// SQL funkce (get_partner_type.sql)
RETURN 'community';  -- Vrací 'community'

// Frontend (usePermissions.ts)
type PartnerType = "professional" | "amateur" | "uncertified";
isAmateur: partnerType === "amateur"  // Očekává 'amateur', ne 'community'
```

**Výsledek:** Runtime chyba, `isAmateur` je vždy `false` i když by mělo být `true`.

---

## Co test kontroluje

### 1. Enum Consistency (SQL ↔ TypeScript)

```typescript
it("journal_area enum - SQL source has all values used in functions")
```

Ověřuje že `supabase/sql/enums/journal_area.sql` obsahuje všechny hodnoty používané funkcemi:
- ✅ Detekuje chybějící enum hodnoty
- ✅ Zabraňuje 400 chybám z DB

**Odhalené problémy:**
- `'communication'` použito ale ne v enumu → přidáno
- `'consent'`, `'invitation'`, `'partner_action'` chybí → přidáno

---

### 2. RPC Return Values ↔ Frontend Expectations

```typescript
it("get_partner_type returns values matching PartnerType")
```

Kontroluje že hodnoty vracené SQL funkcemi odpovídají TypeScript typům:

| SQL Function | Returns | Frontend Type | Status |
|--------------|---------|---------------|--------|
| `get_partner_type` | `'professional'`, `'amateur'`, `'uncertified'` | `PartnerType` | ✅ Match |
| ~~`get_partner_type`~~ | ~~`'community'`~~ | ❌ Not in type | 🐛 **Fixed** |

---

### 3. Frontend Comparisons Match SQL Returns

```typescript
it("frontend partner type comparisons match SQL returns")
```

Najde všechny `partnerType === "xxx"` srovnání a ověří že SQL funkce tyto hodnoty opravdu vrací:

```typescript
// Frontend kód
if (partnerType === "amateur") { ... }

// ✅ SQL get_partner_type opravdu vrací 'amateur'
```

---

### 4. Audit Journal Area Consistency

```typescript
it("all journal_area values used in functions exist in enum")
```

Najde všechny použití `write_audit_journal(action, entity, area, ...)` a ověří že `area` existuje v enumu:

**Odhalené problémy (7):**
```
claim_invitation.sql: uses 'invitation' ❌
create_my_consents.sql: uses 'consent' ❌
get_invitations_admin.sql: uses 'user_management' ❌
```

---

### 5. Role String Consistency

```typescript
it("app_role enum values are used consistently in frontend")
```

Kontroluje že všechny `role === "xxx"` srovnání v hooks používají platné enum hodnoty.

---

## Jak test funguje

### 1. Čte SQL source soubory
```typescript
const enumFiles = readAllFilesInDir("supabase/sql/enums");
const functionFiles = readAllFilesInDir("supabase/sql/functions");
```

### 2. Extrahuje string literály
```typescript
// Z SQL funkcí
RETURN 'professional'; → ["professional"]
write_audit_journal(..., 'chat', ...) → ["chat"]

// Z TypeScript typů
type PartnerType = "professional" | "amateur" → ["professional", "amateur"]
```

### 3. Porovnává
```sql
-- SQL vrací
['professional', 'amateur', 'uncertified']

-- Frontend očekává
['professional', 'amateur', 'uncertified']

✅ Match!
```

---

## Spuštění

### Lokálně
```bash
npm run test:run src/tests/db/db-frontend-consistency.test.ts
```

### V CI
Automaticky běží při každém `npm run test:run` (GitHub Actions).

---

## Výstup

### Success
```
✓ src/tests/db/db-frontend-consistency.test.ts (9 tests) 22ms
  ✓ journal_area enum - SQL source has all values
  ✓ get_partner_type returns values matching PartnerType
  ✓ frontend partner type comparisons match SQL returns
  ✓ all journal_area values used in functions exist in enum
  ...
```

### Failure (příklad)
```
❌ SQL get_partner_type returns 'community' but PartnerType doesn't include it.
   PartnerType values: [professional, amateur, uncertified]

✗ claim_invitation.sql: uses 'invitation' but it's not in journal_area enum
```

---

## Maintenance

### Přidání nového testu

```typescript
it("my_new_function returns values matching MyType", () => {
  const sqlPath = path.join(PATHS.sqlFunctions, "my_new_function.sql");
  const sqlContent = readFile(sqlPath);
  const sqlReturns = extractReturnLiterals(sqlContent);
  
  const hookContent = readFile(path.join(PATHS.hooks, "useMyFeature.ts"));
  const typeValues = extractTypeLiterals(hookContent, "MyType");
  
  for (const sqlValue of sqlReturns) {
    expect(typeValues).toContain(sqlValue);
  }
});
```

### Aktualizace při změně struktury

Pokud se změní:
- Umístění SQL souborů → upravit `PATHS` konstantu
- Formát enum definic → upravit `extractEnumValues()`
- Způsob volání funkcí → upravit regex v `extractUsedLiterals()`

---

## Historické bugy odhalené

| Bug | Detekováno | Fix |
|-----|------------|-----|
| `get_partner_type` vrací `'community'` místo `'amateur'` | ✅ | [Změněno na `'amateur'`](../supabase/sql/functions/get_partner_type.sql) |
| `journal_area` chybí 9 hodnot | ✅ | [Přidáno do enumu](../supabase/sql/enums/journal_area.sql) |
| `get_my_chat_conversations` používá `'communication'` | ✅ | [Změněno na `'chat'`](../supabase/sql/functions/get_my_chat_conversations.sql) |

---

## Best Practices

### ✅ DO
- Přidat test pro každou novou funkci vracející string literály
- Aktualizovat SQL source soubory PŘED TypeScript typy
- Spustit test lokálně před commitem

### ❌ DON'T
- Hardcodovat string literály v kódu bez kontroly s DB
- Měnit TypeScript typy bez aktualizace SQL
- Ignorovat test failures (i když vypadají "malé")

---

## Výkon

| Metrika | Hodnota |
|---------|---------|
| Doba běhu | ~22ms |
| Soubory čteny | ~100 (SQL + hooks) |
| Kontroly | 9 test suites |
| Overhead v CI | Zanedbatelný |

---

## Related Documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) - RPC-only pattern
- [DEVELOPMENT_GUIDELINES.md](../DEVELOPMENT_GUIDELINES.md) - Code standards
- [E2E.md](./E2E.md) - E2E testing guide
- [Source of Truth](../../supabase/sql/README.md) - SQL source files structure

---

*Vytvořeno: 13. ledna 2026*  
*Autor: Konzistenční validační framework*

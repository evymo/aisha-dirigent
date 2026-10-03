# Sledování Komplexity Projektu

> Udržení přehledu nad velkým projektem vyžaduje systém. Bez systému se ztrácí kontext,  
> duplicity se množí a "hotové" věci přestávají fungovat po změnách jinde.

---

## Mentální Model Komplexity

```
NÍZKÁ KOMPLEXITA (1 soubor)
  └── Utility funkce, single hook, single komponenta

STŘEDNÍ KOMPLEXITA (2–5 souborů)
  └── Use case: nová feature s hookem + komponentou + testem

VYSOKÁ KOMPLEXITA (5–20 souborů)
  └── Nová doména: hooks + komponenty + schémata + překlady + testy + DB migrace

SYSTÉMOVÁ KOMPLEXITA (20+ souborů)
  └── Architektonická změna, nový autentizační flow, nový platební systém
```

Čím vyšší komplexita, tím důležitější jsou:
1. **Plán před implementací**
2. **Task tracking** (todo list s checkboxy)
3. **Logické commity** po dokončení atomických částí
4. **Gate testy** po každé větší změně

---

## Task Tracking Workflow

### Pro každý netriviální úkol:

```markdown
## [Název úkolu]

### Přehled
Stručný popis CO a PROČ.

### Ovlivněné oblasti
- src/hooks/useXxx.ts
- src/components/xxx/
- src/lib/schemas/xxx.ts
- překlady: products.json
- testy: src/tests/hooks/useXxx.test.ts

### Todo
- [ ] Zod schéma v src/lib/schemas/product.ts
- [ ] Hook useProducts s query
- [ ] Hook useCreateProduct s mutací
- [ ] ProductCard komponenta
- [ ] ProductList komponenta
- [ ] i18n klíče (EN + CS)
- [ ] Testy pro useProducts
- [ ] Testy pro useCreateProduct
- [ ] Gate testy prochází
- [ ] Commit
```

---

## Jak Sledovat Co Existuje

### Hook Inventory (automaticky):

```bash
# Seznam všech hooků
ls src/hooks/use*.ts | sort

# Hooky bez testů (odhalí arch. gate test)
npm run test:gates -- --reporter verbose

# Hooky s jejich závislostiami
grep -rn "import.*from.*@/hooks" src/components/ --include="*.tsx" | sort
```

### API Endpoint Inventory:

Udržuj soubor `src/lib/api/endpoints.ts`:

```typescript
// src/lib/api/endpoints.ts
export const API_ENDPOINTS = {
  // AUTH
  AUTH_LOGIN: "/auth/login",
  AUTH_LOGOUT: "/auth/logout",
  AUTH_ME: "/users/me",

  // PRODUCTS
  PRODUCTS_LIST: "/products",
  PRODUCTS_DETAIL: (id: string) => `/products/${id}`,
  PRODUCTS_CREATE: "/products",
  PRODUCTS_UPDATE: (id: string) => `/products/${id}`,
  PRODUCTS_DELETE: (id: string) => `/products/${id}`,

  // ORDERS
  ORDERS_LIST: "/orders",
  ORDERS_DETAIL: (id: string) => `/orders/${id}`,
  ORDERS_CREATE: "/orders",
} as const;
```

**Proč:** Pokud API změnilo endpoint URL, opravíš na jednom místě. Grep dovolí zjistit, kde je endpoint použit.

---

## Dependency Tracking

### Co závisí na čem:

Udržuj mentální nebo dokumentovaný model závislostí:

```
useSession ←── téměř vše (auth guard)
usePermissions ←── všechna oprávněná UI
useCart ←── useCheckout, CartSummary, CheckoutButton
useProducts ←── ProductList, ProductCard, useCart
```

**Pravidlo:** Pokud měníš hook, zkontroluj všechna místa kde je použit:

```bash
# Kde je hook použit?
grep -rn "useProducts" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|mock"
```

---

## Jak Pracovat s Migrací (Supabase projekty)

### Každá DB změna = nová migrace:

```
supabase/migrations/
├── 20260101120000_init.sql
├── 20260115083000_add_products_table.sql
├── 20260119154500_add_product_categories.sql
└── YYYYMMDDHHMMSS_popis_zmeny.sql
```

### Po vytvoření migrace VŽDY:

```bash
npm run db:migration:register   # zaregistruje v registry
npm run db:migrate:local         # aplikuj lokálně
npm run db:types:gen:local       # regeneruj TypeScript typy
```

### Source of Truth:

```
supabase/sql/           ← kanonický stav (aktualizuje se ručně nebo přes refresh script)
supabase/migrations/    ← inkrementální změny (NIKDY nearchivovat)
src/integrations/supabase/types.ts  ← GENEROVÁNO (neediovat ručně)
```

---

## Sledování Technického Dluhu

### Kategorie dluhu:

| Priorita | Typ | Příklady |
|----------|-----|---------|
| 🔴 KRITICKÉ | Security | Chybějící auth guard, sensitive data v logu |
| 🔴 KRITICKÉ | Breaking | TypeScript error, selhávající test |
| 🟡 VYSOKÉ | Performance | N+1 query, chybějící cache |
| 🟡 VYSOKÉ | Maintenance | Hook >300 řádků, chybějící test |
| 🟢 NÍZKÉ | Cleanup | Nepoužívaný import, TODO komentář |

### Tracking:

```markdown
<!-- docs/tasks/tech-debt.md -->

## 🔴 Kritické

## 🟡 Vysoké
- [ ] useProducts splitnout na useProductList + useProductSearch (řádků 450)
- [ ] Přidat Zod validaci do useOrders (vrací any)

## 🟢 Nízké
- [ ] Odstranit nepoužívaný hook useOldFeature.ts
```

---

## Kontrolní Otázky Před Implementací

Před začátkem každé netriviální feature si odpověz:

1. **Existuje už to?**  
   `grep -rn "useProducts\|ProductList" src/ 2>/dev/null`

2. **Kde to patří?** (vrstva, adresář)

3. **Co to ovlivní?** (hooky, komponenty, překlady, schémata)

4. **Jak to otestuji?** (jaký mock, jaký assert)

5. **Jak to commitnu?** (logické celky, ne mega-commit)

6. **Je to konzistentní s:?**
   - Naming conventions
   - Abecední parametry
   - i18n klíče
   - Zod schéma

---

## Komplexita Analýzy Změny

### Jednoduchá změna (< 1 hodina):
```
- Přidání i18n klíče
- Oprava bug v existujícím hooku
- CSS/styling změna
- Přidání jednoho pole do Zod schématu
```

### Střední změna (1–4 hodiny):
```
- Nový hook + test
- Nová komponenta
- Nový API endpoint (volání + hook + Zod)
- Refactor existujícího hooku
```

### Velká změna (> 4 hodiny, plánovat dopředu):
```
- Nová feature (doména)
- Nový auth flow
- DB migrace + typy + hooky + UI
- Refactor architektonické vrstvy
```

Pro velké změny:
1. Vytvoř plán (todo list)
2. Rozděl na menší atomické PR
3. Průběžně commituj
4. Po každém atomickém celku proveď `npm run test:run -- <relevantní>` a gate check

---

## Error Tracking Šablona

Pokud narazíš na recurring bug pattern, zdokumentuj ho:

```markdown
<!-- docs/known-issues/safeParse-silent-drop.md -->

## Problém: safeParse tiše zahazuje nevalidní položky

**Symptom:** Hook vrací [] nebo méně položek než očekáváno.

**Příčina:** `parseRpcArraySafe()` používá `safeParse` — nevalidní položky tichě vypadnou.

**Detekce:**
- Test s nevalidními daty → hook vrátí []
- Přidej console.warn v dev modu: `if (import.meta.env.DEV) console.warn(...)`

**Prevence:**
- Po KAŽDÉ změně Zod schématu okamžitě spustit test hooku
- Test musí ověřit KONKRÉTNÍ shape dat, ne jen truthy existenci

**Kde se to může stát:**
- Každý hook používající parseRpcArraySafe nebo z.array().safeParse
```

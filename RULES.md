# RULES.md — Pravidla projektu Platform

> **Verze:** 2.0 | **Datum:** 18. ledna 2026

Produkční aplikace s reálnými citlivými daty. Tento dokument definuje pravidla, která zajišťují bezpečnost, konzistenci a kvalitu kódu.

---

## 🎯 Proč tato pravidla existují

Tato aplikace zpracovává **sensitive data** — citlivá zdravotní data skutečných lidí. Každé pravidlo zde má konkrétní důvod:

| Pravidlo | Důvod |
|----------|-------|
| RPC-only pro sensitive data | Audit trail pro compliance |
| Žádné sensitive data v logách | Ochrana soukromí pacientů |
| i18n pro všechny texty | Multijazyčná aplikace, konzistentní UX |
| Explicitní sloupce | Minimalizace dat, rychlejší queries |
| TypeScript strict | Prevence runtime chyb |

**Pravidla nejsou omezení — jsou návod jak stavět kvalitní production software.**

---

## 📋 Obsah

1. [Tech Stack](#-tech-stack)
2. [Coding Style](#-coding-style)
3. [Architektura](#-architektura)
4. [Data Access](#-data-access)
5. [Bezpečnost a sensitive data](#-bezpečnost-a-citlivá-data)
6. [Error Handling](#-error-handling)
7. [Internacionalizace](#-internacionalizace)
8. [Testování](#-testování)
9. [SQL a Migrace](#-sql-a-migrace)
10. [Definition of Done](#-definition-of-done)
11. [Externí dokumentace](#-externí-dokumentace)

---

## 🏗️ Tech Stack

| Vrstva | Technologie | Dokumentace |
|--------|-------------|-------------|
| **Frontend** | React 18 + TypeScript 5 + Vite | [React Docs](https://react.dev) |
| **Routing** | react-router-dom v6 | [React Router](https://reactrouter.com) |
| **Data Fetching** | @tanstack/react-query v5 | [TanStack Query](https://tanstack.com/query) |
| **Backend** | Supabase (Postgres + RPC + Edge Functions) | [Supabase Docs](https://supabase.com/docs) |
| **Styling** | Tailwind CSS + shadcn/ui | [Tailwind](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| **i18n** | react-i18next | [i18next](https://www.i18next.com) |
| **Testing** | Vitest + React Testing Library | [Vitest](https://vitest.dev) |
| **Validation** | Zod | [Zod Docs](https://zod.dev) |

---

## 🎨 Coding Style

### Formátování

| Nastavení | Hodnota |
|-----------|---------|
| Indentace | 2 mezery |
| Středníky | Ano |
| Uvozovky | Dvojité pro JSX, jednoduché pro JS/TS |
| Trailing comma | ES5 (objekty, pole) |
| Max délka řádku | 100 znaků (soft limit) |
| Prázdné řádky | 1 mezi sekcemi, 0 na konci souboru |

### Naming Conventions

| Typ | Konvence | Příklad | Důvod |
|-----|----------|---------|-------|
| Komponenty | PascalCase | `HealthCheckInForm.tsx` | React standard |
| Hooks | camelCase + use | `useHealthTracking.ts` | React konvence |
| Utility funkce | camelCase | `formatDate.ts` | JS standard |
| Konstanty | SCREAMING_SNAKE | `MAX_PAIN_LEVEL` | Vizuálně odlišitelné |
| TypeScript typy | PascalCase | `HealthCheckIn` | TS konvence |
| SQL funkce | snake_case | `get_my_check_ins_audited` | PostgreSQL standard |
| DB tabulky | snake_case (plurál) | `health_check_ins` | PostgreSQL standard |
| i18n klíče | dot.notation | `health.painLevel` | Hierarchická struktura |

### Import Order

```typescript
// 1. React a React-related
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

// 2. Externí knihovny
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// 3. Interní absolutní importy (@/)
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

// 4. Relativní importy
import { CheckInForm } from "./CheckInForm";

// 5. Typy (vždy na konci, type-only import)
import type { HealthCheckIn } from "@/types";
```

### TypeScript Preferences

```typescript
// ✅ PREFEROVÁNO: Explicitní typy pro funkce
function getCheckIn(id: string): Promise<HealthCheckIn | null> {
  // ...
}

// ✅ PREFEROVÁNO: Interface pro objekty
interface HealthCheckInProps {
  data: HealthCheckIn;
  onSubmit: (data: HealthCheckIn) => void;
}

// ✅ PREFEROVÁNO: Type pro unions a utility types
type Status = "pending" | "completed" | "cancelled";
type PartialCheckIn = Partial<HealthCheckIn>;

// ✅ PREFEROVÁNO: unknown místo any
function processData(input: unknown) {
  const validated = schema.parse(input); // Validuj pomocí Zod
}

// ✅ PREFEROVÁNO: Nullish coalescing
const name = user?.name ?? "Anonymous";

// ❌ VYHÝBEJ SE: any typ
const data: any = response; // Proč: Ztráta type safety

// ❌ VYHÝBEJ SE: Type assertions bez validace
const user = data as User; // Proč: Runtime může selhat
```

### React Preferences

```typescript
// ✅ PREFEROVÁNO: Funkční komponenty
function HealthCard({ data }: Props) {
  return <div>{data.name}</div>;
}

// ✅ PREFEROVÁNO: Destructuring props
function HealthCard({ data, onSubmit }: Props) { ... }

// ✅ PREFEROVÁNO: Named exports
export function HealthCard() { ... }

// ✅ PREFEROVÁNO: Early returns pro loading/error states
function HealthDashboard() {
  const { data, isLoading, error } = useHealthData();
  
  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <EmptyState />;
  
  return <Dashboard data={data} />;
}

// ❌ VYHÝBEJ SE: Inline funkce v JSX (performance)
<Button onClick={() => handleClick(item.id)} /> // Vytváří novou referenci

// ✅ PREFEROVÁNO: useCallback pro event handlery
const handleClick = useCallback((id: string) => { ... }, []);
<Button onClick={() => handleClick(item.id)} />
```

---

## 📐 Architektura

### Vrstvy aplikace

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Komponenty (src/components/, src/pages/)                    │
│  Odpovědnost: Pouze renderování UI                             │
│  Pravidlo: Nevolají Supabase přímo                             │
├─────────────────────────────────────────────────────────────────┤
│  React Hooks (src/hooks/)                                       │
│  Odpovědnost: Business logika, data fetching                   │
│  Pravidlo: Používají React Query pro server state              │
├─────────────────────────────────────────────────────────────────┤
│  Integrace (src/integrations/)                                  │
│  Odpovědnost: Supabase client, Edge Functions, API wrappery    │
│  Pravidlo: Zod validace odpovědí                               │
├─────────────────────────────────────────────────────────────────┤
│  Supabase Backend                                               │
│  Odpovědnost: RPC funkce, RLS policies, Edge Functions         │
│  Pravidlo: Authorization a audit v každé RPC funkci            │
└─────────────────────────────────────────────────────────────────┘
```

### Proč tato architektura?

- **Separation of concerns** — Každá vrstva má jasnou odpovědnost
- **Testovatelnost** — Hooky lze testovat nezávisle na UI
- **Reusability** — Hooky lze sdílet mezi komponentami
- **Auditovatelnost** — Veškerý data access prochází přes RPC s audit logem

### Příklad správné struktury

```typescript
// src/pages/health/Dashboard.tsx — UI vrstva
function HealthDashboard() {
  const { checkIns, isLoading } = useHealthTracking(); // Hook pro data
  const { t } = useTranslation(); // i18n
  
  if (isLoading) return <LoadingSkeleton />;
  
  return (
    <div>
      <h1>{t("health.dashboard.title")}</h1>
      <CheckInList data={checkIns} />
    </div>
  );
}

// src/hooks/useHealthTracking.ts — Business logika
export function useHealthTracking() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ["health-check-ins", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_my_health_check_ins_audited",
        { p_limit: 50 }
      );
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });
}
```

---

## 🗄️ Data Access

### RPC-Only Pattern pro sensitive data

**Proč:** Každý přístup k citlivým datům musí být auditován pro compliance.

```typescript
// ✅ SPRÁVNĚ: RPC s auditem
const { data } = await supabase.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});
// Proč: RPC funkce automaticky zapisuje do audit_journal

// ❌ VYHÝBEJ SE: Přímý dotaz na sensitive data tabulku
const { data } = await supabase.from("health_check_ins").select("*");
// Proč: Žádný audit trail, porušení compliance
```

### Explicitní sloupce

**Proč:** Minimalizace přenesených dat, rychlejší queries, menší riziko úniku dat.

```typescript
// ✅ SPRÁVNĚ: Explicitní výčet sloupců
const { data } = await supabase
  .from("products")
  .select("id, name, price, is_active");

// ❌ VYHÝBEJ SE: Select all
const { data } = await supabase.from("products").select("*");
// Proč: Overfetch, pomalejší, může vrátit citlivá data
```

### React Query Best Practices

```typescript
// Konzistentní queryKey struktura
const { data } = useQuery({
  queryKey: ["domain", userId, { limit, offset, filters }],
  queryFn: fetchFn,
  staleTime: 5 * 60 * 1000, // 5 minut
  enabled: !!userId, // Podmíněné spuštění
});

// Cílená invalidace
queryClient.invalidateQueries({ 
  queryKey: ["domain", userId] 
});
// Proč: Neinvaliduje queries jiných uživatelů
```

---

## 🔐 Bezpečnost a sensitive data

### Co je sensitive data

| Kategorie | Příklady |
|-----------|----------|
| Identifikátory | Jména, emaily, adresy, telefonní čísla |
| Zdravotní data | Diagnózy, měření, medications, laboratorní výsledky |
| Demografické | Data narození, SSN, čísla pojištění |
| Technické | IP adresy, session tokeny, device IDs |

### sensitive data Mode

Aplikace má koncept **sensitive data mode** — speciální režim pro práci s citlivými daty:
- In-memory session (žádná persistence do localStorage)
- Automatický timeout
- Vyžaduje re-autentizaci

### Bezpečné logování

**Proč:** Logy mohou být přístupné třetím stranám (monitoring, debugging). sensitive data v logách = porušení compliance.

```typescript
import { safeError, safeInfo, safeWarn } from "@/lib/security/safeLogger";

// ✅ SPRÁVNĚ: Pouze IDs a metadata
safeInfo("health.checkIn.created", { userId: user.id, recordId: record.id });
safeError("health.checkIn.failed", error);

// ❌ VYHÝBEJ SE: sensitive data v logách
console.log(`User ${email} submitted pain level ${painLevel}`);
// Proč: Email je PII, pain level je sensitive data
```

### Error Messages

**Proč:** Backend error messages mohou obsahovat identifikátory tabulek, sloupců, nebo dokonce data.

```typescript
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";

// ✅ SPRÁVNĚ: Mapovaná, bezpečná zpráva
toast({
  description: t(getUserFacingDataErrorMessage(error)),
});

// ❌ VYHÝBEJ SE: Raw error message
toast({ description: error.message });
// Proč: Může obsahovat "Table health_check_ins..." nebo podobné
```

---

## 🔄 Error Handling

### Pattern pro error handling

```typescript
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";

async function submitCheckIn(data: CheckInData) {
  try {
    const { error } = await supabase.rpc("submit_check_in", data);
    if (error) throw error;
    
    toast({ description: t("success.checkInSaved") });
  } catch (error) {
    // 1. Loguj bezpečně (pouze v dev)
    safeError("health.submitCheckIn.failed", error);
    
    // 2. Zobraz uživateli přes i18n
    toast({
      title: t("errors.title"),
      description: t(getUserFacingDataErrorMessage(error)),
      variant: "destructive",
    });
  }
}
```

### Pravidla

1. **Vždy chytej errory** — Unhandled promise rejections jsou špatná UX
2. **Loguj přes safeLogger** — Nikdy přímo `console.*`
3. **Mapuj na i18n klíče** — Konzistentní, přeložitelné zprávy
4. **Fail-fast kde je to bezpečné** — Prázdný seznam může být misleading

---

## 🌐 Internacionalizace

### Proč i18n všude?

- Aplikace je multijazyčná (CS, EN, DE, FR, RU, TH)
- Konzistentní UX across languages
- Jednodušší úpravy textů (centralizované)

### Pattern

```typescript
const { t } = useTranslation();

// ✅ SPRÁVNĚ: Vše přes t()
<Button>{t("common.save")}</Button>
<p>{t("health.painLevel")}</p>
toast({ description: t("success.saved") });

// ❌ VYHÝBEJ SE: Hardcoded stringy
<Button>Save</Button>
// Proč: Nefunguje pro jiné jazyky, nekonzistentní
```

### Žádné fallbacky

```typescript
// ❌ VYHÝBEJ SE: Hardcoded fallback
t("key", "Fallback text");
t("key", { defaultValue: "Fallback" });
// Proč: Maskuje chybějící překlady, vytváří tech debt

// ✅ SPRÁVNĚ: Přidej chybějící klíč do překladů
t("key");
```

### Přidání nového textu

1. Přidej klíč do `src/i18n/segments/en/*.json`
2. Přidej překlad do `src/i18n/segments/cs/*.json`
3. Spusť `npm run i18n:check` pro validaci

---

## 🧪 Testování

### Validace před změnami

```bash
npm run test:run && npm run build
```

**Toto musí projít před každým push.** Žádné výjimky.

### Efektivní testování

```bash
# Při práci na konkrétním hooku — spouštěj jen relevantní testy
npm run test:run -- src/tests/hooks/useHealthTracking.test.ts

# Před finálním push — všechny testy
npm run test:run
```

### Mock pattern

```typescript
// Mock MUSÍ odpovídat skutečné implementaci
// Před psaním testu zkontroluj jak hook volá Supabase:
// grep -n "supabase\." src/hooks/useMyHook.ts

vi.mocked(supabase.rpc).mockResolvedValue({
  data: mockData,
  error: null,
});
```

---

## 🗃️ SQL a Migrace

### Každá tabulka = RLS

**Proč:** Row Level Security zajišťuje, že uživatel vidí pouze svá data, i když frontend udělá chybu.

```sql
CREATE TABLE public.new_table (...);
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data" ON public.new_table
  FOR SELECT USING (auth.uid() = user_id);
```

### RPC funkce pattern

```sql
CREATE OR REPLACE FUNCTION public.get_my_data_audited(p_limit integer DEFAULT 50)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public  -- Povinné pro SECURITY DEFINER
AS $$
BEGIN
  -- 1. Auth check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- 2. Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'SENSITIVE_DATA_READ', jsonb_build_object('limit', p_limit));
  
  -- 3. Return data (explicitní sloupce)
  RETURN QUERY 
  SELECT id, check_in_date, pain_level  -- Ne SELECT *
  FROM health_check_ins 
  WHERE user_id = auth.uid() 
  LIMIT p_limit;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_data_audited FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_data_audited TO authenticated;
```

---

## ✅ Definition of Done

Každá změna MUSÍ splňovat:

| Kritérium | Jak ověřit |
|-----------|------------|
| Testy prochází | `npm run test:run` |
| Build prochází | `npm run build` |
| RPC-only pro sensitive data | Žádné `.from()` na sensitive data tabulky |
| Explicitní sloupce | Žádné `.select("*")` |
| Žádné sensitive data v logách | Pouze `safeLogger`, žádný `console.*` |
| i18n pro UI texty | Žádné hardcoded stringy |
| RLS na nových tabulkách | `ENABLE ROW LEVEL SECURITY` |
| TypeScript strict | Žádné `any` typy |

---

## 📚 Externí dokumentace

### Projektová dokumentace

| Dokument | Popis |
|----------|-------|
| [AGENTS.md](AGENTS.md) | Kompendium pro AI agenty |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Jak přispívat do projektu |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Detailní architektura |
| [docs/DEVELOPMENT_GUIDELINES.md](docs/DEVELOPMENT_GUIDELINES.md) | Vývojové standardy |
| [docs/security/SECURITY.md](docs/security/SECURITY.md) | Bezpečnostní patterns |

### Standardy a compliance

| Standard | Relevance |
|----------|-----------|
| [compliance](https://www.hhs.gov/compliance) | sensitive data protection, audit requirements |
| [OWASP Top 10](https://owasp.org/Top10/) | Web application security |
| [SOC 2](https://www.aicpa.org/soc) | Security, availability, processing integrity |

### Technologie

| Technologie | Dokumentace |
|-------------|-------------|
| React | [react.dev](https://react.dev) |
| TypeScript | [typescriptlang.org](https://www.typescriptlang.org/docs/) |
| Supabase | [supabase.com/docs](https://supabase.com/docs) |
| TanStack Query | [tanstack.com/query](https://tanstack.com/query) |
| Tailwind CSS | [tailwindcss.com](https://tailwindcss.com) |
| Vitest | [vitest.dev](https://vitest.dev) |
| Zod | [zod.dev](https://zod.dev) |

---

## 🤖 Pro automatizovaný vývoj (LLMs)

### Principy designu

Při každé změně přemýšlej o:

1. **Auditovatelnost** — Lze sledovat kdo, kdy, co udělal?
2. **Bezpečnost by default** — Je to bezpečné i když frontend udělá chybu?
3. **Minimalizace dat** — Získávám pouze to, co potřebuji?
4. **Konzistence** — Odpovídá to existujícím patterns v codebase?

### Review checklist

Při každé změně ověř:

| Kontrola | Otázka |
|----------|--------|
| Data access | Neobjevila se `.from()` cesta k sensitive data? |
| Logging | Nepřibyly `console.*` s citlivými daty? |
| i18n | Nepřibyly hardcoded stringy v UI? |
| Types | Nepřibyly `any` typy? |
| Select | Nepřibyly `.select("*")` nebo prázdné `.select()`? |
| Errors | Nezobrazuje se `error.message` uživateli? |
| RLS | Mají nové tabulky RLS policies? |

### Commit messages

```bash
# Formát: type(scope): description

feat(health): add pain level tracking with audit
fix(auth): handle session timeout gracefully
refactor(hooks): extract common data fetching logic
docs(rules): update coding style section
```

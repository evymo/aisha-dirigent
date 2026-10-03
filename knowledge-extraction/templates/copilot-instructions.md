# Copilot Instructions — [NÁZEV PROJEKTU]

> **DŮLEŽITÉ:** Zkopíruj tento soubor do `.github/copilot-instructions.md` a doplň projekt-specifické sekce.  
> Části označené `[DOPLNIT]` musí být aktualizovány pro konkrétní projekt.

---

## 🎯 Projekt

[DOPLNIT: Stručný popis projektu, jeho účel a doménu]

**Technologický stack:**
- React + TypeScript + Vite
- TanStack Query (React Query) pro server state
- Zod pro validaci
- i18next pro překlady
- Vitest pro unit testy
- Playwright pro E2E

**API backend:** [DOPLNIT: Typ API — REST / GraphQL / Supabase RPC / jiné]  
**Autentizace:** [DOPLNIT: JWT / Supabase Auth / Auth0 / jiné]

---

## ⚠️ Absolutní Pravidla (porušení = odmítnutí)

### 1. Vše přes Hooky — žádné přímé API volání z komponent

```typescript
// ✅ SPRÁVNĚ
const { data } = useProducts();

// ❌ ZAKÁZÁNO
useEffect(() => { fetch("/api/products").then(...) }, []);
```

### 2. Žádné `any` Typy

```typescript
// ✅ SPRÁVNĚ
const result: Product = productSchema.parse(raw);

// ❌ ZAKÁZÁNO
const data: any = response;
```

### 3. Zod Validace Externích Dat

```typescript
// Každá API odpověď musí projít schématem
const validated = mySchema.parse(apiResponse.data);
```

### 4. i18n pro Veškerý UI Text

```typescript
// ✅ SPRÁVNĚ
const { t } = useTranslation();
<span>{t("common.save")}</span>

// ❌ ZAKÁZÁNO
<span>Save</span>
<span>Uložit</span>
```

### 5. Žádné `console.log` v Produkčním Kódu

### 6. Žádné Emoji v UI (použij icon library)

### 7. Parametry Functions Abecedně Řazeny

---

## 🏗️ Struktura Projektu

```
src/
├── components/       # UI komponenty (PascalCase)
│   ├── ui/           # Sdílené UI primitiva
│   └── [domain]/     # Doménové komponenty
├── hooks/            # Custom hooky (camelCase + use prefix)
│   └── index.ts      # Barrel export
├── lib/
│   ├── schemas/      # Zod schémata
│   ├── security/     # safeLogger, userFacingErrors
│   └── utils/        # Pomocné funkce
├── pages/            # Route-level komponenty
├── i18n/
│   ├── segments/     # Zdrojové překlady (en/, cs/, ...)
│   └── locales/      # Generované (en.json, cs.json, ...)
└── tests/
    ├── hooks/        # Unit testy hooků
    ├── gates/        # Gate testy (hygiene, security, architecture)
    ├── components/   # Component testy
    └── mocks/        # Sdílené mocky
```

---

## 🔗 API Komunikace

[DOPLNIT: Jak se projekt připojuje k API]

### Šablona hooku pro GET data

```typescript
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "./useSession";
import { apiClient } from "@/lib/api/client";
import { safeError } from "@/lib/security/safeLogger";

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  // ... další pole
});

type Item = z.infer<typeof itemSchema>;

export function useItems(options: { enabled?: boolean; limit?: number } = {}) {
  const { enabled = true, limit = 20 } = options;
  const { user } = useSession();

  return useQuery({
    queryKey: ["items", { limit, userId: user?.id }],
    queryFn: async () => {
      const response = await apiClient.get("/items", { params: { limit } });
      return itemSchema.array().parse(response.data);
    },
    enabled: enabled && !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minut
    retry: (failureCount, error) => {
      // Neretry na 401/403
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        return false;
      }
      return failureCount < 3;
    },
    meta: {
      errorMessage: "items.loadError", // i18n klíč pro error message
    },
  });
}
```

### Šablona hooku pro Mutace (POST/PUT/DELETE)

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateItemInput) => {
      const validated = createItemSchema.parse(input); // Zod před odesláním
      const response = await apiClient.post("/items", validated);
      return itemSchema.parse(response.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => {
      console.error("Create item failed:", safeError(error)); // bez sensitive data
    },
  });
}
```

---

## 🧪 Testování

### Pořadí akcí při změně hooku:

1. Přečti implementaci hooku
2. Zkontroluj existující test (`src/tests/hooks/`)
3. Uprav/doplň test tak, aby mock odpovídal skutečnému volání
4. Spusť POUZE relevantní test: `npm run test:run -- src/tests/hooks/useMujHook.test.ts`
5. Ověř build: `npm run build`

### Šablona testu hooku:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createTestWrapper } from "@/tests/utils/testWrapper";
import { useItems } from "@/hooks/useItems";

// Mock API client — musí odpovídat PŘESNĚ tomu, jak hook volá API
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

// Mock session
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "test-user-id" } }),
}));

describe("useItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validated items from API", async () => {
    const mockData = [{ id: "1", name: "Item A" }];
    vi.mocked(apiClient.get).mockResolvedValue({ data: mockData });

    const { result } = renderHook(() => useItems(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
  });

  it("handles API error safely — no sensitive data in error", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useItems(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Ověř, že error message neobsahuje citlivá data
  });
});
```

---

## 🔐 Bezpečnost a Logging

### Co NIKDY nelogovat:

- Emaily, jména, adresy
- Zdravotní nebo citlivá data
- Session tokeny, hesla, API klíče
- Obsah zpráv/poznámek

### Co logovat:

- IDs (user_id, record_id)
- Typy akcí (action_type)
- Metadata (limit, offset, count)
- Timestamps

### Bezpečný error log:

```typescript
import { safeError } from "@/lib/security/safeLogger";

// ✅ SPRÁVNĚ
console.error("Operation failed:", safeError(error));

// ❌ ŠPATNĚ — může obsahovat email, stack trace s daty apod.
console.error("Failed for:", user.email, error);
```

---

## 🌍 i18n Pravidla

- Všechny texty v `src/i18n/segments/{lang}/*.json`
- EN je kanonická sada klíčů
- Spusť `npm run i18n:check` před PR
- Žádné hardcoded fallbacky: `t("key", "Fallback")` — **ZAKÁZÁNO**

---

## 📝 Naming Conventions

| Typ | Konvence | Příklad |
|-----|----------|---------|
| Komponenty | PascalCase | `ProductCard.tsx` |
| Hooky | camelCase + `use` | `useProducts.ts` |
| Schémata (Zod) | camelCase + `Schema` | `productSchema` |
| Typy | PascalCase | `Product`, `CreateProductInput` |
| Utility funkce | camelCase | `formatPrice.ts` |
| Konstanty | SCREAMING_SNAKE_CASE | `MAX_ITEMS_PER_PAGE` |
| API endpointy | kebab-case | `/api/product-categories` |

---

## 📋 Import Pořadí

```typescript
// 1. React
import { useState, useCallback } from "react";

// 2. Externí knihovny
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// 3. Interní absolutní (@/)
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/useSession";

// 4. Relativní
import { MyComponent } from "./MyComponent";

// 5. Typy (oddělené)
import type { Product } from "@/lib/schemas/product";
```

---

## ✅ PR Checklist

- [ ] `npm run test:run` — 100% passing
- [ ] `npm run build` — úspěšný
- [ ] `npx tsc --noEmit` — žádné TypeScript chyby
- [ ] `npm run lint` — žádné ESLint chyby
- [ ] `npm run i18n:check` — překlady kompletní
- [ ] Žádné hardcoded texty v JSX
- [ ] Žádné `any` typy
- [ ] Žádné `console.log` v produkčním kódu
- [ ] Žádné emoji v UI
- [ ] Každý nový hook má test
- [ ] Zod schéma pro každý API response typ
- [ ] Error handling bez sensitive data/citlivých dat

---

## 🚀 NPM Skripty Reference

```bash
npm run dev              # Dev server
npm run build            # Produkční build
npm run test:run         # Všechny unit testy
npm run test:run -- <cesta>  # Konkrétní test
npm run test:gates       # Gate testy (hygiene, security, architecture)
npm run lint             # ESLint
npm run i18n:check       # Kontrola překladů
npx tsc --noEmit         # TypeScript bez emitu
```

---

## 🔧 Práce s Databází [DOPLNIT nebo Smazat]

[DOPLNIT pokud projekt používá Supabase / přímý DB přístup,  
jinak tuto sekci smazat — u čistě REST API projektu není potřeba]


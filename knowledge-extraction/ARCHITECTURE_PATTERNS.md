# Architektura Projektu — Vrstvy a Odpovědnosti

---

## Mentální Model

```
┌─────────────────────────────────────┐
│           PAGES / ROUTES            │  ← Routing, layout, page-level auth
├─────────────────────────────────────┤
│           KOMPONENTY                │  ← UI, render, user interactions
├─────────────────────────────────────┤
│           CUSTOM HOOKY              │  ← Server state, business logic
├─────────────────────────────────────┤
│           API CLIENT                │  ← HTTP komunikace, auth headers
├─────────────────────────────────────┤
│           BACKEND API               │  ← Existující API (nemodifikujeme)
└─────────────────────────────────────┘
```

**Pravidlo odpovědnosti:**

| Vrstva | Smí | Nesmí |
|--------|-----|-------|
| Komponenta | Volat hooky, render JSX, UI events | Volat API přímo, business logic |
| Hook | Volat API klienta, validovat data, transformovat | Renderovat JSX, znát routy |
| API Client | HTTP requesty, auth hlavičky, error normalizace | Business logic, stav aplikace |

---

## Struktura Adresářů

```
src/
├── components/
│   ├── ui/               # Shadcn/Radix primitiva (Button, Input, Card...)
│   ├── layout/           # Header, Footer, Sidebar, Navigation
│   ├── [domain]/         # Doménové komponenty (products/, checkout/, ...)
│   └── shared/           # Sdílené cross-domain komponenty
│
├── hooks/
│   ├── index.ts          # Barrel export — vždy doplnit
│   ├── useSession.ts     # Auth / session
│   ├── usePermissions.ts # Dynamické oprávnění
│   └── use[Feature].ts   # Feature hooky
│
├── lib/
│   ├── api/
│   │   ├── client.ts     # Axios instance, interceptory
│   │   └── endpoints.ts  # Konstanty URL endpointů
│   ├── schemas/          # Zod schémata (jeden soubor per doménový objekt)
│   ├── security/
│   │   ├── safeLogger.ts      # Bezpečný logger bez sensitive data
│   │   └── userFacingErrors.ts # User-friendly error zprávy (i18n)
│   └── utils/            # Čisté utility funkce (bez side effects)
│
├── pages/                # Route-level komponenty (= "screens")
│   └── [route]/
│       └── index.tsx
│
├── i18n/
│   ├── segments/         # Zdrojové soubory (en/, cs/, de/, ...)
│   │   ├── en/
│   │   │   ├── common.json
│   │   │   ├── auth.json
│   │   │   └── [domain].json
│   │   └── cs/
│   │       └── ...
│   └── locales/          # Generované (spouštět ne ručně, ale přes skripty)
│
└── tests/
    ├── hooks/            # Unit testy hooků
    ├── components/       # Component testy
    ├── gates/            # Gate testy (statická analýza)
    ├── mocks/            # Sdílené mock factory
    │   ├── server.ts     # MSW mock server (optional)
    │   └── factories/    # Mock data factory functions
    └── utils/
        └── testWrapper.tsx  # QueryClient + Provider wrapper pro testy
```

---

## Doménové Rozdělení

Projekt se dělí na **domény** (feature areas). Každá doména má:
- Komponentu(y) v `src/components/[domain]/`
- Hook(y) v `src/hooks/use[Domain]*.ts`
- Zod schéma v `src/lib/schemas/[domain].ts`
- Testy v `src/tests/hooks/use[Domain]*.test.ts`

### Příklad domény "products":

```
src/
├── components/products/
│   ├── ProductCard.tsx
│   ├── ProductList.tsx
│   └── ProductDetail.tsx
├── hooks/
│   ├── useProducts.ts        # GET /api/products (list + search)
│   ├── useProduct.ts         # GET /api/products/:id
│   └── useCreateProduct.ts   # POST /api/products (admin)
├── lib/schemas/
│   └── product.ts            # productSchema, createProductSchema
└── tests/hooks/
    ├── useProducts.test.ts
    └── useProduct.test.ts
```

---

## Pravidla pro Komponenty

### Velikost

```
< 200 řádků  → Ideální
200-400      → Akceptovatelné
400-500      → Zvážit rozdělení
> 500        → POVINNÉ rozdělení
```

### Komponenta X Hook — Co Kam:

```typescript
// ✅ DO KOMPONENTY (UI logika):
const [isOpen, setIsOpen] = useState(false);         // lokální UI stav
const handleClick = () => setIsOpen(true);            // UI event handler
const formattedPrice = `${price.toFixed(2)} Kč`;     // prezentační formát

// ✅ DO HOOKU (business/data logika):
const { data, isLoading } = useProducts();            // server stav
const { mutate: createProduct } = useCreateProduct(); // mutace
const filteredItems = items.filter(applySearchFilter); // data transformation
```

### Typický pattern komponenty:

```tsx
// src/components/products/ProductList.tsx
import { useTranslation } from "react-i18next";
import { useProducts } from "@/hooks/useProducts";
import { ProductCard } from "./ProductCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

export function ProductList() {
  const { t } = useTranslation();
  const { data: products, isLoading, isError } = useProducts();

  if (isLoading) return <LoadingSpinner />;
  if (isError) return <ErrorMessage message={t("products.loadError")} />;
  if (!products?.length) return <p>{t("products.empty")}</p>;

  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

---

## API Client Setup

```typescript
// src/lib/api/client.ts
import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 10_000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor — přidá auth header
apiClient.interceptors.request.use((config) => {
  const token = getAuthToken(); // z session store
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — normalizuje chyby
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Normalizuj chybu na ApiError
    throw new ApiError(
      error.response?.status ?? 0,
      error.response?.data?.message ?? "unknown_error"
    );
  }
);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`API Error ${status}: ${code}`);
  }
}
```

---

## Sdílené Utility

### `safeError` — bezpečný log chyb:

```typescript
// src/lib/security/safeLogger.ts
export function safeError(error: unknown): string {
  if (error instanceof ApiError) {
    // Vrátí kód chyby, ale ne uživatelská data z response body
    return `ApiError(${error.status}, ${error.code})`;
  }
  if (error instanceof Error) {
    return error.message; // Jen technická message, bez dat
  }
  return "unknown_error";
}
```

### `getUserFacingErrorMessage` — uživatelsky přátelská zpráva:

```typescript
// src/lib/security/userFacingErrors.ts
export function getUserFacingErrorMessage(
  error: unknown,
  t: (key: string) => string
): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return t("errors.notFound");
    if (error.status === 403) return t("errors.forbidden");
    if (error.status === 429) return t("errors.tooManyRequests");
    if (error.status >= 500) return t("errors.serverError");
  }
  return t("errors.generic");
}
```

---

## Permissions — Dynamické, Nikdy Hardcoded

```typescript
// src/hooks/usePermissions.ts
export function usePermissions() {
  const { data: permissions } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiClient.get("/me/permissions").then(r => r.data),
    staleTime: 10 * 60 * 1000, // 10 minut
  });

  return {
    hasPermission: (code: string) => permissions?.includes(code) ?? false,
    permissions: permissions ?? [],
  };
}

// Použití:
const { hasPermission } = usePermissions();
if (hasPermission("products:write")) {
  // zobraz tlačítko Edit
}
```

---

## React Query Konfigurace

```typescript
// src/lib/reactQuery/queryClient.ts
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 minut
      gcTime: 10 * 60 * 1000,      // 10 minut
      retry: (failureCount, error) => {
        // Neretry na auth chyby
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          return false;
        }
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,   // Vypnout v produkci, zapnout po potřebě
    },
    mutations: {
      retry: 0, // Mutace se neretryují automaticky
    },
  },
});
```

---

## Naming Conventions

| Typ | Konvence | Příklady |
|-----|----------|---------|
| Komponenty | PascalCase | `ProductCard`, `CheckoutSummary` |
| Hooky | `use` + PascalCase | `useProducts`, `useCreateOrder` |
| Zod schémata | camelCase + `Schema` | `productSchema`, `createOrderSchema` |
| TypeScript typy | PascalCase | `Product`, `CreateOrderInput` |
| Utility funkce | camelCase | `formatPrice`, `parseDate` |
| Konstanty | SCREAMING_SNAKE_CASE | `MAX_CART_ITEMS`, `API_TIMEOUT_MS` |
| Testy | stejný název + `.test.ts(x)` | `useProducts.test.ts` |
| Gate testy | popis + `.gate.test.ts` | `code-hygiene.gate.test.ts` |
| i18n klíče | `domain.camelCase` | `products.outOfStock`, `common.save` |

---

## Co Nesmí Existovat v Produkčním Kódu

```typescript
// ❌ ZAKÁZÁNO:
console.log(...)          // → safeError + console.error
fetch(...)                // ve komponentě → přesunout do hooku
const x: any = ...        // → proper typ nebo unknown + guard
t("key", "fallback")      // → t("key") bez fallbacku
<span>😀</span>           // → <SmileIcon />
if (role === "admin")     // → hasPermission("xxx")
// @ts-ignore             // → @ts-expect-error s komentářem
TODO: fix this            // → vyřeš hned nebo vytvoř tracked issue
```

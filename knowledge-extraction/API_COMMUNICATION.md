# API Komunikace — Frontend-Only Pattern

> Tato aplikace **NEPROGRAMUJE** backend API. Pouze konzumuje existující API.  
> Veškerá komunikace probíhá výhradně přes custom React hooky.

---

## Zlaté Pravidlo

```
Komponenta → Hook → API Client → Backend API
     ↑_______________|
     (data zpět jako React Query state)
```

**Komponenta NIKDY nezná:**
- URL endpoint
- HTTP metodu (GET/POST/...)  
- Parametry requstu
- Formát API odpovědi (raw JSON)
- Validaci dat

**Hook VŽDY zajišťuje:**
- Volání správného endpointu
- Zod validaci odpovědi
- Loading / error / success stav
- Cache invalidace po mutacích

---

## Pattern 1: Query (GET data)

```typescript
// src/hooks/useProducts.ts
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient } from "@/lib/api/client";
import { useSession } from "./useSession";

// ✅ Schema je součástí hooku nebo importována z lib/schemas/
const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  price: z.number().nonnegative(),
  category: z.string(),
  available: z.boolean(),
  imageUrl: z.string().url().nullable(),
});

export type Product = z.infer<typeof productSchema>;

// ✅ Options jsou abecedně seřazeny
export interface UseProductsOptions {
  category?: string;
  enabled?: boolean;
  limit?: number;
  page?: number;
  search?: string;
}

export function useProducts(options: UseProductsOptions = {}) {
  const { category, enabled = true, limit = 20, page = 1, search } = options;
  const { user } = useSession();

  return useQuery({
    queryKey: ["products", { category, limit, page, search }],
    queryFn: async () => {
      const response = await apiClient.get("/products", {
        params: { category, limit, page, search },
      });
      // ✅ Vždy validuj — safeParse pro tiché chyby, parse pro hlasité
      return z.array(productSchema).parse(response.data.items);
    },
    enabled: enabled && !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData, // pro pagination
  });
}
```

---

## Pattern 2: Mutation (POST / PUT / DELETE)

```typescript
// src/hooks/useCreateOrder.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient, ApiError } from "@/lib/api/client";
import { safeError } from "@/lib/security/safeLogger";

const createOrderInputSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })),
  shippingAddressId: z.string().uuid(),
});

const orderResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "shipped", "delivered"]),
  totalAmount: z.number(),
  createdAt: z.string().datetime(),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      // ✅ Validuj INPUT před odesláním
      const validated = createOrderInputSchema.parse(input);
      const response = await apiClient.post("/orders", validated);
      // ✅ Validuj RESPONSE
      return orderResponseSchema.parse(response.data);
    },
    onSuccess: (newOrder) => {
      // ✅ Invaliduj relevantní queries
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["cart"] });
    },
    onError: (error) => {
      // ✅ Bezpečný log — žádná citlivá data
      console.error("Create order failed:", safeError(error));
    },
  });
}
```

---

## Pattern 3: Infinite Query (stránkování / infinite scroll)

```typescript
// src/hooks/useFeedItems.ts
import { useInfiniteQuery } from "@tanstack/react-query";

export function useFeedItems() {
  return useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: async ({ pageParam = null }) => {
      const response = await apiClient.get("/feed", {
        params: { cursor: pageParam, limit: 20 },
      });
      return feedPageSchema.parse(response.data);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null,
  });
}

// V komponentě:
// const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeedItems();
// const allItems = data?.pages.flatMap(p => p.items) ?? [];
```

---

## Pattern 4: Podmíněné Query

```typescript
// Načti data pouze pokud má uživatel oprávnění
export function useAdminStats(options: { enabled?: boolean } = {}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("stats:read");

  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiClient.get("/admin/stats").then(r => statsSchema.parse(r.data)),
    enabled: options.enabled !== false && canView,
  });
}
```

---

## Pattern 5: Optimistic Updates

```typescript
export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: string) =>
      apiClient.post(`/products/${productId}/favorite`),
    
    onMutate: async (productId) => {
      // Zruš pending refetch
      await queryClient.cancelQueries({ queryKey: ["products"] });
      
      // Ulož snapshot pro rollback
      const previous = queryClient.getQueryData(["products"]);
      
      // Optimisticky updatuj UI okamžitě
      queryClient.setQueryData(["products"], (old: Product[] | undefined) =>
        old?.map(p => p.id === productId ? { ...p, isFavorite: !p.isFavorite } : p)
      );
      
      return { previous };
    },
    
    onError: (_, __, context) => {
      // Rollback na snapshot pokud API selhalo
      queryClient.setQueryData(["products"], context?.previous);
    },
    
    onSettled: () => {
      // Vždy revaliduj po dokončení
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
```

---

## Cache Key Konvence

```typescript
// ✅ Konzistentní query keys — objekt pro parametry
queryKey: ["products"]                          // list bez filtrů
queryKey: ["products", { category, limit }]    // list s filtry
queryKey: ["products", productId]              // single item
queryKey: ["admin", "products"]                // admin endpoint
queryKey: ["me", "permissions"]               // user-specific
queryKey: ["orders", userId, orderId]         // hierarchické

// ✅ Pro invalidaci — prefix-based
queryClient.invalidateQueries({ queryKey: ["products"] });
// ^ invaliduje ["products"], ["products", {...}], ["products", "123"] atd.
```

---

## Error Handling Strategie

```typescript
// V hooku:
return useQuery({
  queryKey: ["products"],
  queryFn: async () => {
    try {
      const response = await apiClient.get("/products");
      return productSchema.array().parse(response.data);
    } catch (error) {
      // Transformuj na user-facing error (bez technických detailů)
      if (error instanceof ZodError) {
        console.error("API response validation failed:", error.issues.map(i => i.path));
        throw new Error("invalid_response_format"); // generic, bezpečné
      }
      throw error; // Propaguj ApiError dál → React Query error state
    }
  },
});

// V komponentě:
const { isError, error } = useProducts();
if (isError) {
  const message = getUserFacingErrorMessage(error, t);
  return <ErrorMessage message={message} />;
}
```

---

## API Client — Kompletní Setup

```typescript
// src/lib/api/client.ts
import axios, { type AxiosInstance } from "axios";

// ✅ Typ pro normalizovanou API chybu
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(`${status}: ${code}`);
    this.name = "ApiError";
  }
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 15_000,
    headers: { "Content-Type": "application/json" },
  });

  // Auth interceptor
  client.interceptors.request.use((config) => {
    const token = sessionStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  // Error normalization
  client.interceptors.response.use(
    (res) => res,
    (err) => {
      const status = err.response?.status ?? 0;
      const code = err.response?.data?.error?.code ?? "unknown";
      // ✅ Žádná citlivá data z response body do error objektu
      throw new ApiError(status, code);
    }
  );

  return client;
}

export const apiClient = createApiClient();
```

---

## Supabase RPC Pattern (pokud projekt používá Supabase)

```typescript
// src/hooks/useMyFeatureAudited.ts
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./useSession";
import { parseRpcArraySafe } from "@/lib/utils/rpc";

const resultSchema = z.object({
  id: z.string().uuid(),
  // ... další pole
});

export function useMyFeatureAudited(options: { enabled?: boolean } = {}) {
  const { user } = useSession();

  return useQuery({
    queryKey: ["my-feature", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_feature_audited", {
        p_limit: 30,
      });
      if (error) throw error;
      // ✅ parseRpcArraySafe tiše odfiltruje nevalidní položky
      // ← POZOR: po změně schématu VŽDY spustit test!
      return parseRpcArraySafe(data, resultSchema);
    },
    enabled: options.enabled !== false && !!user?.id,
  });
}
```

---

## Checklist pro Nový Hook

- [ ] Abecedně seřazené options parametry
- [ ] Zod schéma pro response (a pro input u mutací)
- [ ] `enabled: !!user` pokud vyžaduje auth
- [ ] Smysluplný queryKey (s relevantními parametry)
- [ ] `staleTime` nastaven (výchozí z queryClient nebo per-hook)
- [ ] Error logování přes `safeError()` v onError
- [ ] Cache invalidace v onSuccess mutací
- [ ] Export přidán do `src/hooks/index.ts`
- [ ] Test vytvořen v `src/tests/hooks/use[Feature].test.ts`
- [ ] Test spuštěn a prošel: `npm run test:run -- src/tests/hooks/use[Feature].test.ts`

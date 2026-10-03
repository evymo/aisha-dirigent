# Hook Patterns — Návrh, Konvence, Šablony

---

## Anatomie Custom Hooku

```typescript
// src/hooks/useFeatureName.ts

// == IMPORTS ==
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "./useSession";
import { apiClient, ApiError } from "@/lib/api/client";
import { safeError } from "@/lib/security/safeLogger";

// == ZOD SCHÉMA (public — importovatelné v testech) ==
export const featureItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  // ...
});
export type FeatureItem = z.infer<typeof featureItemSchema>;

// == OPTIONS INTERFACE (parametry abecedně) ==
export interface UseFeatureOptions {
  enabled?: boolean;
  filter?: string;
  limit?: number;
  onSuccess?: (data: FeatureItem[]) => void;
}

// == HOOK ==
export function useFeature(options: UseFeatureOptions = {}) {
  const { enabled = true, filter, limit = 20, onSuccess } = options;
  const { user } = useSession();

  return useQuery({
    queryKey: ["feature", { filter, limit }],
    queryFn: async () => {
      const response = await apiClient.get("/feature", { params: { filter, limit } });
      const parsed = featureItemSchema.array().parse(response.data);
      onSuccess?.(parsed);
      return parsed;
    },
    enabled: enabled && !!user,
    staleTime: 5 * 60 * 1000,
  });
}
```

---

## Pravidla Designu Hooků

### 1. Separace dotazů a mutací

```typescript
// ✅ SPRÁVNĚ — oddělené hooky
export function useProducts() { /* GET */ }
export function useCreateProduct() { /* POST */ }
export function useUpdateProduct() { /* PUT */ }
export function useDeleteProduct() { /* DELETE */ }

// ❌ ŠPATNĚ — vše v jednom
export function useProductsManager() {
  const query = useQuery(...);
  const create = useMutation(...);
  const update = useMutation(...);
  // Hook je příliš velký, těžko testutelný
}
```

**Výjimka:** Komplexní flow kde mutace přímo závisí na query datech → pak jeden hook s jasně pojmenovanými returns.

### 2. Query Key Granularita

```typescript
// ✅ SPRÁVNĚ — specifický key s parametry
queryKey: ["products", { category, limit, page }]
// → Různé parametry = různé cache entries

// ❌ ŠPATNĚ — příliš obecný
queryKey: ["products"]
// → Všechna products data sdílí jeden cache záznam
```

### 3. Enabled Podmínky

```typescript
// ✅ SPRÁVNĚ — granulární enabled
enabled: !!user && !!productId && hasPermission("products:read")

// ❌ ŠPATNĚ — boolean jako string
enabled: user !== null && user !== undefined  // totéž jako !!user
```

### 4. Error Handling v Mutacích

```typescript
// ✅ SPRÁVNĚ
return useMutation({
  mutationFn: async (input) => {
    const validated = inputSchema.parse(input); // Zod před odesláním
    return apiClient.post("/endpoint", validated);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["related-data"] });
  },
  onError: (error) => {
    // Loguj bezpečně — ne sensitive data
    console.error("Mutation failed:", safeError(error));
    // NELOGUJ: user email, input data, sensitive data
  },
});
```

---

## Časté Hook Patterns

### Pattern: Resource CRUD

```typescript
// src/hooks/useProducts.ts — READ
// src/hooks/useProduct.ts — READ SINGLE
// src/hooks/useCreateProduct.ts — CREATE
// src/hooks/useUpdateProduct.ts — UPDATE
// src/hooks/useDeleteProduct.ts — DELETE

// Standardní query key hierarchy:
["products"]                  // list
["products", { category }]    // filtered list
["products", "single", id]    // single item
```

### Pattern: Infinite Scroll / Pagination

```typescript
export function useProductsInfinite() {
  return useInfiniteQuery({
    queryKey: ["products", "infinite"],
    queryFn: ({ pageParam = 1 }) =>
      apiClient.get("/products", { params: { page: pageParam, limit: 20 } })
        .then(r => productPageSchema.parse(r.data)),
    getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
    initialPageParam: 1,
  });
}

// V komponentě:
// const { data, fetchNextPage, hasNextPage } = useProductsInfinite();
// const products = data?.pages.flatMap(p => p.items) ?? [];
```

### Pattern: Dependent Query

```typescript
// Načti produkt, pak načti jeho recenze
export function useProductWithReviews(productId: string) {
  const productQuery = useProduct(productId);
  
  const reviewsQuery = useQuery({
    queryKey: ["product-reviews", productId],
    queryFn: () => apiClient.get(`/products/${productId}/reviews`)
      .then(r => reviewSchema.array().parse(r.data)),
    enabled: !!productQuery.data, // pouze pokud produkt existuje
  });

  return {
    product: productQuery.data,
    reviews: reviewsQuery.data ?? [],
    isLoading: productQuery.isLoading || reviewsQuery.isLoading,
    isError: productQuery.isError || reviewsQuery.isError,
  };
}
```

### Pattern: Polling (real-time updates)

```typescript
export function useOrderStatus(orderId: string) {
  return useQuery({
    queryKey: ["order-status", orderId],
    queryFn: () => apiClient.get(`/orders/${orderId}/status`)
      .then(r => orderStatusSchema.parse(r.data)),
    refetchInterval: (query) => {
      // Polluj po 5s dokud objednávka není dokončena
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 5000 : false;
    },
    enabled: !!orderId,
  });
}
```

### Pattern: Prefetch při hover

```typescript
// V komponentě:
const queryClient = useQueryClient();

const handleMouseEnter = useCallback((productId: string) => {
  queryClient.prefetchQuery({
    queryKey: ["products", "single", productId],
    queryFn: () => apiClient.get(`/products/${productId}`).then(r => productSchema.parse(r.data)),
    staleTime: 10 * 60 * 1000,
  });
}, [queryClient]);
```

---

## Co NESMÍ Být v Hooku

```typescript
// ❌ JSX / render logika
export function useProducts() {
  return (
    <div>{/* NIKDY */}</div>
  );
}

// ❌ useNavigate / routing logika (patří do komponenty nebo routeru)
export function useLogin() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: login,
    onSuccess: () => navigate("/dashboard"), // Špatně — hook zná routing
  });
}
// ✅ Správně: komponenta dostane onSuccess callback nebo kontroluje výsledek mutace

// ❌ useState pro server data
export function useProducts() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    fetch("/api/products").then(r => r.json()).then(setProducts);
  }, []);
  return products;
  // → Žádný loading state, žádný error state, žádná cache, žádný retry
}
```

---

## Barrel Export — index.ts

Každý nový hook **musí být přidán** do `src/hooks/index.ts`:

```typescript
// src/hooks/index.ts — abecedně
export { useAuth } from "./useAuth";
export { useCart } from "./useCart";
export { useCreateProduct } from "./useCreateProduct";
export { useDeleteProduct } from "./useDeleteProduct";
export { usePermissions } from "./usePermissions";
export { useProduct } from "./useProduct";
export { useProducts } from "./useProducts";
export { useSession } from "./useSession";
export { useUpdateProduct } from "./useUpdateProduct";
// ... abecedně
```

---

## Hook Naming Convention

| Vzor | Příklad | Kdy |
|------|---------|-----|
| `use[Entity]` | `useProducts` | GET list |
| `use[Entity](id)` | `useProduct("uuid")` | GET single |
| `useCreate[Entity]` | `useCreateProduct` | POST |
| `useUpdate[Entity]` | `useUpdateProduct` | PUT/PATCH |
| `useDelete[Entity]` | `useDeleteProduct` | DELETE |
| `useMy[Entity]` | `useMyOrders` | GET aktuálně přihl. uživatele |
| `useAdmin[Entity]` | `useAdminUsers` | Admin-only endpoint |
| `use[Domain]Session` | `useSecureSession` | Speciální session |
| `useIs[State]` | `useIsAuthenticated` | Boolean check |

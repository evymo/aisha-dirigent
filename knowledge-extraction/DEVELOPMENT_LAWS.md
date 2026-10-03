# Vývojové Zákony — Frontend Projekt

> Toto jsou **absolutní pravidla**. Ne doporučení. Ne "best practices". Zákony.  
> Porušení = odmítnutí PR, blokace buildu, nebo bezpečnostní incident.

---

## ⚖️ Zákon 1: Hook-Only Data Access

**API se volá VÝHRADNĚ z custom hooků. Nikdy přímo z komponenty.**

```typescript
// ✅ SPRÁVNĚ
function MyComponent() {
  const { data, isLoading } = useProducts(); // hook abstrahuje API
  return <ProductList items={data} />;
}

// ❌ ZAKÁZÁNO — přímé volání API z komponenty
function MyComponent() {
  const [data, setData] = useState([]);
  useEffect(() => {
    fetch("/api/products").then(r => r.json()).then(setData); // NIKDY
  }, []);
}
```

**Proč:** Component nezná API kontrakt. Hook je single source of truth pro datovou logiku. Testovatelnost.

---

## ⚖️ Zákon 2: Žádné `any` Typy

**TypeScript strict mode. Žádné `any`, žádné `as any`. `unknown` + type guard pokud nutné.**

```typescript
// ✅ SPRÁVNĚ
function parseResponse(raw: unknown): Product {
  return productSchema.parse(raw); // Zod ověří typ za runtime
}

// ❌ ZAKÁZÁNO
const data: any = response.data;
const parsed = (data as any).products;
```

**Proč:** `any` vypíná TypeScript. Chyby se pak projevují v produkci, ne při vývoji.

---

## ⚖️ Zákon 3: Zod Validace Externích Dat

**Veškerá data přicházející z API MUSÍ projít Zod schématem.**

```typescript
import { z } from "zod";

const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  price: z.number().positive(),
  available: z.boolean(),
});

type Product = z.infer<typeof productSchema>;

// V hooku:
const validated = productSchema.array().parse(rawApiResponse.data);
```

**Proč:** API se mění. Bez validace se špatná data tichce propagují do UI a crashují na neočekávaných místech.

---

## ⚖️ Zákon 4: i18n pro Veškerý UI Text

**Žádný hardcoded text v JSX komponentách. Výjimka: technické hodnoty (ID, kódy).**

```typescript
// ✅ SPRÁVNĚ
const { t } = useTranslation();
<button>{t("common.save")}</button>
<p>{t("products.outOfStock")}</p>

// ❌ ZAKÁZÁNO
<button>Uložit</button>
<button>Save</button>
<p>{available ? "In stock" : "Out of stock"}</p>
```

**Žádné fallbacky:**
```typescript
// ❌ ŠPATNĚ — maskuje chybějící překlad
t("key", "Fallback text")
t("key", { defaultValue: "Default" })
```

---

## ⚖️ Zákon 5: Žádné `console.log` v Produkčním Kódu

**Veškerý debugging přes `console.*` musí být odstraněn před commitem.**

```typescript
// ❌ ZAKÁZÁNO v src/ mimo testy
console.log("Debug:", data);
console.error("Error:", error.message, user.email); // + sensitive data leak!

// ✅ SPRÁVNĚ — chyby přes centrální logger
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error)); // bez sensitive data
```

Gate test automaticky odhalí `console.log` v produkčním kódu a build neprojde.

---

## ⚖️ Zákon 6: Žádné Emoji v UI

**Ikony z icon library (lucide-react nebo projekt-specifická). Unicode emoji jsou zakázány.**

```typescript
// ✅ SPRÁVNĚ
import { ShoppingCart, Heart } from "lucide-react";
<ShoppingCart className="w-4 h-4" />

// ❌ ZAKÁZÁNO
<span>🛒</span>
<span>❤️</span>
```

**Proč:** Emoji renderování se liší mezi OS. Accessibilita. Nekonzistentní velikosti.

---

## ⚖️ Zákon 7: Explicitní Permission Checks

**Role a oprávnění přes dynamický hook. Nikdy hardcoded role string.**

```typescript
// ✅ SPRÁVNĚ
const { hasPermission } = usePermissions();
if (hasPermission("manage_products")) { /* ... */ }

// ❌ ZAKÁZÁNO
if (user.role === "admin") { /* ... */ }
if (userRole === "staff" || userRole === "admin") { /* ... */ }
```

---

## ⚖️ Zákon 8: Komponenty Max 500 Řádků

**Pokud komponenta překročí ~400 řádků, rozdělit ji na sub-komponenty.**

Znaky nutnosti rozdělení:
- 3+ `useState` hookové pro různé oblasti → extrahovat do custom hooku
- JSX sekce, která by mohla stát samostatně → extrahovat do komponenty
- Logika výpočtu dat přímo v komponentě → přesunout do hooku nebo utility

---

## ⚖️ Zákon 9: Testy VŽDY Odpovídají Implementaci

**Před psaním testu VŽDY přečíst implementaci hooku.**

```typescript
// WORKFLOW:
// 1. Přečti hook src/hooks/useMyHook.ts
// 2. Zjisti, jak volá API (fetch, axios, supabase.rpc...)
// 3. Napiš mock PŘESNĚ pro ten způsob volání
// 4. Spusť test a ověř

// ❌ NEJČASTĚJŠÍ CHYBA:
// Hook volá: apiClient.get("/products")
// Test mockuje: vi.mock fetch (když hook nepoužívá fetch přímo)
```

**parseRpcArraySafe / safeParse pasti:**
Pokud hook používá `safeParse`, nevalidní data tiše vypadnou (vrátí prázdné pole).
Hook "funguje", ale produkční data se mohou ztratit.
**VŽDY** po změně Zod schématu okamžitě spustit příslušný test.

---

## ⚖️ Zákon 10: Abecední Řazení Parametrů

**Parametry funkcí (hlavně hooků a RPC volání) jsou řazeny abecedně.**

```typescript
// ✅ SPRÁVNĚ — abecedně
function useProducts(options: {
  category?: string;
  enabled?: boolean;
  limit?: number;
  sortBy?: string;
}) {}

// ❌ ŠPATNĚ — náhodné pořadí
function useProducts(limit: number, category: string, enabled: boolean) {}
```

---

## ⚖️ Zákon 11: Žádné `@ts-ignore`

**Používat `@ts-expect-error` s povinným komentářem proč.**

```typescript
// ❌ ZAKÁZÁNO
// @ts-ignore

// ✅ POVOLENO s vysvětlením
// @ts-expect-error: knihovna X nezveřejňuje typ Y, ale existuje v runtime
someExternalLib.internalMethod();
```

---

## ⚖️ Zákon 12: Commit Jen s Prošlými Testy + Buildem

```bash
# Pre-commit hook (automatizováno přes Husky):
npm run test:run -- <relevantní soubory>
npx tsc --noEmit
npm run lint

# Před pushem:
npm run build
```

---

## 📋 Shrnutí Zákonů (rychlá reference)

| # | Zákon | Nástroj detekce |
|---|-------|-----------------|
| 1 | Hook-only data access | Gate test: `rpc-only-data-access.gate.test.ts` |
| 2 | Žádné `any` typy | ESLint + gate test |
| 3 | Zod validace externích dat | Code review + testy |
| 4 | i18n všude | Gate test: `ui-quality.gate.test.ts` |
| 5 | Žádné `console.log` | Gate test: `code-hygiene.gate.test.ts` |
| 6 | Žádné emoji | Gate test: `ui-quality.gate.test.ts` |
| 7 | Dynamické permise | Code review |
| 8 | Komponenty <500 řádků | Gate test (warning) |
| 9 | Testy odpovídají implementaci | Review + spuštění testů |
| 10 | Abecední parametry | Code review + Zod orderu |
| 11 | Žádné `@ts-ignore` | Gate test: `code-hygiene.gate.test.ts` |
| 12 | Commit = testy pass | Husky pre-commit + pre-push |

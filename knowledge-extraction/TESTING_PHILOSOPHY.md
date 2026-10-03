# Testovací Filozofie — 4 Úrovně, Každá s Jiným Účelem

> "Testy nejsou luxus. Jsou to důkazy, že kód funguje."

---

## Přehled: 4 Úrovně Testů

```
┌────────────────────────────────────────────────────────────────┐
│  ÚROVEŇ 4: E2E (Playwright)                                   │
│  Co: Celý flow od UI po API                                   │
│  Kdy: Kritické user story, regressions                        │
│  Jak: Reálný browser, živé API (local)                        │
├────────────────────────────────────────────────────────────────┤
│  ÚROVEŇ 3: Gate Testy (Vitest node)                           │
│  Co: Architektura, hygiene, security, i18n                    │
│  Kdy: Při každém PR — automaticky jako CI gate                │
│  Jak: AST analýza souborů, statická kontrola                  │
├────────────────────────────────────────────────────────────────┤
│  ÚROVEŇ 2: Integration Testy (Vitest jsdom)                   │
│  Co: Komponenty s hooky, multi-hook workflows                 │
│  Kdy: Komplexní komponenty, kritické flow                     │
│  Jak: renderHook + render + mock API                          │
├────────────────────────────────────────────────────────────────┤
│  ÚROVEŇ 1: Unit Testy (Vitest jsdom)                          │
│  Co: Hooky, utility funkce, Zod schémata                      │
│  Kdy: KAŽDÝ nový hook, každá utility funkce                   │
│  Jak: renderHook, mock API klient                             │
└────────────────────────────────────────────────────────────────┘
```

---

## Úroveň 1: Unit Testy Hooků

### Kdy psát:
- **Ihned po implementaci každého nového hooku**
- Po každé změně signatury hooku nebo Zod schématu
- Po změně způsobu volání API (fetch → axios, parametry, endpoints)

### Co testovat:
1. **Happy path** — úspěšné načtení a vrácení dat
2. **Error path** — chování při chybě API (síťová chyba, 4xx, 5xx)
3. **Validace** — co se stane s nevalidními daty z API
4. **Podmíněné chování** — `enabled: false`, chybějící user, permissions
5. **Mutace** — onSuccess invalidace cache, onError handling

### Šablona:

```typescript
// src/tests/hooks/useMyFeature.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createTestWrapper } from "@/tests/utils/testWrapper";
import { useMyFeature } from "@/hooks/useMyFeature";

// KROK 1: Přečti hook! Co PŘESNĚ volá? apiClient.get? supabase.rpc?
// KROK 2: Mockuj PŘESNĚ ten způsob volání
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn() },
}));

describe("useMyFeature", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns data on success", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: "1" }] });
    const { result } = renderHook(() => useMyFeature(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("returns empty array on invalid data (safeParse)", async () => {
    // KRITICKÉ: pokud hook používá safeParse, nevalidní data tiše zmizí
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ wrong: "field" }] });
    const { result } = renderHook(() => useMyFeature(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Ověřit, že hook necrashuje, ale vrací [] nebo undefined správně
  });

  it("handles API error — no sensitive data in error", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useMyFeature(), {
      wrapper: createTestWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Ověř, že error state je nastaven
    // Ověř, že žádná PII/sensitive data data neunikla do error message
  });

  it("is disabled without authenticated user", async () => {
    vi.mocked(useSession).mockReturnValue({ user: null });
    const { result } = renderHook(() => useMyFeature(), {
      wrapper: createTestWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
  });
});
```

---

## Úroveň 2: Integration / Component Testy

### Kdy psát:
- Komponenty s vlastní stavovou logikou
- Form komponenty s validací
- Komponenty kombinující více hooků
- Kritické user flows (checkout, consent, onboarding)

### Co testovat:
1. Render s různými stavy hooku (loading, error, success)
2. User interakce (klik, submit formáře)
3. Kontextuální chování (přihlášen/nepřihlášen)

### Šablona:

```typescript
// src/tests/components/ProductCard.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductCard } from "@/components/products/ProductCard";
import { createTestWrapper } from "@/tests/utils/testWrapper";

describe("ProductCard", () => {
  it("renders product name and price", () => {
    render(
      <ProductCard product={{ id: "1", name: "Test", price: 100 }} />,
      { wrapper: createTestWrapper() }
    );
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("shows out-of-stock when available=false", () => {
    render(
      <ProductCard product={{ id: "1", name: "X", price: 50, available: false }} />,
      { wrapper: createTestWrapper() }
    );
    // i18n klíč, ne hardcoded text
    expect(screen.getByRole("button", { name: /outOfStock/i })).toBeDisabled();
  });
});
```

---

## Úroveň 3: Gate Testy — Architektonická Kontrola

### Co jsou Gate Testy:

Gate testy jsou **statické analyzátory kódu** (AST/regex analýza souborů) které vynucují architektonické pravidla. Neinteragují s API, nepotřebují DOM — běží v Node prostředí.

**Blokují CI pokud selžou.** To je jejich smysl.

### Povinné Gate Testy:

| Gate test | Co kontroluje |
|-----------|---------------|
| `code-hygiene.gate.test.ts` | `console.log`, `any` typy, `@ts-ignore` bez důvodu, `TODO/FIXME` |
| `rpc-only-data-access.gate.test.ts` | Žádné přímé `.from()` / `fetch()` z komponent |
| `ui-quality.gate.test.ts` | Emoji v JSX, hardcoded texty, velké komponenty |
| `security.gate.test.ts` | sensitive data funkce bez anon přístupu, RLS na tabulkách |
| `enum-consistency.gate.test.ts` | TypeScript typy odpovídají DB enumům |
| `design-token-consistency.gate.test.ts` | Konzistentní použití design tokenů |

### Jak psát Gate Test pro nový projekt:

```typescript
// src/tests/gates/api-access.gate.test.ts
/**
 * API Access Gate
 * Kontroluje: Žádné přímé fetch() volání v komponentách.
 * Spouští se přes vitest.gates.config.ts (node env).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC_DIR = path.join(ROOT, "src");

function scanTsFiles(dir: string): Array<{ path: string; content: string; rel: string }> {
  const files: Array<{ path: string; content: string; rel: string }> = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", "dist", ".git"].includes(entry.name)) {
      files.push(...scanTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push({ path: full, content: fs.readFileSync(full, "utf-8"), rel: path.relative(ROOT, full) });
    }
  }
  return files;
}

const COMPONENT_DIRS = ["components", "pages"];
const isComponentFile = (rel: string) =>
  COMPONENT_DIRS.some((d) => rel.startsWith(`src/${d}/`)) &&
  !rel.includes("/tests/") && !rel.endsWith(".test.tsx") && !rel.endsWith(".test.ts");

describe("API Access Gate", () => {
  it("no direct fetch() calls in component files", () => {
    const violations: string[] = [];
    const files = scanTsFiles(SRC_DIR).filter((f) => isComponentFile(f.rel));

    for (const { rel, content } of files) {
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (/\bfetch\s*\(/.test(line) && !line.trim().startsWith("//")) {
          violations.push(`${rel}:${i + 1} — přímý fetch() v komponentě`);
        }
      });
    }

    if (violations.length > 0) {
      console.error("Violations:\n" + violations.join("\n"));
    }
    expect(violations).toHaveLength(0);
  });
});
```

---

## Úroveň 4: E2E Testy (Playwright)

### Kdy psát:
- Přihlásení / registrace / obnova hesla
- Celý checkout flow
- Onboarding flow
- Consent / souhlas flow
- Kritické admin akce

### Zásady E2E:

1. **Žádný bypass auth** — E2E musí projít skutečným UI login flow
2. **Spouštěj přes runner** (`npm run test:e2e:local`) — zajišťuje správný server
3. **Izolovaná testovací data** — seed data pro E2E, ne produkční

### Šablona:

```typescript
// e2e/auth/login.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("user can log in with valid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('[name="email"]', "test@example.com");
    await page.fill('[name="password"]', "TestPassword123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/dashboard");
  });

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('[name="email"]', "wrong@example.com");
    await page.fill('[name="password"]', "wrong");
    await page.click('button[type="submit"]');
    // Ověř i18n error message — ne hardcoded text
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });
});
```

---

## Pravidla Testování

### Co VŽDY testovat:

- [ ] Happy path (data přicházejí, UI zobrazuje správně)
- [ ] Error path (API selhání, hook vrátí error state)
- [ ] Empty state (prázdná data, UI zobrazí prázdný stav)
- [ ] Loading state (hook je v isLoading, UI zobrazí spinner/skeleton)
- [ ] Auth guard (bez přihlášení = redirect nebo disabled)

### Co NETESTOVAT:

- Implementační detaily Reactu (useState internals)
- Stylování (CSS třídy — to patří do visual regression)
- Knihovní kód (TanStack Query internals)

### Kdy spouštět:

| Situace | Příkaz |
|---------|--------|
| Změna jednoho hooku | `npm run test:run -- src/tests/hooks/useMujHook.test.ts` |
| Změna komponenty | `npm run test:run -- src/tests/components/MojeKomponenta.test.tsx` |
| Před PR | `npm run test:run && npm run test:gates && npm run build` |
| After batch refactor | `npm run test:run` (všechny) |

### Anti-patterny v testech (nikdy):

```typescript
// ❌ toHaveBeenCalledTimes(1) — fragilní, re-rendery způsobí 2x
expect(mockFn).toHaveBeenCalledTimes(1); 
// ✅ ROBUST
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(expect.objectContaining({ key: "value" }));

// ❌ Testování implementačního detailu
expect(useState).toHaveBeenCalledWith(false);

// ❌ Mock který neodpovídá implementaci
// Hook: apiClient.get("/products")
// Test: vi.mock("../api") ← špatný modul!

// ❌ Sdílený stav mezi testy bez beforeEach cleanup
vi.mocked(someMock).mockReturnValue("value"); // bez clearAllMocks → ovlivní další test
```

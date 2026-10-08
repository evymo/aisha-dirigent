# Bezpečnostní Standardy — Frontend

> Bezpečnost není addon. Je embedded do každého rozhodnutí od prvního řádku.

---

## Co Je "Citlivá Data" (sensitive data & PII)

| Kategorie | Příklady | Pravidlo |
|-----------|----------|---------|
| **Identifikátory** | email, jméno, příjmení, datum narození | NIKDY logovat |
| **Zdravotní data** | hodnoty měření, diagnózy, symptomy | NIKDY logovat |
| **Přihlašovací data** | hesla, tokeny, API klíče | NIKDY logovat |
| **Kontaktní data** | adresa, telefon, IP adresa | NIKDY logovat |
| **Finanční data** | čísla karet, bankovní účty | NIKDY logovat |
| **Bezpečná data** | IDs (UUID), počty, timestampy | Logovat OK |

---

## Pravidlo 1: Bezpečný Logger

```typescript
// src/lib/security/safeLogger.ts

import { ApiError } from "@/lib/api/client";

/**
 * Vrátí bezpečnou reprezentaci chyby bez citlivých dat.
 * Použij VŽDY místo přímého logování error objektů.
 */
export function safeError(error: unknown): string {
  if (error instanceof ApiError) {
    // Pouze status a kód — žádná response data
    return `ApiError(${error.status}, ${error.code})`;
  }
  if (error instanceof Error) {
    // Pouze message — ne stack trace (může obsahovat data)
    return error.message.slice(0, 200); // limituj délku
  }
  return "unknown_error";
}

/**
 * Vrátí uživatelsky přátelskou zprávu bez technických detailů.
 */
export function getUserFacingMessage(
  error: unknown,
  t: (key: string) => string
): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return t("errors.badRequest");
      case 401: return t("errors.unauthorized");
      case 403: return t("errors.forbidden");
      case 404: return t("errors.notFound");
      case 409: return t("errors.conflict");
      case 429: return t("errors.tooManyRequests");
      case 500:
      case 502:
      case 503: return t("errors.serverError");
      default: return t("errors.generic");
    }
  }
  return t("errors.generic");
}
```

---

## Pravidlo 2: Žádné Citlivá Data v Error Messages

```typescript
// ❌ ŠPATNĚ — email a data unikají do logu
catch (error) {
  console.error(`Nepodařilo se uložit pro uživatele ${user.email}:`, error);
  Toast.error(`Error: ${error.message}`); // error.message může obsahovat DB data
}

// ✅ SPRÁVNĚ — pouze bezpečné informace
catch (error) {
  console.error("Save failed:", safeError(error)); // jen kód chyby
  Toast.error(getUserFacingMessage(error, t)); // user-friendly, bez techniky
}
```

---

## Pravidlo 3: Input Validace Před Odesláním

```typescript
// ✅ SPRÁVNĚ — Zod validace blomentuje XSS, injection, oversized data
const formSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255),
  message: z.string().max(2000).optional(),
  age: z.number().int().min(18).max(120),
});

function onSubmit(rawData: unknown) {
  const result = formSchema.safeParse(rawData);
  if (!result.success) {
    // Zobraz validační chyby uživateli, không log raw data
    setErrors(result.error.flatten().fieldErrors);
    return;
  }
  // result.data je nyní typovaný a validní
  createUser.mutate(result.data);
}
```

---

## Pravidlo 4: Environment Variables

```typescript
// ✅ SPRÁVNĚ — přes import.meta.env
const apiUrl = import.meta.env.VITE_API_URL;
const isDebug = import.meta.env.DEV;

// ❌ ŠPATNĚ — hardcoded credentials nebo URL
const apiUrl = "https://api.example.com";
const apiKey = "sk_live_abc123"; // NIKDY!

// ❌ ZAKÁZÁNO — VITE_ prefix odhaluje hodnoty v buildu klientovi
// Nikdy nepoužívat pro secrets:
// VITE_SECRET_KEY, VITE_DB_PASSWORD atd.
```

**Co patří do `.env`:**
```env
VITE_API_URL=https://api.example.com     # OK — veřejné URL
VITE_AISHA_POSTGREST_URL=https://xxx.supabase.co # OK — veřejné URL
VITE_AISHA_POSTGREST_ANON_KEY=eyJhbG...          # OK — public anon key

# Toto NESMÍ být ve frontend env:
# API_SECRET=...
# DB_PASSWORD=...
# STRIPE_SECRET_KEY=...
```

---

## Pravidlo 5: Session Management

```typescript
// src/hooks/useSession.ts — pattern
import { create } from "zustand";

interface SessionState {
  accessToken: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
}

// ✅ In-memory store (ne localStorage) pro citlivé tokeny
export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
}));

// ✅ Automatické odhlášení po timeout
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minut

export function useSessionTimeout() {
  const { clearSession } = useSessionStore();
  
  useEffect(() => {
    const timer = setTimeout(clearSession, SESSION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [clearSession]);
}
```

---

## Pravidlo 6: Content Security Policy

V `index.html` nebo server headers:

```html
<!-- Základní CSP pro React SPA -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  font-src 'self';
  frame-src 'none';
  object-src 'none';
">
```

---

## Pravidlo 7: Permission Checks

```typescript
// ✅ SPRÁVNĚ — dynamické permissions z API
const { hasPermission } = usePermissions();

// Podmíněný render
{hasPermission("users:write") && <EditButton />}

// Guard v hooku
if (!hasPermission("reports:read")) {
  throw new ApiError(403, "insufficient_permissions");
}

// ❌ ZAKÁZÁNO — hardcoded role check
if (user.role === "admin") {
  // Problém: role se mohou přejmenovat, granularita je nulová
}
```

---

## Pravidlo 8: Žádný Overfetch

```typescript
// ✅ SPRÁVNĚ — pouze potřebná pole
const response = await apiClient.get("/users/me", {
  params: { fields: "id,name,email,role" } // explicit field selection
});

// ❌ ŠPATNĚ — stahuj vše
const response = await apiClient.get("/users/me"); // vrací všechna pole
// Problém: exponuje více dat než nutné, větší payload
```

---

## Audit Log (pro sensitive data aplikace)

Pokud aplikace pracuje se zdravotními nebo citlivými daty, každý přístup musí být zaznamenán:

```typescript
// Audit log se píše NA SERVERU (v API), ne na frontendu
// Frontend pouze volá správný endpoint:

// Správné RPC funkce mají _audited suffix (viz ARCHITECTURE_PATTERNS.md)
// Každé volání automaticky generuje audit záznam na serveru

// Co logovat v DB audit záznamu:
{
  user_id: "uuid",          // KDO přistoupil
  action: "SENSITIVE_DATA_READ",       // CO udělal
  entity_type: "health_check_ins", // NA CO
  entity_id: "uuid",        // KTERÉ entitě
  metadata: { limit: 30 },  // Kontext (počty, filtry) — BEZ sensitive data hodnot!
  created_at: "timestamp",
}
```

---

## Security Checklist (nový projekt)

- [ ] `Content-Security-Policy` header nastaven
- [ ] Žádné secrets ve VITE_ env variables
- [ ] Tokeny v in-memory store, ne localStorage (pro citlivé operace)
- [ ] Session timeout implementován
- [ ] `safeError()` používán všude v error handlers
- [ ] Zod validace pro všechny API responses
- [ ] Permission checks přes `hasPermission()` hook
- [ ] Žádné citlivé data v URL parametrech
- [ ] `npm audit` prochází bez critical vulnerabilities
- [ ] HTTPS enforced (Strict-Transport-Security header)

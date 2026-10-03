# Development Guidelines - Platform

**Verze:** 1.0 | **Datum:** 20. prosince 2025  
**Klasifikace:** Interní vývojová dokumentace

---

## 📋 Obsah

1. [Project Overview](#1-project-overview)
2. [Security Requirements](#2-security-requirements)
3. [OWASP Top 10 Protection](#3-owasp-top-10-protection)
4. [Testing Requirements](#4-testing-requirements)
5. [Database & RLS Policies](#5-database--rls-policies)
6. [TypeScript Standards](#6-typescript-standards)
7. [React Best Practices](#7-react-best-practices)
8. [Code Style](#8-code-style)
9. [Data Privacy & Protection](#9-data-privacy--protection)
10. [Performance Standards](#10-performance-standards)
11. [Deployment & CI/CD](#11-deployment--cicd)

---

## 1. Project Overview

Platform je production výzkumná platforma zaměřená na imunologické studie (reInvented Immunology). Aplikace zpracovává citlivá citlivá data a musí splňovat security compliance a OWASP bezpečnostní standardy.

### Application Context

| Aspekt | Popis |
|--------|-------|
| **Účel** | Moderní sociální síť pro zdraví & wellness s integrovanými výzkumnými studiemi |
| **Data** | Reálná sensitive data (sensitive data) od skutečných uživatelů |
| **Prostředí** | Produkce s reálnými uživateli a citlivými medicínskými daty |
| **Uživatelé** | Veřejně přístupná aplikace pro běžné uživatele, výzkumníky a zdravotnické profesionály |
| **Standard** | State-of-the-art best practices vyžadovány pro veškerý kód |

### Quality Expectations

**Vše co stavíme musí být production-grade, world-class kvalita:**

- **Code quality** — Clean, maintainable, well-documented
- **Security** — security compliance, OWASP Top 10 compliant vždy
- **Testing** — Comprehensive coverage (80%+ minimum) s integration a security testy
- **Architecture** — Scalable, performant, resilient
- **User experience** — Intuitive, accessible, responsive
- **Data integrity** — Accurate, consistent, auditable

### ⛔ Never Compromise On

- Security measures (ani pro "minor features")
- Test coverage (každý feature musí být testován)
- Data privacy (sensitive-data protection je non-negotiable)
- Code review process (no direct commits to main)
- Compliance requirements (compliance/security compliance always enforced)

---

## 2. Security Requirements

### compliance Compliance

**Veškerý kód MUSÍ splňovat compliance požadavky pro sensitive-data:**

#### Never Log sensitive-data
```typescript
// ❌ ŠPATNĚ - sensitive data v logu
console.log(`User ${email} submitted check-in with pain level ${painLevel}`);

// ✅ SPRÁVNĚ - Pouze anonymní identifikátory
console.log(`Check-in submitted`, { userId: user.id, timestamp: new Date() });
```

#### Encrypt Data at Rest and in Transit
- Všechna citlivá data musí používat TLS 1.2+ pro přenos
- Supabase poskytuje encryption at rest by default

#### Audit Trails Required
```typescript
// Každý sensitive data přístup musí být logován v audit_journal
const { data } = await supabase.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});
// RPC funkce automaticky zapisuje do audit_journal
```

#### Minimum Necessary Principle
```typescript
// ✅ SPRÁVNĚ - Pouze potřebná pole
const { data } = await supabase.rpc("get_user_summary", {
  p_client_id: userId
});
// RPC vrací pouze: id, display_name, last_check_in_date

// ❌ ŠPATNĚ - Overfetch
const { data } = await supabase.from("profiles").select("*");
```

#### User Consent Tracking
```typescript
// Vždy ověřit consent před zobrazením sensitive-data
const { data: consent } = await supabase.rpc("check_data_sharing_consent", {
  p_client_id: userId,
  p_partner_id: partnerId
});

if (!consent?.has_consent) {
  throw new Error("No consent granted for this user");
}
```

### security compliance Compliance

| Požadavek | Implementace |
|-----------|--------------|
| **Change management** | Všechny DB změny přes migration soubory v `supabase/migrations/` |
| **Code review** | No direct commits to main, všechny změny přes PR |
| **Automated testing** | Všechny PR musí projít 100% testů |
| **Incident response** | Security incidenty dokumentovány v `/docs/incidents/` |

---

## 3. OWASP Top 10 Protection

### 1. Injection Prevention

```typescript
// ✅ SPRÁVNĚ - Supabase parametrizované dotazy
const { data } = await supabase
  .from("health_check_ins")
  .select("id, check_in_date, pain_level")
  .eq("user_id", userId)
  .gte("check_in_date", startDate);

// ❌ ŠPATNĚ - String concatenation (NIKDY!)
const query = `SELECT * FROM health_check_ins WHERE user_id = '${userId}'`;
```

**Zod validace před DB operací:**
```typescript
import { z } from "zod";

const checkInSchema = z.object({
  pain_level: z.number().min(0).max(10),
  energy_level: z.number().min(0).max(10),
  notes: z.string().max(1000).optional(),
});

// Validuj PŘED insertem
const validated = checkInSchema.parse(userInput);
const { error } = await supabase.rpc("submit_health_check_in", validated);
```

### 2. Authentication & Session Management

```typescript
// ✅ Použij Supabase Auth s MFA
const { data: { session } } = await supabase.auth.getSession();

// sensitive data session timeout: 30 minut
// Implementováno v usePhiSession hook

// ❌ NIKDY neukládej tokeny do localStorage pro sensitive data flow
// sensitive data session používá in-memory token
```

### 3. Sensitive Data Exposure

```typescript
// ✅ Environment variables pro secrets
const supabaseUrl = import.meta.env.VITE_AISHA_POSTGREST_URL;

// ✅ Redact sensitive fields v error messages
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));

// ❌ NIKDY neexponuj interní strukturu v chybách
// Špatně: "Table 'health_check_ins' column 'notes' constraint violation"
// Správně: "Unable to save check-in. Please try again."
```

### 4. Access Control (RLS)

```sql
-- KAŽDÁ tabulka MUSÍ mít RLS enabled
ALTER TABLE health_check_ins ENABLE ROW LEVEL SECURITY;

-- Policies MUSÍ používat auth.uid()
CREATE POLICY "Users can read own data" ON health_check_ins
  FOR SELECT USING (auth.uid() = user_id);

-- Testuj RLS policies s různými user kontexty!
```

### 5. Security Misconfiguration

```bash
# Před každým commitem
npm audit

# Striktní TypeScript mode
# tsconfig.json: "strict": true

# CSP headers implementovány v Cloudflare/Edge
```

### 6. XSS Prevention

```tsx
// ✅ React auto-escapes by default
<div>{userInput}</div>  // Bezpečné

// ⚠️ dangerouslySetInnerHTML pouze s DOMPurify
import DOMPurify from "dompurify";

<div 
  dangerouslySetInnerHTML={{ 
    __html: DOMPurify.sanitize(richTextContent) 
  }} 
/>
```

### 7. CSRF Protection

```typescript
// Supabase má built-in CSRF protection
// Ověř SameSite=Strict pro auth cookies

// Pro state-changing operace používej RPC s JWT validací
const { data, error } = await supabase.rpc("update_profile", {
  p_updates: profileUpdates
});
```

### 8. Insecure Deserialization

```typescript
// ✅ Validuj všechny JSON payloady pomocí Zod
const apiResponseSchema = z.object({
  data: z.array(healthCheckInSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
  }),
});

const validated = apiResponseSchema.parse(response);

// ❌ NIKDY nepoužívej eval() nebo Function() constructors
```

### 9. Component Security

```bash
# Audit third-party libraries
npm audit

# Pin dependency versions v production
# package.json: "react": "18.3.1" (ne "^18.3.1")

# Pravidelné security updates
npm update --save
```

### 10. Logging & Monitoring

```typescript
// ✅ Log authentication attempts
await supabase.rpc("log_auth_attempt", {
  p_action: "login",
  p_success: true,
  p_method: "password"
});

// ✅ Log sensitive data access s user context
// Automaticky přes _audited RPC funkce

// ✅ Monitor unusual patterns
// Rate limiting na Edge Functions

// ❌ NIKDY neloguj passwords, tokens, nebo sensitive-data
```

---

## 4. Testing Requirements

### Test Coverage Standards

**Minimum 80% coverage vyžadováno pro:**
- Všechny hooks (`src/hooks/`)
- Všechny stránky (`src/pages/`)
- Všechny security funkce (`src/lib/security/`)

### Test Categories

#### 1. Unit Tests
```typescript
// src/tests/hooks/useActivityTracking.test.ts
describe("useActivityTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch check-ins via RPC", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: mockCheckIns,
      error: null,
    });

    const { result } = renderHook(() => useActivityTracking());

    await waitFor(() => {
      expect(result.current.checkIns).toEqual(mockCheckIns);
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "get_my_health_check_ins_audited",
      expect.any(Object)
    );
  });

  it("should handle errors without exposing sensitive-data", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    });

    const { result } = renderHook(() => useActivityTracking());

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
      // Error message nesmí obsahovat sensitive-data
      expect(result.current.error?.message).not.toMatch(/email|name|@/);
    });
  });
});
```

#### 2. Integration Tests
```typescript
// src/tests/integration/rls-policies.test.ts
describe("RLS Policy Enforcement", () => {
  it("should prevent access to other users sensitive data", async () => {
    // Mock different user context
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-a" } },
      error: null,
    });

    // Attempt to fetch other user's data
    const { data, error } = await supabase.rpc("get_user_check_ins", {
      p_client_id: "user-b"
    });

    // Assert access denied
    expect(error).toBeDefined();
    expect(data).toBeNull();
  });
});
```

#### 3. Security Tests
```typescript
// src/tests/security/phi-protection.test.ts
describe("sensitive-data Protection", () => {
  it("should not log sensitive data in error messages", () => {
    const consoleSpy = vi.spyOn(console, "error");
    
    const error = new Error("Failed for user test@example.com");
    logSafeError("Operation failed", error);

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("test@example.com")
    );
  });

  it("should require secure mode for sensitive data access", async () => {
    // Without secure mode enabled
    vi.mocked(usePhiSession).mockReturnValue({ isEnabled: false });

    const { result } = renderHook(() => useActivityCheckIns());

    // Should not fetch data
    expect(result.current.data).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
```

### Test Best Practices

✅ **DO:**
- **Mock external dependencies** — `vi.mock()` pro Supabase client, auth, i18n
- Test both success a error paths
- Test RLS policies s různými user kontexty
- Use `waitFor()` pro async state updates
- Clean up mocks v `afterEach()` / `afterAll()`
- Descriptive test names: `should [expected behavior] when [condition]`
- **Produkční kvalita** — Testy musí být maintainable a readable

❌ **DON'T:**
- **Skip mocking external APIs** — nikdy nevolej reálné API v unit testech
- Test implementation details (internal state)
- Mock React komponenty (mockuj hooky místo toho)
- Share state mezi testy
- Skip error case testing
- Leave flaky tests in codebase

### Running Tests

```bash
# Všechny testy (4500+)
npm run test:run

# S coverage
npm run test:coverage

# Specifický soubor
npm run test:run src/tests/hooks/useAuth.test.ts

# Watch mode pro development
npm test
```

---

## 5. Database & RLS Policies

### Row Level Security (RLS)

**Každá tabulka MUSÍ mít RLS enabled a proper policies:**

```sql
-- Enable RLS
ALTER TABLE health_check_ins ENABLE ROW LEVEL SECURITY;

-- User can only read their own data
CREATE POLICY "Users can read own check-ins"
ON health_check_ins FOR SELECT
USING (auth.uid() = user_id);

-- User can insert their own data
CREATE POLICY "Users can insert own check-ins"
ON health_check_ins FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- User can update their own data
CREATE POLICY "Users can update own check-ins"
ON health_check_ins FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Admin policies (use role checks)
CREATE POLICY "Admins can read all check-ins"
ON health_check_ins FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);
```

### RLS Best Practices

✅ **DO:**
- Use `auth.uid()` pro user-scoped data
- Use `SECURITY INVOKER` pro views (respektuje RLS)
- Test policies s různými user roles
- Document policy purpose v komentářích
- Use role-based policies pro admin access

❌ **DON'T:**
- Use `SECURITY DEFINER` pro views (bypasses RLS)
- Create overly permissive policies
- Rely on client-side filtering for security
- Forget to enable RLS na nových tabulkách
- Use `auth.jwt()` pro authorization (unstable)

### Migration Guidelines

```sql
-- migrations/YYYYMMDDHHMMSS_descriptive_name.sql

-- Always include rollback instructions in comments
-- Rollback: DROP TABLE IF EXISTS new_table;

-- Add created_at, updated_at to all tables
CREATE TABLE new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS immediately
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Create trigger for updated_at
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON new_table
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create RLS policies
CREATE POLICY "Users can read own data" ON new_table
  FOR SELECT USING (auth.uid() = user_id);

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON new_table TO authenticated;
```

---

## 6. TypeScript Standards

### Strict Type Safety

```typescript
// ✅ SPRÁVNĚ - Explicitní typy, proper null handling
interface ActivityCheckIn {
  id: string;
  user_id: string;
  pain_level: number | null;
  energy_level: number | null;
  check_in_date: string;
}

async function getCheckIn(id: string): Promise<ActivityCheckIn | null> {
  const { data, error } = await supabase
    .rpc("get_check_in", { p_id: id });
    
  if (error) throw error;
  return data;
}

// ❌ ŠPATNĚ - Any typy, no null handling
async function getCheckIn(id: any): Promise<any> {
  const { data } = await supabase
    .from("health_check_ins")
    .select("*")
    .eq("id", id)
    .single();
  return data;
}
```

### Type Conventions

| Typ | Použití | Příklad |
|-----|---------|---------|
| **interface** | Object shapes | `interface UserProfile { ... }` |
| **type** | Unions, utilities | `type Role = 'admin' \| 'member' \| 'researcher'` |
| **enum** | Fixed sets | `enum ConsentType { DataProcessing = 'data_processing' }` |
| **unknown** | Truly unknown types | Preferuj `unknown` před `any` |
| **Zod** | Runtime validation | Pro data z externích zdrojů |

### Zod Validation Patterns

```typescript
import { z } from "zod";

// Define schema
const healthCheckInSchema = z.object({
  pain_level: z.number().min(0).max(10).nullable(),
  energy_level: z.number().min(0).max(10).nullable(),
  mood_level: z.number().min(0).max(10).nullable(),
  sleep_quality: z.number().min(0).max(10).nullable(),
  notes: z.string().max(1000).optional(),
});

// Infer TypeScript type from schema
type ActivityCheckInInput = z.infer<typeof healthCheckInSchema>;

// Validate before DB insert
function submitCheckIn(input: unknown): ActivityCheckInInput {
  return healthCheckInSchema.parse(input);
}

// Safe parse (doesn't throw)
function trySubmitCheckIn(input: unknown) {
  const result = healthCheckInSchema.safeParse(input);
  if (!result.success) {
    console.error("Validation failed:", result.error.issues);
    return null;
  }
  return result.data;
}
```

---

## 7. React Best Practices

### Component Structure

```tsx
// ✅ SPRÁVNĚ - Typed props, proper hooks, error handling
interface ActivityCheckInFormProps {
  onSubmit: (data: ActivityCheckIn) => Promise<void>;
  initialData?: Partial<ActivityCheckIn>;
}

export function ActivityCheckInForm({ 
  onSubmit, 
  initialData 
}: ActivityCheckInFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (data: ActivityCheckIn) => {
    if (!user) {
      toast({ 
        title: "Error", 
        description: "Must be logged in",
        variant: "destructive"
      });
      return;
    }
    
    try {
      setIsSubmitting(true);
      await onSubmit(data);
      toast({ title: "Success", description: "Check-in saved" });
    } catch (error) {
      // No sensitive data in logs
      console.error("Failed to save check-in:", safeError(error));
      toast({ 
        title: "Error", 
        description: "Failed to save check-in",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (/* JSX */);
}
```

### Hook Guidelines

```typescript
// Custom hooks must start with "use" prefix
export function useActivityTracking() {
  const { user } = useSession();
  
  // Use React Query for server state
  return useQuery({
    queryKey: ["health-tracking", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_my_health_check_ins_audited",
        { p_limit: 30 }
      );
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Use useState/useReducer only for local UI state
const [isExpanded, setIsExpanded] = useState(false);

// Always clean up in useEffect
useEffect(() => {
  const subscription = supabase
    .channel("check-ins")
    .on("postgres_changes", { ... }, handleChange)
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}, []);
```

### Error Boundaries

```tsx
import { ErrorBoundary } from "react-error-boundary";

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert">
      <p>Something went wrong</p>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

// Wrap secure-displaying components in error boundaries
<ErrorBoundary FallbackComponent={ErrorFallback}>
  <ActivityDataDisplay />
</ErrorBoundary>
```

---

## 8. Code Style

### Internationalization (i18n) - POVINNÉ

**Všechny uživatelské texty MUSÍ jít přes i18n:**

```typescript
// ✅ SPRÁVNĚ - Přes překlady
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
<Button>{t("common.save")}</Button>
<span>{t("health.pain_level")}</span>

// ❌ ŠPATNĚ - Hardcoded strings (ZAKÁZÁNO)
<Button>Save</Button>
<span>Pain Level</span>
```

Jazykové soubory:
- `src/i18n/locales/cs.json` - Čeština
- `src/i18n/locales/en.json` - Angličtina

### Naming Conventions

| Typ | Konvence | Příklad |
|-----|----------|---------|
| **Components** | PascalCase | `ActivityCheckInForm.tsx` |
| **Hooks** | camelCase + use | `useActivityTracking.ts` |
| **Utilities** | camelCase | `formatActivityData.ts` |
| **Constants** | SCREAMING_SNAKE_CASE | `MAX_PAIN_LEVEL` |
| **Types/Interfaces** | PascalCase | `ActivityCheckIn`, `UserProfile` |
| **Database tables** | snake_case | `health_check_ins`, `program_registrations` |
| **RPC functions** | snake_case + _audited | `get_my_check_ins_audited` |

### File Organization

```
src/
├── components/          # Reusable UI components
│   ├── ui/             # shadcn/ui components
│   ├── layout/         # Header, Footer, Sidebar
│   ├── admin/          # Admin-specific components
│   ├── member/         # Member portal components
│   └── [feature]/      # Feature-specific components
├── pages/              # Route components
├── hooks/              # Custom React hooks
├── lib/                # Utilities, helpers
│   ├── security/       # Security utilities
│   └── utils.ts        # General utilities
├── integrations/       # External service integrations
│   └── supabase/       # Supabase client, types
└── tests/              # Test files
    ├── hooks/          # Hook tests
    ├── pages/          # Page tests
    ├── security/       # Security tests
    └── mocks/          # Shared test mocks
```

### Import Order

```typescript
// 1. React imports
import { useState, useEffect } from "react";

// 2. External libraries
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// 3. Internal absolute imports
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// 4. Relative imports
import { ActivityCheckInForm } from "./ActivityCheckInForm";

// 5. Type imports (separate)
import type { ActivityCheckIn } from "@/types";
```

---

## 9. Data Privacy & Protection

### sensitive data Handling Rules

**sensitive-data includes:** names, emails, birthdates, addresses, SSN, medical records, IP addresses, biometric data

```typescript
// ✅ SPRÁVNĚ - Redacted logging
import { safeError } from "@/lib/security/safeLogger";

console.error("Failed to load check-in", { 
  error: safeError(error),
  timestamp: new Date().toISOString()
});

// ❌ ŠPATNĚ - sensitive data exposure
console.error("Failed to load check-in for user@email.com", error);
```

### Data Minimization

```typescript
// ✅ SPRÁVNĚ - Pouze potřebná pole přes RPC
const { data } = await supabase.rpc("get_user_summary", {
  p_client_id: userId
});
// Vrací pouze: id, display_name, last_check_in_date

// ❌ ŠPATNĚ - Fetching všech polí
const { data } = await supabase
  .from("profiles")
  .select("*")
  .eq("id", userId)
  .single();
```

### Consent Verification

```typescript
// Always check consent before processing sensitive-data
async function accessUserData(userId: string, partnerId: string) {
  const { data: consent } = await supabase.rpc("check_data_sharing_consent", {
    p_client_id: userId,
    p_partner_id: partnerId,
  });

  if (!consent?.has_consent) {
    throw new Error("User has not granted data sharing consent");
  }

  // Now safe to access user data
  return supabase.rpc("get_user_health_summary_audited", {
    p_client_id: userId
  });
}
```

---

## 10. Performance Standards

| Metrika | Cíl |
|---------|-----|
| **Initial load (LCP)** | < 3 sekundy |
| **Time to Interactive** | < 5 sekund |
| **Bundle size** | < 500KB (gzipped) |
| **API responses (p95)** | < 200ms |

### Optimization Checklist

✅ **Implementuj:**
- React Query caching (5-minute default)
- Pagination pro seznamy (max 50 items)
- Lazy load routes s `React.lazy()`
- Optimize images (WebP, responsive sizes)
- `useMemo`/`useCallback` pro expensive computations

❌ **Vyhni se:**
- Fetch celých tabulek na klientu
- Render velkých seznamů bez virtualizace
- Synchronní heavy computations v render path

### React Query Configuration

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});
```

---

## 11. Deployment & CI/CD

### Pre-Deploy Checklist

- [ ] Všechny testy prochází (`npm run test:run`)
- [ ] Žádné TypeScript chyby (`npx tsc --noEmit`)
- [ ] Žádné console.log s sensitive-data
- [ ] RLS enabled na všech nových tabulkách
- [ ] Migration soubory otestovány lokálně
- [ ] Environment variables dokumentovány
- [ ] Security audit passed (`npm audit`)
- [ ] PR schváleno reviewerem

### Environment Variables

```bash
# Required for all environments
VITE_AISHA_POSTGREST_URL=
VITE_AISHA_POSTGREST_ANON_KEY=

# Production only
VITE_SENTRY_DSN=
VITE_ANALYTICS_ID=

# Never commit these
AISHA_POSTGREST_SERVICE_KEY=
DATABASE_URL=
```

### CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm run test:run
      - run: npm run build
      - run: npm audit --audit-level=high
```

---

## 📚 Additional Resources

| Resource | URL |
|----------|-----|
| compliance Compliance Guide | https://www.hhs.gov/hipaa/index.html |
| OWASP Top 10 | https://owasp.org/www-project-top-ten/ |
| Supabase RLS Documentation | https://supabase.com/docs/guides/auth/row-level-security |
| security compliance Compliance | https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome |
| React Query Best Practices | https://tkdodo.eu/blog/react-query-best-practices |

---

## 🆘 Support & Questions

### Security Concerns or Incidents

1. Document v `/docs/incidents/YYYY-MM-DD-incident-name.md`
2. Notify security team immediately
3. Follow incident response procedures
4. Never discuss sensitive data exposure publicly

### Development Questions

- Check existing tests for examples
- Review similar components in codebase
- Consult team documentation v `/docs`
- Create draft PR for review

---

*Dokument vytvořen: 20. prosince 2025*  
*Další revize: Při změně standardů nebo security modelu*

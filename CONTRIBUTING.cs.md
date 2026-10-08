# Contributing to Platform

**Verze:** 2.1 | **Datum:** 7. června 2026

---

## 📜 Licence a CLA

- Kód v tomto repozitáři je licencován pod **Elastic License 2.0** (viz [LICENSE](LICENSE)).
  Smíš ho používat, upravovat, šířit i nasazovat u klientů; nesmíš ho nabízet třetím
  stranám jako hostovanou/managed službu — tu provozuje Evymo.
- Příspěvky přijímáme pod lehkým **CLA** (viz [CLA.md](CLA.md)): copyright si necháváš,
  Evymu dáváš licenci včetně práva na re-licencování (umožňuje dual-licensing a provoz
  placené služby). Souhlas vyjádříš trailerem `Signed-off-by` (`git commit -s`).
- Hostovaná nadstavba (interní modely, vyhodnocení & routing) není součástí repa ani
  licence. Celkový model: [docs/LICENSING_INTENT.md](docs/LICENSING_INTENT.md).

---

## ⚠️ Kritický Kontext

**Toto je PRODUKČNÍ production aplikace s reálnými sensitive data daty.**

| Aspekt | Hodnota |
|--------|---------|
| **Data** | Reálná sensitive data (sensitive data) |
| **Prostředí** | Produkce s aktivními uživateli |
| **Compliance** | compliance, SOC 2, OWASP Top 10 |
| **Kvalita** | Nejvyšší standard, žádné kompromisy |

---

## 🚀 Quick Start

```bash
# 1. Klonování a instalace
git clone <repo-url>
cd platform
npm install

# 2. Lokální vývoj
npm run dev

# 3. POVINNÉ před každým push
npm run test:run && npm run build
```

---

## 📋 Povinný Checklist před PR

### Technické požadavky

- [ ] `npm run test:run` — všechny testy prochází (4500+)
- [ ] \`npm run build\` — build úspěšný bez chyb
- [ ] \`npx tsc --noEmit\` — žádné TypeScript chyby
- [ ] \`npm audit\` — žádné kritické zranitelnosti

### CI: GitHub Actions a lokální běh

CI běží v **GitHub Actions** (`.github/workflows/`) na runnerech hostovaných GitHubem — žádný
soukromý runner, registr ani forge. Slití do `main` visí na jediné kontrole `PR: verdikt`.
Nasazení (Coolify), publikace balíčků a kiosku i plánované aktualizace závislostí jsou **opt-in**:
běží jen v repu, které je nakonfiguruje (proměnné `APP_NAME_PREFIX`, `VERDACCIO_URL`,
`KIOSK_REGISTRY_REPO`, …); jinde se přeskočí.

Každá dráha jde spustit **lokálně bez forge** — tabulka příkazů je v
[CONTRIBUTING.md › Running the CI lanes locally](CONTRIBUTING.md#running-the-ci-lanes-locally)
(`npm run test:run`, `npm run test:gates`, `npm run test:scripts`, `npm run test:services`,
`npm run test:db`, …).

### CI: Dependency security scan

Těžké skenery dodavatelského řetězce běží ve workflow `.github/workflows/supply-chain.yml`
(ruční spuštění kdykoli; noční běh je opt-in proměnnou `HEAVY_LANE_NIGHTLY=true`):

1. `npm audit --audit-level=high` (kořen blokuje, služby zatím jen hlásí)
2. OSV scan všech lockfilů, SBOM (CycloneDX) a Trivy (SARIF do záložky Security)

Lokálně: `npm audit --audit-level=high`.
Pipeline **selže**, pokud audit kořene najde zranitelnost se závažností **high** nebo **critical**.

#### Jak řešit audit findings

1. Oprav zranitelnost aktualizací přímé závislosti (`npm update <pkg>` nebo cílený bump ve `package.json`).
2. Pokud jde o transitivní závislost, použij kompatibilní upgrade parent balíčku nebo `overrides` v `package.json`.
3. Ověř změnu příkazy `npm ci`, `npm audit --audit-level=high`, relevantní testy a `npm run build`.
4. V PR popisu uveď:
   - dotčené balíčky/CVE
   - způsob mitigace
   - potvrzení, že audit je čistý

#### Výjimky (dočasné)

Výjimka je přípustná pouze dočasně, když fix není dostupný upstream.

- Založ issue s CVE/advisory odkazem, dopadem, scope a plánem odstranění.
- Přidej do PR odkaz na issue a zdůvodnění, proč není okamžitý upgrade možný.
- Definuj expiraci výjimky (konkrétní datum) a odpovědnou osobu.
- I při výjimce preferuj kompenzační opatření (feature flag, omezení attack surface, monitoring).

### Security požadavky

- [ ] Žádné \`.select("*")\` pro sensitive data tabulky
- [ ] Žádné přímé \`.from()\` dotazy na sensitive data tabulky → pouze RPC
- [ ] RPC funkce pro sensitive data mají \`_audited\` suffix
- [ ] Žádné sensitive data v console.log nebo error messages
- [ ] Nové tabulky mají RLS enabled + policies
- [ ] Nové Edge Functions mají rate limiting

### Code Quality

- [ ] TypeScript bez \`any\` typů
- [ ] Zod validace pro externí data
- [ ] Error handling s \`safeError()\` pro sensitive data
- [ ] Testy pokrývají success i error paths

---

## 🏗️ Architektonické Principy

### RPC-Only Pattern (POVINNÉ pro sensitive data)

\`\`\`typescript
// ✅ SPRÁVNĚ - RPC s auditem
const { data } = await aisha.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});

// ❌ ŠPATNĚ - Přímý dotaz (ZAKÁZÁNO pro sensitive data)
const { data } = await aisha.from("health_check_ins").select("*");
\`\`\`

**Proč RPC-only:**
- Automatický audit log pro každý sensitive data přístup
- Explicitní sloupce (žádný overfetch)
- Business logic v DB, ne v klientu
- Double security: RLS + function authorization

### Dynamic Permissions

\`\`\`typescript
// ✅ SPRÁVNĚ - Dynamické permissions
const { hasPermission } = usePermissions();
if (hasPermission("view_sensitive_data")) { /* ... */ }

// ❌ ŠPATNĚ - Hardcoded role check
if (userRole === "admin") { /* ... */ }
\`\`\`

### Safe Logging

\`\`\`typescript
// ✅ SPRÁVNĚ - Bezpečné logování
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));

// ❌ ŠPATNĚ - sensitive data v logu
console.error(\`Failed for user \${email}:\`, error);
\`\`\`

---

## 🔒 Security Standards

### sensitive data (sensitive data)

**sensitive data zahrnuje:** jména, emaily, data narození, adresy, SSN, zdravotní záznamy, IP adresy, biometrická data

⛔ **NIKDY nelogovat:**
- Emaily, jména, adresy
- Zdravotní data (pain_level, blood_pressure, medications)
- Obsah zpráv/poznámek
- Session tokeny, hesla

✅ **Povoleno logovat:**
- IDs (user_id, record_id) - anonymní identifikátory
- Typy akcí (action_type, consent_type)
- Metadata (limit, offset, count)
- Timestamps

### OWASP Top 10 Checklist

| Riziko | Ochrana |
|--------|---------|
| **Injection** | Supabase parametrizované dotazy, Zod validace |
| **Broken Auth** | Supabase Auth + MFA, 30min sensitive data session timeout |
| **Sensitive Data Exposure** | TLS 1.2+, encrypted at rest, no sensitive data in logs |
| **XXE** | Zod validace JSON, no XML processing |
| **Broken Access Control** | RLS policies + RPC authorization + audit |
| **Security Misconfig** | Strict TypeScript, CSP headers, npm audit |
| **XSS** | React auto-escape, DOMPurify pro rich text |
| **Insecure Deserialization** | Zod schema validation |
| **Vulnerable Components** | npm audit, Snyk scanning |
| **Insufficient Logging** | audit_journal pro všechny sensitive data přístupy |

### RLS Policy Template

\`\`\`sql
-- Každá nová tabulka MUSÍ mít:
CREATE TABLE new_table (...);
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Základní policies
CREATE POLICY "Users can read own data" ON new_table
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data" ON new_table
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON new_table
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin policy (používá helper function)
CREATE POLICY "Admins can read all" ON new_table
  FOR SELECT USING (is_admin_or_staff(auth.uid()));
\`\`\`

---

## 📝 Code Standards

### TypeScript

\`\`\`typescript
// ✅ SPRÁVNĚ - Explicitní typy, null handling
interface HealthCheckIn {
  id: string;
  user_id: string;
  pain_level: number | null;
  energy_level: number | null;
}

async function getCheckIn(id: string): Promise<HealthCheckIn | null> {
  const { data, error } = await aisha.rpc("get_check_in", { p_id: id });
  if (error) throw error;
  return data;
}

// ❌ ŠPATNĚ - any typy, no null handling
async function getCheckIn(id: any): Promise<any> {
  const { data } = await aisha.from("health_check_ins").select("*");
  return data;
}
\`\`\`

### Zod Validace

\`\`\`typescript
import { z } from "zod";

// Definuj schema
const healthCheckInSchema = z.object({
  pain_level: z.number().min(0).max(10).nullable(),
  energy_level: z.number().min(0).max(10).nullable(),
  notes: z.string().max(1000).optional(),
});

// Validuj před DB operací
const validated = healthCheckInSchema.parse(formData);
\`\`\`

### React Hooks

\`\`\`typescript
// Custom hook s RPC
export function useMyFeature() {
  const { user } = useSession();
  
  return useQuery({
    queryKey: ["my-feature", user?.id],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_feature", {
        p_user_id: user?.id,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minut cache
  });
}
\`\`\`

### Error Boundaries pro sensitive data

\`\`\`tsx
<ErrorBoundary fallback={<ErrorFallback />}>
  <sensitive dataComponent />
</ErrorBoundary>
\`\`\`

---

## � Internacionalizace (i18n)

**Všechny uživatelské texty MUSÍ jít přes i18n:**

\`\`\`typescript
// ✅ SPRÁVNĚ - Přes překlady
const { t } = useTranslation();
<Button>{t("common.save")}</Button>

// ❌ ŠPATNĚ - Hardcoded string (ZAKÁZÁNO)
<Button>Save</Button>
\`\`\`

Jazykové soubory: \`src/i18n/locales/{cs,en}.json\`

---

## �🎨 Naming Conventions

| Typ | Konvence | Příklad |
|-----|----------|---------|
| **Komponenty** | PascalCase | \`HealthCheckInForm.tsx\` |
| **Hooks** | camelCase + use | \`useHealthTracking.ts\` |
| **Utilities** | camelCase | \`formatHealthData.ts\` |
| **Constants** | SCREAMING_SNAKE | \`MAX_PAIN_LEVEL\` |
| **Types/Interfaces** | PascalCase | \`HealthCheckIn\` |
| **DB tabulky** | snake_case | \`health_check_ins\` |
| **RPC funkce** | snake_case + _audited | \`get_check_ins_audited\` |

### Import Order

\`\`\`typescript
// 1. React
import { useState, useEffect } from "react";

// 2. External libraries
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// 3. Internal absolute
import { aisha } from "@/integrations/db/client";
import { useAuth } from "@/hooks/useAuth";

// 4. Relative
import { MyComponent } from "./MyComponent";

// 5. Types (separate)
import type { HealthCheckIn } from "@/types";
\`\`\`

---

## 🧪 Testing Standards

### Test Structure

\`\`\`typescript
describe("useMyFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return data via RPC on success", async () => {
    // Arrange - Mock RPC
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: mockData,
      error: null,
    });

    // Act - Render hook
    const { result } = renderHook(() => useMyFeature());

    // Assert
    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });
  });

  it("should handle errors without exposing sensitive data", async () => {
    // Arrange
    vi.mocked(aisha.rpc).mockResolvedValue({
      data: null,
      error: { message: "DB error" },
    });

    // Act
    const { result } = renderHook(() => useMyFeature());

    // Assert - Error neobsahuje sensitive data
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).not.toContain("email");
    });
  });
});
\`\`\`

### Co testovat

✅ **VŽDY testuj:**
- Success path s validními daty
- Error handling (network errors, auth errors, validation errors)
- Loading states
- Empty states
- RLS policy enforcement (různé user kontexty)
- Permission checks

❌ **NETESTUJ:**
- Implementační detaily (internal state)
- React komponenty místo hooků
- Real API calls v unit testech

### Test Commands

\`\`\`bash
npm run test:run       # Všechny testy (4500+)
npm run test:coverage  # S coverage reportem
npm run test:run src/tests/hooks/useAuth.test.ts  # Specifický soubor
npm test               # Watch mode
\`\`\`

---

## 📊 Performance Standards

| Metrika | Cíl |
|---------|-----|
| **Initial Load (LCP)** | < 3 sekundy |
| **Time to Interactive** | < 5 sekund |
| **Bundle Size** | < 500KB (gzipped) |
| **API Response (p95)** | < 200ms |

### Optimalizace Checklist

✅ **Implementuj:**
- React Query caching (5min default)
- Pagination pro seznamy (max 50 položek)
- Lazy loading routes (\`React.lazy()\`)
- Optimalizované obrázky (WebP, responsive)
- \`useMemo\`/\`useCallback\` pro drahé výpočty

❌ **Vyhni se:**
- Fetch celých tabulek na klientu
- Render velkých seznamů bez virtualizace
- Synchronní heavy computations v renderu

---

## 🚀 Deployment

### RAG & Ragnarok Development

Ragnarok (Alquist Insight) je RAG engine integrovaný jako Git submodul v `packages/insight/`.

#### Lokální spuštění

```bash
# Start Ragnarok + Elasticsearch (součást docker compose)
npm run infra:up

# Nebo manuálně jen RAG stack
docker compose -f docker-compose.local.yml up elasticsearch ragnarok -d
```

**Lokální endpointy:**
- Ragnarok API: `http://localhost:9696`
- Elasticsearch: `http://localhost:9200`
- Admin UI: `http://localhost:5173/admin/ragnarok-kb`

#### Upload test dokumentu

```bash
# Přes curl
curl -X POST http://localhost:57421/functions/v1/ragnarok-upload \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -F "file=@test-document.pdf" \
  -F "project_id=test-project"

# Nebo přes Admin UI → Ragnarok KB → Upload
```

#### Testování Ragnarok Agent (n8n)

1. Spusťte n8n lokálně (`http://localhost:5678`)
2. Importujte `n8n/workflows/WF_RAGNAROK_AGENT.json`
3. Aktivujte workflow
4. Test: `POST http://localhost:5678/webhook/ragnarok-agent` s `{ "query": "..." }`

#### Edge Function endpoints

| Endpoint | Metoda | Popis |
|----------|--------|-------|
| `/functions/v1/ragnarok-search` | POST | Hledání v Ragnarok KB |
| `/functions/v1/ragnarok-upload` | POST | Upload/delete dokumentů |

#### MCP Tool

`search_ragnarok` — dostupný přes MCP Knowledge Server. Volá `ragnarok-search` edge function, která proxyuje na Ragnarok API.

### Pre-Deploy Checklist

- [ ] Všechny testy prochází
- [ ] TypeScript bez chyb
- [ ] Žádné console.log s sensitive data
- [ ] RLS na všech nových tabulkách
- [ ] Migrace otestovány lokálně
- [ ] Environment variables dokumentovány
- [ ] npm audit passed

### Environment Variables

\`\`\`bash
# Required (všechna prostředí)
VITE_AISHA_POSTGREST_URL=
VITE_AISHA_POSTGREST_ANON_KEY=

# Production only
VITE_SENTRY_DSN=
VITE_ANALYTICS_ID=

# NIKDY necommitovat
AISHA_POSTGREST_SERVICE_KEY=
DATABASE_URL=
\`\`\`

---

## 📚 Dokumentace

| Dokument | Účel |
|----------|------|
| [AGENTS.md](AGENTS.md) | Quick reference pro AI asistenty |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | RPC-only, Audit, Role, Permissions |
| [docs/DEVELOPMENT_GUIDELINES.md](docs/DEVELOPMENT_GUIDELINES.md) | Detailní vývojové standardy |
| [docs/security/SECURITY.md](docs/security/SECURITY.md) | Security patterns a hardening |
| [docs/security/RLS_POLICY_DOCUMENTATION.md](docs/security/RLS_POLICY_DOCUMENTATION.md) | SOC 2 RLS dokumentace |
| [docs/tasks/](docs/tasks/) | Backlog úkolů |

---

## 🆘 Podpora

### Security Incidenty

1. Dokumentuj v \`/docs/incidents/YYYY-MM-DD-incident-name.md\`
2. Notifikuj security team okamžitě
3. Následuj incident response procedury
4. NIKDY nediskutuj sensitive data exposure veřejně

### Vývojové Dotazy

1. Zkontroluj existující testy pro příklady
2. Projdi podobné komponenty v codebase
3. Konzultuj dokumentaci v \`/docs\`
4. Vytvoř PR s draft pro review

---

## 💎 Filozofie Kvality

**Stavíme světovou production technologii. Každý řádek kódu je důležitý.**

### Naše Standardy

- **Production-first** — Každý feature jde přímo do produkce
- **Security-by-design** — Bezpečnost je built-in, ne added later
- **Test-driven** — Testy dokazují, že kód funguje
- **User-centric** — Každý feature slouží zdraví uživatelů
- **Data integrity** — Výzkumná data vyžadují nejvyšší přesnost

### Proč to záleží

- Uživatelé nám svěřují nejcitlivější zdravotní informace
- Výzkumníci závisí na našich datech pro klinické studie
- Compliance selhání = shutdown platformy
- Security breach = poškození uživatelů a ztráta důvěry

**Nestavíme demo ani MVP. Stavíme production infrastrukturu, na které závisí lidské zdraví.**

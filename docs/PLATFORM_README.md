# Platform

<div align="center">

**Production výzkumná platforma pro imunologické studie**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://react.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red)]()

</div>

---

## 📋 Přehled

Platform je produkční production platforma zaměřená na **reInvented Immunology** — inovativní přístup k imunologickému výzkumu. Platforma umožňuje:

- 🔬 **Výzkumné studie** — Správa a účast v klinických studiích
- 📊 **Health tracking** — Denní sledování zdravotního stavu (check-ins)
- 🧪 **Lab results** — Správa laboratorních výsledků
- 👥 **Partner ekosystém** — Propojení pacientů s production providery
- 🛒 **E-shop** — Prodej produktů s integrací Stripe a Zásilkovna
- 📱 **Mobile API** — REST API pro mobilní aplikace

## ⚠️ Kritický kontext

| Aspekt | Hodnota |
|--------|---------|
| **Data** | Reálná PHI (Protected Health Information) |
| **Prostředí** | Produkce s aktivními uživateli |
| **Compliance** | HIPAA, SOC 2, OWASP Top 10 |
| **Kvalita** | Nejvyšší standard, žádné kompromisy |

---

## 🚀 Quick Start

### Prerekvizity

- Node.js 22+ ([nvm](https://github.com/nvm-sh/nvm))
- Docker Desktop (pro lokální Supabase)
- Git

### Instalace

```bash
# Klonování
git clone https://github.com/evymo/platform.git
cd platform

# Instalace závislostí
npm install

# Kopírování .env
cp .env.example .env
# Vyplň VITE_AISHA_POSTGREST_URL, VITE_AISHA_POSTGREST_PUBLISHABLE_KEY atd.
```

### Lokální vývoj

```bash
# Spuštění lokální Supabase + migrací + seedu
npm run db:bootstrap:local

# Spuštění dev serveru proti lokální Supabase (doporučeno)
npm run dev:local

# Nebo jen dev server (proti remote Supabase)
npm run dev
```

### Testování

```bash
# POVINNÉ před každým push
npm run test:run && npm run build

# E2E testy (Playwright)
npm run test:e2e:local

# S coverage
npm run test:coverage
```

---

## 🏗️ Architektura

### Tech Stack

| Vrstva | Technologie |
|--------|-------------|
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui |
| **Backend** | Supabase (PostgreSQL, Auth, Edge Functions, Storage) |
| **Platby** | Stripe (Checkout, Webhooks, Subscriptions) |
| **Doprava** | Zásilkovna/Packeta API |
| **CI/CD** | GitHub Actions, Cloudflare Pages |
| **Monitoring** | Sentry |

### Klíčové principy

```
┌─────────────────────────────────────────────────────────────┐
│  RPC-ONLY ARCHITEKTURA                                      │
│                                                             │
│  ✅ supabase.rpc("get_my_health_check_ins_audited", {...}) │
│                                                             │
│  ❌ supabase.from("health_check_ins").select("*")          │
│                                                             │
│  Výhody:                                                    │
│  • Automatický audit log                                    │
│  • Explicitní sloupce (žádný overfetch)                    │
│  • Business logic v DB                                      │
│  • Double security: RLS + function authorization           │
└─────────────────────────────────────────────────────────────┘
```

### Security Layers

1. **Network** — HTTPS, CSP headers, CORS whitelist
2. **Authentication** — Supabase Auth (JWT), MFA
3. **Authorization** — Dynamic RBAC (50+ permissions)
4. **Row Level Security** — RLS policies na všech tabulkách
5. **RPC Functions** — SECURITY DEFINER s auditem
6. **PHI Mode** — Re-autentizace pro přístup k citlivým datům
7. **Audit Trail** — Všechny PHI přístupy logované

---

## 👥 Uživatelské role

| Role | Popis | PHI přístup |
|------|-------|-------------|
| `admin` | Plný přístup k systému | ✅ Plný |
| `staff` | Operační tým | ✅ Read-only |
| `practitioner` | Production provider / Partner | ✅ S consenty |
| `member` | Běžný uživatel platformy | Vlastní data |
| `evaluator` | Hodnotitel studií | ❌ |

### Demo přihlašovací údaje (lokální vývoj)

| Role | Email | Heslo |
|------|-------|-------|
| Admin | `admin@platform.app` | `Admin123!` |
| Member | `member@platform.app` | `Member123!` |
| Partner | `partner@platform.app` | `Partner123!` |

⚠️ **V produkci IHNED změňte hesla!**

---

## 📁 Struktura projektu

```
platform/
├── src/
│   ├── components/       # React komponenty
│   │   ├── ui/          # shadcn/ui primitives
│   │   ├── admin/       # Admin panel
│   │   ├── member/      # Member portal
│   │   └── partner/     # Partner dashboard
│   ├── pages/           # Route komponenty
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utility funkce
│   │   └── security/    # Security utilities (safeLogger, etc.)
│   ├── integrations/    # External services
│   │   └── supabase/    # Supabase client, types
│   └── i18n/            # Internationalization (CS, EN)
├── supabase/
│   ├── functions/       # Edge Functions (Deno)
│   ├── migrations/      # SQL migrace
│   ├── sql/             # SQL sources (functions, policies, etc.)
│   ├── seed.sql         # Produkční seed
│   └── seed.e2e.sql     # E2E test seed
├── e2e/                 # Playwright E2E testy
├── scripts/             # Build & utility skripty
├── docs/                # Dokumentace
└── public/              # Static assets
```

---

## 🧪 Testování

### Unit testy (Vitest)

```bash
npm run test:run           # Všechny testy (1000+)
npm run test:coverage      # S coverage reportem
npm run test:run -- path   # Specifický soubor
```

### E2E testy (Playwright)

```bash
npm run test:e2e:local     # Kompletní E2E suite
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:debug     # Debug mode
```

### Očekávané výsledky

| Metrika | Hodnota |
|---------|---------|
| Unit testy | 1000+ passing |
| E2E testy | 100+ scenarios |
| TypeScript | 0 chyb |
| ESLint | 0 chyb |
| Build | Úspěšný |

---

## 🔧 NPM skripty

| Příkaz | Účel |
|--------|------|
| `npm run dev` | Spustit dev server |
| `npm run dev:local` | Dev server + lokální Supabase |
| `npm run build` | Produkční build + TypeDoc |
| `npm run test:run` | Spustit unit testy |
| `npm run test:e2e:local` | Spustit E2E testy |
| `npm run db:bootstrap:local` | Setup lokální DB |
| `npm run db:migrate:local` | Aplikovat migrace |
| `npm run db:seed:local` | Seedovat testovací data |
| `npm run db:types:gen:local` | Generovat TypeScript typy |
| `npm run lint` | ESLint kontrola |
| `npm run i18n:check` | Kontrola překladů |

---

## 🌐 Internacionalizace

Aplikace podporuje více jazyků:

- 🇨🇿 Čeština (výchozí)
- 🇬🇧 Angličtina
- 🇩🇪 Němčina
- 🇫🇷 Francouzština
- 🇷🇺 Ruština
- 🇹🇭 Thajština

```typescript
// Použití v kódu
const { t } = useTranslation();
<Button>{t("common.save")}</Button>
```

Jazykové soubory: `src/i18n/locales/{cs,en,de,fr,ru,th}.json`

---

## 🔐 Bezpečnost

### PHI (Protected Health Information)

⛔ **NIKDY nelogovat:**
- Emaily, jména, adresy
- Zdravotní data
- Session tokeny

✅ **Povoleno logovat:**
- IDs (user_id, record_id)
- Typy akcí
- Timestamps

### Příklad bezpečného kódu

```typescript
// ✅ SPRÁVNĚ - RPC s auditem
const { data } = await supabase.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});

// ✅ SPRÁVNĚ - Bezpečné logování
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));

// ❌ ŠPATNĚ - PHI v logu
console.error(`Failed for ${email}:`, error);
```

---

## 📚 Dokumentace

| Dokument | Popis |
|----------|-------|
| [AGENTS.md](AGENTS.md) | Instrukce pro AI asistenty |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guide pro přispěvatele |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | RPC-only, Audit, Role |
| [docs/DEVELOPMENT_GUIDELINES.md](docs/DEVELOPMENT_GUIDELINES.md) | Vývojové standardy |
| [docs/security/SECURITY.md](docs/security/SECURITY.md) | Security patterns |
| [docs/security/RLS_POLICY_DOCUMENTATION.md](docs/security/RLS_POLICY_DOCUMENTATION.md) | SOC 2 RLS dokumentace |

### API dokumentace

```bash
npm run docs:build    # Generuje TypeDoc do docs/api/
```

---

## 🚢 Deployment

### Environment Variables

```bash
# Required
VITE_AISHA_POSTGREST_URL=https://xxx.supabase.co
VITE_AISHA_POSTGREST_PUBLISHABLE_KEY=eyJ...

# Optional
VITE_SENTRY_DSN=https://...
VITE_PUBLIC_SITE_URL=https://app.example.com
```

### Secrets (pro E2E/Edge Functions)

Secrets se NECOMMITUJÍ do gitu. Nastavují se:
- **Lokálně**: v `.env` souboru
- **CI**: GitHub Secrets
- **Produkce**: Admin UI → set_api_key_admin() RPC

Potřebné secrets:
- `OPENAI_API_KEY` — AI funkce
- `STRIPE_TEST_SECRET_KEY` — Platby
- `PACKETA_API_KEY` / `PACKETA_API_PASSWORD` — Doprava

### SEO

Po `npm run build` se automaticky generují:
- `dist/robots.txt`
- `dist/sitemap.xml`

Nastavení: `PUBLIC_SITE_URL` nebo `VITE_PUBLIC_SITE_URL`

---

## 📋 Checklist před PR

- [ ] `npm run test:run` — všechny testy prochází
- [ ] `npm run build` — build úspěšný
- [ ] Žádné `.select("*")` pro PHI tabulky
- [ ] Nové RPC funkce mají `_audited` suffix
- [ ] Žádné PHI v logách
- [ ] Nové tabulky mají RLS
- [ ] TypeScript bez `any`

---

## 🤝 Přispívání

1. Přečti si [CONTRIBUTING.md](CONTRIBUTING.md)
2. Vytvoř feature branch
3. Napiš testy
4. `npm run test:run && npm run build`
5. Otevři PR

---

## 📄 Licence

Proprietary. © 2025 RTN. Všechna práva vyhrazena.

---

<div align="center">

**Platform** — Production výzkumná platforma

[Dokumentace](docs/ARCHITECTURE.md) · [Architektura](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

</div>

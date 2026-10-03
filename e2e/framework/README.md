# E2E Testing Framework

> Odděluje **CO** testujeme (data v registru) od **JAK** testujeme (šablony).  
> Novou stránku otestuješ přidáním jednoho řádku do `registry.ts`.

## Architektura

```
e2e/framework/
├── registry.ts          # CO — všechny routy, RBAC pravidla, CRUD scénáře
├── templates.ts         # JAK — generátory testů (route load, RBAC, CRUD, smoke, API)
├── helpers.ts           # Utility — navigace, assertions, formuláře, screenshoty
├── coverage-gate.test.ts # AISHA — gate test pro detekci netestovaných rout
└── index.ts             # Barrel export
```

## Jak přidat test pro novou stránku

### 1. Route Load Test (nejčastější)

Přidej entry do `registry.ts`:

```ts
// registry.ts → ADMIN_ROUTES
{ title: 'Nová Stránka', url: '/admin/nova-stranka', role: 'admin', category: 'admin-content' },
```

Hotovo. `admin-routes.generated.spec.ts` ji automaticky otestuje.

### 2. RBAC Test (přístupová kontrola)

Přidej pravidlo do `registry.ts`:

```ts
// registry.ts → RBAC_RULES
{ url: '/admin/nova-stranka', role: 'member', expect: 'deny' },
{ url: '/admin/nova-stranka', role: 'anonymous', expect: 'redirect-auth' },
```

### 3. Nový spec soubor pro komplexní flow

```ts
// e2e/my-feature.spec.ts
import { test, expect } from '@playwright/test';
import { navigateAndAssert, expectTable, expectHeading } from './framework';

test.use({ storageState: 'e2e/.auth/admin.json' });

test.describe('My Feature', () => {
  test('shows data table', async ({ page }) => {
    await navigateAndAssert(page, '/admin/my-feature');
    await expectTable(page);
    await expectHeading(page, /My Feature/i);
  });
});
```

### 4. API Health Test

```ts
import { generateApiHealthTests } from './framework';

generateApiHealthTests([
  { title: 'Supabase REST', url: 'http://127.0.0.1:57421/rest/v1/' },
  { title: 'Custom API', url: 'http://127.0.0.1:3000/api/health' },
]);
```

## Generované spec soubory

| Soubor | Popis | Zdroj dat |
|--------|-------|-----------|
| `admin-routes.generated.spec.ts` | Všechny admin routy se načtou | `ADMIN_ROUTES` |
| `member-routes.generated.spec.ts` | Všechny member routy se načtou | `MEMBER_ROUTES` |
| `partner-routes.generated.spec.ts` | Všechny partner routy se načtou | `PARTNER_ROUTES` |
| `public-smoke.generated.spec.ts` | Veřejné stránky jsou dostupné | `PUBLIC_ROUTES` |
| `rbac.generated.spec.ts` | Přístupová pravidla fungují | `RBAC_RULES` |

## AISHA Coverage Gate

`coverage-gate.test.ts` běží jako Vitest gate test a:

1. **Porovnává** registry s `adminNavConfig.ts` — hlásí chybějící admin routy
2. **Skenuje** spec soubory — hledá routy, které nikdo netestuje
3. **Měří** pokrytí — % registrovaných rout přítomných v testech
4. **Reportuje** návrhy pro AISHA — které routy přidat jako další

### Jak AISHA navrhuje nové testy

Při každém `npm run test:gates` se vypíše:
```
🤖 AISHA Test Proposal — 5 registered routes not found in any spec file:
  ❌ /member/calendar
  ❌ /member/assessment
  ❌ /partner/templates
  ...

💡 Consider generating tests for these routes using:
   generateRouteLoadTests([...], { storageState: "..." })
```

AISHA pak může:
1. Přidat chybějící routy do existujících `.generated.spec.ts`
2. Vytvořit nový doménový spec (e.g. `calendar.spec.ts`)
3. Navrhnout CRUD/flow testy pro stránky s tabulkami

## Konvence

- `*.generated.spec.ts` — plně generované z dat (nikdy needituj ručně)
- `*.spec.ts` — ruční testy pro specifické flows
- `framework/registry.ts` — edituj pro přidání rout
- `framework/templates.ts` — edituj pro přidání nových vzorů
- `framework/helpers.ts` — edituj pro utility funkce

## Šablony (Templates)

| Template | Účel |
|----------|------|
| `generateRouteLoadTests()` | Route se načte, žádná 404, viditelný obsah |
| `generateRbacTests()` | Role má/nemá přístup |
| `generateCrudListTests()` | List stránka s tabulkou + create button |
| `generateSmokeTests()` | Ultra-lehký test — HTTP 200 + obsah |
| `generateApiHealthTests()` | API endpoint odpovídá |

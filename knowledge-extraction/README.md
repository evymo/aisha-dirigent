# Knowledge Extraction — Frontend Development Foundation

> **Verze:** 1.0 | **Datum:** 19. února 2026  
> **Zdroj:** Extrahováno z produkčního projektu Platform

Tento adresář obsahuje **přenositelné znalosti** pro zahájení vývoje nové frontend webové (nebo mobilní) aplikace na stejném základu. Projekt komunikuje s existujícím API — neimplementujeme backend, pouze frontend.

---

## 📂 Obsah

| Soubor | Popis |
|--------|-------|
| [DEVELOPMENT_LAWS.md](./DEVELOPMENT_LAWS.md) | Základní "zákony" vývoje — co MUSÍ, co NESMÍ |
| [ARCHITECTURE_PATTERNS.md](./ARCHITECTURE_PATTERNS.md) | Strukturování projektu, vrstvy, odpovědnosti |
| [API_COMMUNICATION.md](./API_COMMUNICATION.md) | Jak komunikovat s API výhradně přes hooky |
| [HOOKS_PATTERNS.md](./HOOKS_PATTERNS.md) | Design hooků — šablony, konvence, Zod validace |
| [TESTING_PHILOSOPHY.md](./TESTING_PHILOSOPHY.md) | Co testovat, kdy, jak a proč — 4 úrovně testů |
| [CODE_QUALITY_GATES.md](./CODE_QUALITY_GATES.md) | CI gate testy, code hygiene, co musí projít |
| [SECURITY_STANDARDS.md](./SECURITY_STANDARDS.md) | Bezpečnost, sensitive data, logging, přihlášení |
| [NPM_RELEASE_SECURITY.md](./NPM_RELEASE_SECURITY.md) | NPM publish bezpečnost, kontext vs zásady pro AISHA orchestrace |
| [i18n_STANDARDS.md](./i18n_STANDARDS.md) | Internacionalizace — každý text přes překlady |
| [PROJECT_COMPLEXITY_TRACKING.md](./PROJECT_COMPLEXITY_TRACKING.md) | Sledování komplexity, task tracking, backlog |
| [COMMIT_WORKFLOW.md](./COMMIT_WORKFLOW.md) | Commity, PR workflow, pre-commit hook |
| [templates/copilot-instructions.md](./templates/copilot-instructions.md) | **Hotový template pro `.github/copilot-instructions.md`** |
| [templates/hook.template.ts](./templates/hook.template.ts) | Šablona pro nový hook |
| [templates/hook.test.template.ts](./templates/hook.test.template.ts) | Šablona pro test hooku |
| [templates/gate.test.template.ts](./templates/gate.test.template.ts) | Šablona pro gate test |

---

## 🎯 Jeden cíl tohoto adresáře

**Nasadit tyto znalosti do nového repo tak, aby AI asistenti (Copilot, Cursor, Claude) okamžitě pracovali na úrovni, jakou jsme vybudovali v produkci — bez opakování dětských chyb.**

### Dětské chyby, které eliminujeme:

- ❌ Přímé volání API z komponent (obejít — vždy hook)  
- ❌ `any` typ v TypeScriptu  
- ❌ Hardcoded texty v UI (obejít — vždy `t("key")`)  
- ❌ `console.log` v produkčním kódu  
- ❌ Chybějící Zod validace vstupu  
- ❌ Komponenty s >500 řádky (rozdělit)  
- ❌ Testy psané PŘED prozkoumáním implementace  
- ❌ Mock, který neodpovídá skutečné implementaci hooku  
- ❌ Commity s neprošlými testy  
- ❌ Emoji v UI místo ikon z icon library  
- ❌ `@ts-ignore` bez vysvětlujícího komentáře  

---

## 🚀 Quick Start pro nový projekt

```bash
# 1. Zkopíruj templates/ do nového projektu
cp knowledge-extraction/templates/copilot-instructions.md .github/copilot-instructions.md
# Uprav projekt-specifické sekce v copilot-instructions.md

# 2. Nastav pre-commit hook (viz COMMIT_WORKFLOW.md)

# 3. Nastav gate testy (viz CODE_QUALITY_GATES.md)
```

---

## 📐 Technologický základ (extrahováno z produkce)

| Technologie | Role | Proč |
|-------------|------|------|
| React + TypeScript | UI | Typová bezpečnost, ekosystém |
| Vite | Build | Rychlý dev server, HMR |
| TanStack Query (React Query) | Server state | Caching, retry, loading states |
| Zod | Validace | Runtime type safety |
| i18next | Překlady | Multi-locale, segment-based |
| Vitest | Testování | Rychlý, Vite-nativní |
| Playwright | E2E testy | Reálný browser, živé UI |
| ESLint + Prettier | Code quality | Konzistentní styl |
| Husky | Pre-commit | Brána pro push |
| Tailwind CSS | Styly | Utility-first, design tokens |
| lucide-react | Ikony | Žádné Unicode emoji |

---

## 🧠 Mentální model pro nový projekt

```
Komponenta
    │
    ▼  volá
  Custom Hook   ←── jediné místo API volání
    │
    ▼  přes
  API Client (fetch/axios/supabase)
    │
    ▼  do
  Backend API
```

Komponenta **nikdy** nevolá API přímo. Vždy přes hook.
Hook **nikdy** neobsahuje UI logiku. Jen data a akce.


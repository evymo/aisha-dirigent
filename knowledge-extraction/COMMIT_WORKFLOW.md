# Commit Workflow — Logické Celky, Čistá Historie

---

## Základní Filozofie

```
1 commit = 1 logický celek
```

**Ne:**  
- "fix stuff" (co přesně?)  
- "wip" (work in progress nepatří na main)  
- mega-commit s 50 soubory a 3 různými features  

**Ano:**  
- `feat: add useProducts hook with Zod validation`  
- `fix: useCart returns empty array instead of undefined on no items`  
- `test: add tests for useCreateOrder mutation`  

---

## Commit Message Format (Conventional Commits)

```
<type>(<scope>): <popis v angličtině>

[volitelný body — co a proč]

[volitelné BREAKING CHANGE]
```

### Typy:

| Typ | Kdy použít |
|-----|-----------|
| `feat` | Nová funkce |
| `fix` | Oprava chyby |
| `test` | Přidání/úprava testů |
| `refactor` | Refaktorování (bez změny chování) |
| `chore` | Maintenance (závislosti, konfigurace) |
| `docs` | Dokumentace |
| `style` | Formátování (bez změny logiky) |
| `perf` | Optimalizace výkonu |
| `ci` | CI/CD změny |

### Scope (volitelné):
`hooks`, `components`, `api`, `i18n`, `auth`, `products`, `checkout`, `admin`

### Příklady:

```
feat(hooks): add useProducts with category filter and Zod validation

fix(auth): handle expired JWT token with automatic refresh retry

test(hooks): add useCreateOrder mutation tests covering error paths

refactor(products): split ProductCard into ProductCardImage + ProductCardInfo

chore: update tanstack-query to v5.80.0

docs: add API_COMMUNICATION.md to knowledge-extraction
```

---

## Pre-Commit Hook (Husky)

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo "🔍 Pre-commit: TypeScript check..."
npx tsc --noEmit || exit 1

echo "🔍 Pre-commit: ESLint..."
npm run lint -- --max-warnings 0 || exit 1

echo "✅ Pre-commit checks passed"
```

```bash
# .husky/pre-push
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo "🧪 Pre-push: Running unit tests..."
npm run test:run || exit 1

echo "🏗️  Pre-push: Building..."
npm run build || exit 1

echo "✅ Pre-push checks passed"
```

```bash
# Instalace Husky
npm install --save-dev husky
npx husky init

# Přidej .husky/pre-commit a .husky/pre-push s obsahem výše
chmod +x .husky/pre-commit
chmod +x .husky/pre-push
```

---

## Workflow pro Netriviální Feature

```bash
# 1. Začni s čistým stavem
git status   # musí být clean
git pull     # nejnovější main

# 2. Implementuj schéma (Zod)
# ... edituj src/lib/schemas/product.ts
git add src/lib/schemas/product.ts
git commit -m "feat(schemas): add productSchema and createProductInputSchema"

# 3. Implementuj hook
# ... edituj src/hooks/useProducts.ts + do index.ts
git add src/hooks/useProducts.ts src/hooks/index.ts
git commit -m "feat(hooks): add useProducts with category filter"

# 4. Přidej test (HNED po implementaci!)
npm run test:run -- src/tests/hooks/useProducts.test.ts
git add src/tests/hooks/useProducts.test.ts
git commit -m "test(hooks): add useProducts tests covering error and empty states"

# 5. Implementuj komponentu
# ... edituj src/components/products/ProductList.tsx
git add src/components/products/
git commit -m "feat(components): add ProductList and ProductCard components"

# 6. Přidej i18n klíče
# ... edituj src/i18n/segments/en/products.json + cs/products.json
npm run i18n:compile
npm run i18n:check
git add src/i18n/
git commit -m "i18n: add products segment keys (en + cs)"

# 7. Ověř vše
npm run test:run
npm run test:gates
npm run build

# 8. Push
git push
```

---

## Kdy Commitovat

| Stav | Commitnout? |
|------|-------------|
| Implementace hotová, testy přidány a projdou | ✅ ANO |
| Implementace hotová, testy chybí | ❌ NE — přidej testy |
| Testy selhávají | ❌ NE — oprav |
| Partial implementation (WIP) | ❌ NE — sdílej jako draft PR |
| Refactor hotový, chování nezměněno | ✅ ANO (po ověření testů) |

---

## Squash vs Merge

```bash
# Pro feature branch merge do main:
# → Squash all commits to one atomic commit on main
# → Zachová clean main history

# Pro hotfix:
# → Přímý merge (1 commit)

# Pro long-running feature:
# → Rebase na main před merge (clean linear history)
```

---

## Klíčová Pravidla pro AI Asistenty

```
1. Dělej commity po dokončení logického celku, ne po každém souboru.
2. Než commitneš, ověř: testy projdou, lint OK, TypeScript OK.
3. Nikdy nepushuj aniž by prošel pre-push hook.
4. Commit message v angličtině, conventional commits formát.
5. Scope v závorce pokud relevantní: feat(hooks): ...
6. Po PR odsouhlasení s uživatelem → push.
7. Nezdržuj se buildem a testy během oprav — spusť vše NAJEDNOU na konci.
```

---

## Commit Checklist

```bash
# Před každým commitem (automatizováno přes pre-commit hook):
□  npx tsc --noEmit           # žádné TypeScript chyby
□  npm run lint               # žádné ESLint chyby

# Před pushem (automatizováno přes pre-push hook):
□  npm run test:run           # všechny unit testy procházejí
□  npm run build              # build úspěšný

# Volitelně pro velké změny:
□  npm run test:gates         # gate testy (architektura, hygiene)
□  npm run i18n:check         # překlady kompletní
```

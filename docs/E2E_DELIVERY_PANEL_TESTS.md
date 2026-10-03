# StoryLoop Delivery Panel E2E Tests — Dokumentace

## Přehled

Vytvořil jsem komplexní E2E test suite pro **StoryDeliveryPanel** s drag-and-drop editorem pro `project_preview`.

**Soubor:** `e2e/storyloop-delivery-panel.spec.ts`

## Testované scénáře

### 1. **Základní UI interakce**
- ✅ Story detail page renderuje delivery panel
- ✅ Delivery panel lze otevřít/zavřít (collapse/expand)

### 2. **Správa Goals (Cílů)**
- ✅ Přidání nového cílu (Add button)
- ✅ Editace existujícího cílu
- ✅ Smazání cílu z listu
- ✅ Drag-and-drop reordering cílů

### 3. **Správa Constraints (Omezení)**
- ✅ Přidání nového omezení
- ✅ Plná manage funkčnost jako goals

### 4. **Správa Success Criteria (Kritérií úspěchu)**
- ✅ Přidání nového kritéria
- ✅ Plná manage funkčnost jako goals

### 5. **Persistence & Storage**
- ✅ **Save Draft** — uloží data bez publikování
- ✅ **Publish** — publikuje kontekt (delivery_status změní)
- ✅ **Data persistence** — po reload stránky zůstanou data
- ✅ **Empty items filtering** — prázdné položky se neukládají

## Jak spustit testy

### Prerequisity

```bash
# 1. Spustiť local infrastrukturu
npm run infra:up:min

# 2. Spustiť Supabase
npm run supabase:start

# 3. Spustiť vývoj server
npm run dev

# 4. V jiném terminálu - spustiť migrations
npm run db:migrate:local
npm run db:seed:local
```

### Spuštění E2E testů

#### Lokálně (interactive mode)
```bash
npm run test:e2e:local
# nebo
npm run test:e2e:ui
```

#### Headless (CI/CD)
```bash
npm run test:e2e
```

#### Konkrétní test
```bash
npx playwright test e2e/storyloop-delivery-panel.spec.ts
npx playwright test e2e/storyloop-delivery-panel.spec.ts -g "Can add goals"
```

#### S debug režimem
```bash
npx playwright test e2e/storyloop-delivery-panel.spec.ts --debug
```

## Test struktura

Každý test:
1. **Login** — Přihlášení jako partner
2. **Navigation** — Otevření story detail
3. **Interaction** — Perform UI action (add, edit, drag, delete)
4. **Assertion** — Ověření výsledku
5. **Persistence** — Reload a ověření persistence (pokud relevantní)

## Výstup testů

Po spuštění tests budou v:
- Terminal — Live progress + summary
- HTML report — `playwright-report/index.html`
- Screenshots (on failure) — `test-results/`

## Co test ověřuje

### Frontend chování
```
✅ Drag-and-drop handlers viditelné
✅ Add/Remove buttons fungují
✅ Input fieldy editovatelné
✅ Tooltip/aria labels přítomny
✅ Loading states fungují (spin animation)
```

### Data flow
```
✅ Data fluuje z React state do form fields
✅ Save mutations volají RPC funkci
✅ Publish mění delivery_status v DB
✅ Refresh page načte data z `.aisha/story.json`
✅ Prázdné položky se filtrují
```

### UX/Accessibility
```
✅ Keyboard navigation (arrows, home/end)
✅ Visual feedback (dragging opacity, hover states)
✅ Error handling (toast notifications)
✅ Disabled states (button disabled during save)
```

## Očekávané výsledky

Pokud vše funguje správně:

```
✅ Story detail page renders with delivery panel 
✅ Can open and close delivery panel
✅ Can add goals to the list
✅ Can edit existing goal
✅ Can remove goal from list
✅ Can drag and drop goals to reorder
✅ Can add and manage constraints
✅ Can add and manage success criteria
✅ Can save draft without publishing
✅ Can publish preview
✅ Data persists after page reload
✅ Empty items are filtered on save

Test Files  1 passed (1)
Tests      12 passed (12)
```

## Troubleshooting

### Test timeout
```bash
# Zvětšit timeout
npm run test:e2e -- --timeout 60000
```

### Test padá na přihlášení
```bash
# Ověřit že fixture `loginUser` pracuje
# Viz e2e/fixtures.ts
```

### Drag-and-drop selhává
```bash
# Playwright drag API je pomalá
# Testy mají `await page.waitForTimeout(200)` mezi akcemi
# Zvýšit je v testu pokud je pomalý env
```

### DB není seeded
```bash
npm run db:seed:local
# Pak refresh testy
```

## Příští kroky

1. **CI Integration** — Přidat do GitHub Actions (.github/workflows/)
2. **Report tracking** — Archivovat playwright reports do artifacts
3. **Visual regression** — Přidat screenshot comparisons
4. **Performance** — Přidat metrics (interaction time, render time)
5. **Analytics** — Track failure patterns

## Zdravotní check — Co vlastně testujeme?

```
System Under Test:
├── Component: StoryDeliveryPanel.tsx
│   ├── State: [summary, goals, constraints, successCriteria]
│   ├── UI: Drag-and-drop lists + input fields
│   └── Actions: add, edit, remove, reorder, save, publish
│
├── Hook: useStoryDeliveryContext + useUpdateStoryProjectPreview
│   ├── Fetch: GET story context from RPC
│   ├── Mutate: POST project_preview update + publish flag
│   └── Cache: React Query invalidation
│
├── DB Layer: update_story_project_preview RPC function
│   ├── Validation: Zod schema + CHECK constraint
│   ├── Persistence: INSERT INTO partner_stories.project_preview
│   └── Audit: INSERT INTO audit_journal
│
└── File: .aisha/story.json
    └── Snapshot: Read by local CLI tools + editors
```

## Test Coverage Matrix

| Feature | Unit | Integration | E2E |
|---------|------|-------------|-----|
| Add item | ✅ mock | ✅ fixture | ✅ real |
| Edit item | ✅ mock | ✅ fixture | ✅ real |
| Remove item | ✅ mock | ✅ fixture | ✅ real |
| Drag-drop | ❌ N/A | ❌ N/A | ✅ real |
| Save draft | ✅ mock | ✅ fixture | ✅ real |
| Publish | ✅ mock | ✅ fixture | ✅ real |
| Persistence | ❌ N/A | ✅ DB | ✅ real |
| Empty filter | ✅ mock | ✅ fixture | ✅ real |

---

**Poznámka:** Pokud chceš testy urychlit, smaž testy které nejsou kritické (`Can open and close` je redundantní) a focusuj se na `Can add/edit/remove/save/publish`.

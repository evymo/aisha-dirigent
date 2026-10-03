# Skills: UI Quality & Code Hygiene Gates

> **Verze:** 1.0 | **Datum:** 8. února 2026

## Přehled gate testů

Gate testy jsou statické kontroly kódu, které běží bez DB připojení.
Spouštějí se přes `npx vitest run --config vitest.gates.config.ts src/tests/gates/`.

### Soubory

| Test | Počet | Popis |
|------|-------|-------|
| `ui-quality.gate.test.ts` | 12 | Emoji, icon lib, hardcoded CZ, barvy, a11y, komponenty |
| `code-hygiene.gate.test.ts` | 13 | console.log, any, ts-ignore, eslint-disable, soubor velikost, TODO, routing, require, dead code |
| `security.gate.test.ts` | 18 | sensitive-data/RLS/source-truth/flow/SQL bezpečnost |
| `production-build.gate.test.ts` | 35 | Migrace, funkce, RLS, policies, RPC parita, i18n, build config |
| `func-manager-parser.gate.test.ts` | 62 | Parser a rules func-manageru |
| `func-manager-validator.gate.test.ts` | 17 | Validátor func-manageru |
| `db-manager.gate.test.ts` | 18 | State, CLI, SQL adresáře |

---

## Skill: platform-no-emoji-in-ui

### Problém
Projekt používá emoji Unicode znaky (🇬🇧, ⚠️, ✅, 📈, 🎯...) místo lucide-react ikon.
Emoji se renderují **nekonzistentně** napříč OS, prohlížeči a zřízeními.

### Pravidlo
**Žádné emoji v produkčním UI kódu.** Vše přes `lucide-react` ikony.

### Jak opravit

```tsx
// ❌ ŠPATNĚ — emoji
<span>⚠️ Vyžaduje pozornost</span>
<span>{getTrendEmoji(direction)}</span> // 📈 📉 ➡️

// ✅ SPRÁVNĚ — lucide-react
import { AlertTriangle, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
<span><AlertTriangle className="h-4 w-4 text-yellow-500" /> {t("common.needsAttention")}</span>
<span>{direction === "improving" ? <TrendingUp /> : direction === "declining" ? <TrendingDown /> : <ArrowRight />}</span>
```

### Vlajky jazyků
```tsx
// ❌ ŠPATNĚ — emoji vlajky
const flagMap = { en: '🇬🇧', cs: '🇨🇿' };

// ✅ SPRÁVNĚ — SVG vlajky nebo text kódy
import { GB, CZ } from 'country-flag-icons/react/3x2'; // nebo custom SVG
// nebo jednodušeji:
<span className="text-xs uppercase font-mono">{lang.code}</span>
```

### Allowlist
`KNOWN_EMOJI_FILES` v `ui-quality.gate.test.ts` trackuje soubory s legacy emoji.
Čísla se smí **POUZE snižovat** (baseline 134).

### Spuštění
```bash
npx vitest run --config vitest.gates.config.ts src/tests/gates/ui-quality.gate.test.ts
```

---

## Skill: platform-i18n-hardcoded-strings

### Problém
Některé komponenty obsahují hardcoded české texty přímo v JSX místo `t()`.

### Pravidlo
**Všechny UI texty přes `useTranslation` hook.** Žádné hardcoded české (ani anglické) texty.

### Jak opravit

```tsx
// ❌ ŠPATNĚ
<h3>⚠️ Doporučení pro lékařskou konzultaci</h3>
<p>Zaměřte se na tyto oblasti pro maximální zlepšení</p>

// ✅ SPRÁVNĚ
const { t } = useTranslation();
<h3><AlertTriangle className="h-5 w-5" /> {t("assessment.medicalConsultationRecommendation")}</h3>
<p>{t("assessment.focusOnAreasForImprovement")}</p>
```

### Workflow
1. Přidej klíč do `src/i18n/segments/en/<segment>.json`
2. Přidej překlad do `src/i18n/segments/cs/<segment>.json`
3. Nahraď hardcoded text za `t("klíč")`
4. Spusť `npm run i18n:check`

### Allowlist
`KNOWN_HARDCODED_CZ` v `ui-quality.gate.test.ts` (baseline 73).

---

## Skill: platform-code-hygiene

### Kontroly

#### 1. console.log() — ZAKÁZÁNO
```typescript
// ❌ ŠPATNĚ
console.log("data", data);

// ✅ SPRÁVNĚ — safe logger
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));
```

#### 2. `any` typ — ZAKÁZÁNO
```typescript
// ❌ ŠPATNĚ
const data: any = response;
(window as any).debug = true;

// ✅ SPRÁVNĚ
const data: MyType = response;
// nebo unknown + type guard
const data: unknown = response;
if (isMyType(data)) { /* ... */ }
```

#### 3. @ts-ignore — ZAKÁZÁNO (použít @ts-expect-error s komentářem)
```typescript
// ❌ ŠPATNĚ
// @ts-ignore
const x = something;

// ✅ SPRÁVNĚ
// @ts-expect-error -- Supabase client type doesn't include debug property
(window as Record<string, unknown>).__supabase_client__ = client;
```

#### 4. Velikost souborů
- **Warning**: > 800 řádků → zvážit refaktor
- **Fail**: > 1500 řádků → MUSÍ být rozdělen (kromě generovaných)

#### 5. require() — ZAKÁZÁNO
```typescript
// ❌ ŠPATNĚ
const mod = require("./utils");

// ✅ SPRÁVNĚ
import { util } from "./utils";
```

---

## Skill: platform-accessibility

### Pravidla

#### img alt
```tsx
// ❌ ŠPATNĚ
<img src={url} className="w-20" />

// ✅ SPRÁVNĚ
<img src={url} alt={t("product.thumbnail")} className="w-20" />
// nebo dekorativní obrázek:
<img src={url} alt="" role="presentation" className="w-20" />
```

#### Interaktivní prvky
```tsx
// ❌ ŠPATNĚ — icon-only button bez label
<Button onClick={onClose}><X /></Button>

// ✅ SPRÁVNĚ
<Button onClick={onClose} aria-label={t("common.close")}><X /></Button>
```

### Soubory k opravě
Allowlist `KNOWN_MISSING_ALT` v `ui-quality.gate.test.ts`.

---

## Skill: platform-component-patterns

### Pravidla

#### onClick handlery
```tsx
// ❌ ŠPATNĚ — multiline inline handler
<Button onClick={() => {
  const result = doSomething();
  setData(result);
  navigate("/next");
}}>

// ✅ SPRÁVNĚ — pojmenovaná funkce
const handleSubmit = useCallback(() => {
  const result = doSomething();
  setData(result);
  navigate("/next");
}, []);
<Button onClick={handleSubmit}>
```

#### Tailwind arbitrary values
```tsx
// ❌ ŠPATNĚ — magic pixel values
<div className="p-[127px] m-[200px]">

// ✅ SPRÁVNĚ — standardní Tailwind
<div className="p-8 m-12"> // nebo p-32 m-48
```

---

## Jak přidat nový gate test

1. Přidej test do příslušného souboru v `src/tests/gates/`
2. Pokud nalezneš existující problémy, vytvoř **allowlist s baseline číslem**
3. Baseline číslo se SMÍME JEN SNIŽOVAT (nikdy zvyšovat)
4. Ověř: `npx vitest run --config vitest.gates.config.ts src/tests/gates/`
5. Aktualizuj tento dokument

## Jak spustit všechny gates

```bash
# Všechny gate testy
npx vitest run --config vitest.gates.config.ts src/tests/gates/

# Konkrétní soubor
npx vitest run --config vitest.gates.config.ts src/tests/gates/ui-quality.gate.test.ts
```

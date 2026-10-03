# Internacionalizace (i18n) — Standardy a Workflow

> Každý text zobrazený uživateli musí projít překladovým systémem. Bez výjimek.

---

## Základní Pravidla

| Pravidlo | Příklad |
|----------|---------|
| Vždy `t("klíč")` | `t("common.save")` ✅ |
| Žádné hardcoded fallbacky | `t("key", "Save")` ❌ |
| Žádné inline podmínky | `available ? "In stock" : "Out of stock"` ❌ |
| EN je kanonická sada klíčů | Nový klíč nejdřív do EN, pak ostatní |
| Segment-based organizace | Klíče podle domény, ne mega-soubor |

---

## Struktura Souborů

```
src/i18n/
├── segments/           ← EDITUJEME TADY (zdrojové soubory)
│   ├── en/
│   │   ├── common.json      # Sdílené: save, cancel, loading...
│   │   ├── auth.json        # Přihlášení, registrace
│   │   ├── products.json    # Produkty
│   │   └── errors.json      # Chybové hlášky
│   ├── cs/
│   │   ├── common.json
│   │   └── ...
│   └── de/
│       └── ...
│
└── locales/            ← GENEROVÁNO (nevytvářet ručně)
    ├── en.json          # merge všech en/*.json segmentů
    ├── cs.json
    └── de.json
```

---

## Segment Map

```javascript
// src/i18n/segment-map.js (nebo .ts)
export const SEGMENT_MAP = {
  common: ["common"],
  auth: ["auth"],
  products: ["products", "product-categories"],
  checkout: ["checkout", "cart", "orders"],
  errors: ["errors"],
  // ... každá doména má svůj segment
};
```

Kompilace segmentů:
```bash
npm run i18n:compile   # Sloučí segments/ do locales/
npm run i18n:check     # Zkontroluje paritu klíčů
```

---

## Namespacing Klíčů

```
[segment].[oblast].[klíč]

common.actions.save         → "Uložit"
common.actions.cancel       → "Zrušit"
common.status.loading       → "Načítám..."
common.status.error         → "Nastala chyba"

auth.login.title            → "Přihlášení"
auth.login.emailLabel       → "Email"
auth.login.submitButton     → "Přihlásit se"
auth.errors.invalidCredentials → "Neplatné přihlašovací údaje"

products.list.emptyState    → "Žádné produkty k zobrazení"
products.card.outOfStock    → "Nedostupné"
products.card.addToCart     → "Přidat do košíku"

errors.notFound             → "Stránka nenalezena"
errors.forbidden            → "Nemáte oprávnění"
errors.serverError          → "Chyba serveru, zkuste znovu"
errors.generic              → "Nastala neočekávaná chyba"
```

---

## Použití v Kódu

### Základní:
```typescript
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t("products.list.title")}</h1>
      <button>{t("common.actions.save")}</button>
    </div>
  );
}
```

### S interpolací:
```typescript
// EN segment: "cart.itemCount": "{{count}} položka/položek"
t("cart.itemCount", { count: 5 }) // → "5 položek"

// EN segment: "products.welcomeUser": "Vítej, {{name}}!"
t("products.welcomeUser", { name: user.displayName })
// Pozor: name musí být anonymizovaný/bezpečný - ne email nebo sensitive data
```

### Pluralizace:
```json
// en/products.json
{
  "itemCount_one": "{{count}} item",
  "itemCount_other": "{{count}} items"
}
```
```typescript
t("products.itemCount", { count: 1 })  // → "1 item"
t("products.itemCount", { count: 5 })  // → "5 items"
```

---

## Pravidla pro Překlad

### ❌ ZAKÁZÁNO:

```typescript
// Hardcoded text
<span>Uložit</span>
<span>Save</span>

// Fallback (maskuje chybějící překlad!)
t("common.save", "Save")
t("common.save", { defaultValue: "Save" })

// Podmíněný hardcoded text
available ? "In stock" : "Out of stock"

// Concatenace (překlady mají různou strukturu věty)
t("prefix") + " " + dynamicValue + " " + t("suffix") // ❌
// Správně:
t("sentence", { value: dynamicValue }) // ✅

// i18n.exists() workaround
i18n.exists("key") ? t("key") : "Fallback" // ❌
```

---

## Workflow pro Nový Text

1. Rozhodne: Do jakého segmentu patří?
2. Přidej klíč do `src/i18n/segments/en/[segment].json`
3. Přidej překlad do `src/i18n/segments/cs/[segment].json`
4. Přidej do dalších jazyků (nebo označ jako TODO pro překladatele)
5. Spusť kompilaci: `npm run i18n:compile`
6. Spusť kontrolu: `npm run i18n:check`
7. Použij `t("segment.klíč")` v komponentě

---

## NPM Skripty

```bash
npm run i18n:compile              # Sloučí segmenty do locales/
npm run i18n:check                # Zkontroluje paritu klíčů mezi jazyky
npm run i18n:segments:report-missing  # Report chybějících klíčů
npm run i18n:bracket-check        # Detekce [English placeholder] textů
npm run i18n:bracket-check:strict # Fail CI pokud existují placeholdery
```

---

## i18n Gate Test

```typescript
// src/tests/gates/i18n-completeness.gate.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, val]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "object" && val !== null) {
      return flattenKeys(val as Record<string, unknown>, fullKey);
    }
    return [fullKey];
  });
}

describe("i18n Completeness", () => {
  const BASE_LANG = "en";
  const OTHER_LANGS = ["cs"]; // přidat dle projektu: "de", "fr", ...

  it("all locales have same keys as EN", () => {
    const enKeys = new Set(
      flattenKeys(JSON.parse(fs.readFileSync(`src/i18n/locales/${BASE_LANG}.json`, "utf-8")))
    );

    for (const lang of OTHER_LANGS) {
      const langKeys = new Set(
        flattenKeys(JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}.json`, "utf-8")))
      );
      const missing = [...enKeys].filter(k => !langKeys.has(k));
      expect(missing, `${lang} chybí klíče:\n${missing.join("\n")}`).toHaveLength(0);
    }
  });

  it("no bracket placeholder translations", () => {
    for (const lang of OTHER_LANGS) {
      const content = fs.readFileSync(`src/i18n/locales/${lang}.json`, "utf-8");
      const brackets = content.match(/\[[A-Z][^\]]{2,}\]/g) ?? [];
      expect(brackets, `${lang} obsahuje placeholdery: ${brackets.join(", ")}`).toHaveLength(0);
    }
  });
});
```

---

## i18n v Testech

```typescript
// src/tests/mocks/i18n.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Mock i18n pro testy — nepotřebuje reálné překlady
i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: {} }, // Prázdné — klíče se vrátí jako-je
  },
  interpolation: { escapeValue: false },
});

export default i18n;

// V testu: t("common.save") vrátí "common.save" — to je OK pro testy
// Testujeme chování, ne překlady
```

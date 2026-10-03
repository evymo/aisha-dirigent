# P2: Analýza migrace na Material Design 3

> **Stav:** Návrh k diskuzi  
> **Datum:** 2026-02-13  
> **Větev:** `feature/m3-design-system-analysis`

## Shrnutí (Executive Summary)

Tento dokument analyzuje, zda má smysl migrovat design systém Platform na [Material Design 3](https://m3.material.io/) (M3) / Material You. Cílem je sjednotit vizuální jazyk mezi **webem** (React + Vite), **iOS** a **Androidem** (Expo/React Native).

**Verdikt: Plná migrace na M3 se nedoporučuje.** Místo toho doporučujeme **postupnou adopci M3 principů** do stávajícího design systému formou sdílených design tokenů.

---

## 1. Aktuální stav

### Web (React + Vite)
| Vrstva | Technologie |
|---|---|
| UI komponenty | **shadcn/ui** (~57 komponent, vlastní kód) |
| Primitiva | **Radix UI** (25+ @radix-ui balíčků) |
| Styling | **TailwindCSS 3.4** + CSS Variables (HSL) |
| Animace | **Framer Motion**, CSS @keyframes |
| Ikony | **Lucide React** |
| Grafy | **Recharts** |

### Mobile (Expo/React Native)
| Vrstva | Technologie |
|---|---|
| Framework | **Expo 54** + React Native 0.81 |
| Navigace | **@react-navigation** v7 |
| UI komponenty | **6 vlastních** (Button, Card, Badge, GlassCard, Icon, IconLabel) + ~16 feature komponent |
| Theme systém | Vlastní (`theme/colors.ts`, `typography.ts`, `spacing.ts`) |
| Animace | **react-native-reanimated** |

### Sdílené prvky mezi platformami
- **Fonty:** Inter, Sora, Playfair Display
- **Barevná paleta:** Teal primary (`hsl(165, 70%, 40%)`), Purple secondary, Coral accent
- **Shadows / Border radius:** Manuálně synchronizované

---

## 2. Co je M3 a co by přineslo

Material Design 3 (Material You) je Googlem definovaný design systém:
- **Dynamic Color** – adaptivní barvy podle wallpaperu/brandu
- **Motion physics** – fyzikálně-správné animační křivky
- **Shape system** – 35+ tvarových variant, morphing
- **Adaptive typography** – škálování podle displeje
- **Accessibility-first** – velké touch targety, kontrast

### M3 Expressive (2025+)
Nejnovější evoluce M3 přidává emocionálnější prvky – výzkum ukazuje, že uživatelé preferují expresivní UI a klíčové prvky jsou až **4× rychleji nalezitelné**.

---

## 3. Dostupný ekosystém pro naše technologie

### Web (React)

| Knihovna | Stav | Hodnocení |
|---|---|---|
| **@material/web** (Google official) | ⚠️ **Maintenance mode** – žádný aktivní vývoj | ❌ Rizikové |
| **MUI (Material UI)** | M3 podpora plánována na **2026** (nová lib na base-ui) | ⏳ Příliš brzy |
| **Actify** | Community M3 + Tailwind + React-Aria | ⚠️ Nezralé |
| **mdui** | Web Components + M3, frameworkově-agnostické | ⚠️ Malá komunita |

> **Problém:** Pro React neexistuje stabilní, produkce-ready M3 knihovna.

### Mobile (React Native)

| Knihovna | Stav | Hodnocení |
|---|---|---|
| **react-native-paper** v5 | ✅ Plná M3 podpora, MD2/MD3 přepínatelné | ✅ Produkčně ready |
| **@react-native-material/core** | ⚠️ Méně aktivní | ⚠️ Omezené |

> **react-native-paper** je reálná volba pro mobile, ale způsobila by **divergenci** s webovou vrstvou.

---

## 4. Co by migrace na M3 znamenala

### 4.1 Plná migrace (❌ NEDOPORUČENO)

```
Odhadovaný rozsah: 3-4 měsíce (web + mobile)
Riziko: Vysoké
```

**Web:**
- Nahrazení všech 57 shadcn/ui komponent → nová M3 knihovna nebo custom
- Přepsání TailwindCSS tokenů na M3 token systém
- Refaktoring ~300+ souborů s UI komponentami
- Ztráta shadcn/ui výhod: vlastní kód, plná kontrola, Radix accessibility

**Mobile:**
- Integrace `react-native-paper` (relativně snadné)
- Přepisování custom komponent na Paper API
- Refaktoring theme systému

**Rizika:**
- Neexistuje stabilní M3 React web library → blokující závislost
- **Vizuální regrese** napříč celou aplikací
- Ztráta custom designu (glassmorphism, gradienty, organic styl)
- Narušení existujících E2E + unit testů

### 4.2 Adopce M3 principů do stávajícího systému (✅ DOPORUČENO)

```
Odhadovaný rozsah: 2-3 týdny
Riziko: Nízké
```

Vzít z M3 to nejlepší a zapracovat do stávajícího designu:

| M3 Princip | Implementace |
|---|---|
| **Design Tokens** | Vytvořit sdílenou `tokens/` vrstvu (JSON) → automaticky generovat CSS vars (web) i RN theme (mobile) |
| **Dynamic Color** | Implementovat tonal palette generátor (HSL-based, jak už máme) |
| **Elevation system** | Sjednotit shadows/elevation mezi platformami |
| **Typography scale** | Adoptovat M3 type scale (display/headline/title/body/label) do obou platforem |
| **Motion** | Přidat M3 easing curves do Framer Motion (web) a Reanimated (mobile) |
| **Shape** | Sjednotit borderRadius škálu dle M3 (none/extra-small/small/.../full) |
| **Touch targets** | Zajistit minimálně 48dp interaktivní zóny |

---

## 5. Doporučená architektura: Unified Design Tokens

```
packages/design-tokens/          ← Nový sdílený balíček
├── tokens.json                  ← Single source of truth
├── build.mjs                    ← Generátor (Style Dictionary-like)
├── dist/
│   ├── css-variables.css        ← Pro web (index.css)
│   ├── rn-theme.ts              ← Pro mobile (theme/)
│   └── figma-tokens.json        ← Pro design tým
```

### Příklad `tokens.json`:
```json
{
  "color": {
    "primary": { "value": "hsl(165, 70%, 40%)" },
    "onPrimary": { "value": "hsl(0, 0%, 100%)" },
    "primaryContainer": { "value": "hsl(165, 60%, 90%)" },
    "onPrimaryContainer": { "value": "hsl(165, 70%, 15%)" }
  },
  "typescale": {
    "displayLarge": { "fontFamily": "Playfair Display", "fontSize": 57, "lineHeight": 64 },
    "headlineMedium": { "fontFamily": "Inter", "fontSize": 28, "lineHeight": 36 },
    "bodyMedium": { "fontFamily": "Inter", "fontSize": 14, "lineHeight": 20 },
    "labelLarge": { "fontFamily": "Inter", "fontSize": 14, "lineHeight": 20, "fontWeight": 500 }
  },
  "shape": {
    "none": 0,
    "extraSmall": 4,
    "small": 8,
    "medium": 12,
    "large": 16,
    "extraLarge": 28,
    "full": 9999
  },
  "elevation": {
    "level0": { "shadow": "none" },
    "level1": { "shadow": "0 1px 3px 0 rgba(0,0,0,0.1)" },
    "level2": { "shadow": "0 2px 8px -2px rgba(0,0,0,0.12)" }
  }
}
```

### Výhody tohoto přístupu:
1. **Jeden zdroj pravdy** pro barvy, typografii, spacing, tvary
2. **Automatická synchronizace** web ↔ mobile ↔ Figma
3. **Žádné breaking changes** – postupný refaktoring
4. **Zachování shadcn/ui** + Radix (web) – osvědčený stack
5. **Zachování custom designu** – glassmorphism, gradienty, brand identity
6. **M3 terminologie** – snazší komunikace s designéry

---

## 6. Srovnání alternativ

| Kritérium | M3 plná migrace | M3 principy + tokens | Žádná změna |
|---|:---:|:---:|:---:|
| Cross-platform konzistence | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| Effort | 🔴 3-4 měsíce | 🟢 2-3 týdny | 🟢 0 |
| Riziko regrese | 🔴 Vysoké | 🟢 Nízké | 🟢 Žádné |
| Brand identity | 🔴 Ztráta (M3 look) | 🟢 Zachováno | 🟢 Zachováno |
| Budoucí údržba | 🔴 Závislost na ext. lib | 🟢 Vlastní kontrola | 🟡 Manuální sync |
| iOS native feel | 🔴 Android-centric | 🟢 Neutrální | 🟢 Neutrální |
| Ekosystém zralost | 🔴 Web lib neexistuje | 🟢 N/A | 🟢 N/A |

---

## 7. iOS vs Android – důležitý kontext

> [!CAUTION]
> Material Design je primárně **Android-centric** designový jazyk. Na iOS se Apple silně drží **Human Interface Guidelines (HIG)**. Plná M3 adopce by mohla způsobit, že iOS verze bude působit **nepřirozeně** pro Apple uživatele.

**Doporučení:** Sdílené design tokeny umožňují mít **stejné barvy, typografii a spacing**, ale s **platformově-nativním chováním** (iOS swipe-back, Android material ripple efekt, atd.).

---

## 8. Konkrétní akční plán (pokud bude schváleno)

### Fáze 1: Design Tokens Foundation (1 týden)
- [ ] Vytvořit `packages/design-tokens/` s M3-inspired token strukturou
- [ ] Napsat build skript generující CSS variables + RN theme
- [ ] Migrovat `src/index.css` CSS vars na tokeny
- [ ] Migrovat `mobile-app/src/theme/` na generované hodnoty

### Fáze 2: Typography & Shape Alignment (3-5 dní)
- [ ] Adoptovat M3 type scale pojmenování (display/headline/title/body/label)
- [ ] Sjednotit borderRadius škálu
- [ ] Aktualizovat web + mobile komponenty

### Fáze 3: Motion & Interaction (3-5 dní)
- [ ] Přidat M3 easing curves (emphasized, standard, decelerated)
- [ ] Audit touch target sizes (min 48dp)
- [ ] Sjednotit hover/press stavy

### Fáze 4: Documentation & Validation
- [ ] Aktualizovat CONTRIBUTING.md s token workflow
- [ ] Vytvořit Storybook / visual regression testy
- [ ] Validovat na obou platformách

---

## 9. Závěr

| Otázka | Odpověď |
|---|---|
| Má smysl plná migrace na M3? | **Ne** – neexistuje stabilní web knihovna, příliš velký scope |
| Má smysl adoptovat M3 principy? | **Ano** – design tokeny, type scale, motion physics |
| Je alternativa lepší? | **Ano** – Unified Design Tokens s M3 terminologií |
| Přinese to cross-platform konzistenci? | **Ano** – jeden zdroj pravdy pro oba targets |
| Je to kompatibilní s iOS a Android? | **Ano** – platformově neutrální, zachovává native feel |

> [!IMPORTANT]
> **Největší přínos** není v adopci M3 komponent, ale v **zavedení sdíleného token systému**, který zajistí, že web i mobile mluví **stejným vizuálním jazykem** při zachování stávajícího designu a kvality.

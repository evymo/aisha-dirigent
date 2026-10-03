# Návrh: Tag-based Activity Check-in

## Koncept

Místo ručního vyplňování formuláře umožnit uživatelům rychlý check-in pomocí předpřipravených tagů a šablon.

## Use Cases

### 1. Quick Tags (Rychlé tagy)

**Scénář**: Uživatel má opakující se symptomy

**Řešení**: Předvybrané kombinace hodnot jako "tagy"

```tsx
// Příklad tagů
const quickTags = [
  {
    id: "good_morning",
    label: "Dobré ráno ☀️",
    icon: "😊",
    preset: {
      pain_level: 2,
      energy_level: 8,
      mood_level: 8,
      sleep_quality: 7,
    }
  },
  {
    id: "flare_up",
    label: "Záchvat bolesti 🔥",
    icon: "😣",
    preset: {
      pain_level: 8,
      energy_level: 3,
      mood_level: 4,
      took_medication: true,
    }
  },
  {
    id: "recovery_day",
    label: "Den odpočinku 🛌",
    icon: "😌",
    preset: {
      pain_level: 5,
      energy_level: 4,
      sleep_quality: 6,
      activity_minutes: 0,
    }
  },
]
```

**UX Flow**:
1. Uživatel otevře formulář
2. Vidí velké tlačítka s tagy nahoře
3. Klikne na tag → hodnoty se automaticky vyplní
4. Může upravit detaily nebo rovnou odeslat

### 2. Symptom Tags (Tagování symptomů)

**Scénář**: Rychlá identifikace symptomů bez psaní

**Řešení**: Multi-select tagy místo textarey

```tsx
const symptomTags = [
  // Bolest
  "Bolest kloubů",
  "Bolest zad", 
  "Bolest hlavy",
  "Svalová bolest",
  
  // Energie
  "Únava",
  "Nespavost",
  "Ranní ztuhlost",
  
  // Gastrointestinální
  "Nevolnost",
  "Nechutenství",
  
  // Psychické
  "Úzkost",
  "Nízká motivace",
  "Dobrá nálada",
]
```

**UI**: Chip/Badge komponenty, multi-select

### 3. Location Tags (Lokalizace bolesti)

**Scénář**: Označit místo bolesti bez psaní

**Řešení**: Interaktivní diagram těla nebo tag grid

```tsx
const bodyLocationTags = [
  // Horní končetiny
  { id: "left_shoulder", label: "Levé rameno", region: "upper" },
  { id: "right_shoulder", label: "Pravé rameno", region: "upper" },
  { id: "left_elbow", label: "Levý loket", region: "upper" },
  { id: "right_elbow", label: "Pravý loket", region: "upper" },
  
  // Dolní končetiny
  { id: "left_knee", label: "Levé koleno", region: "lower" },
  { id: "right_knee", label: "Pravé koleno", region: "lower" },
  { id: "left_ankle", label: "Levý kotník", region: "lower" },
  { id: "right_ankle", label: "Pravý kotník", region: "lower" },
  
  // Core
  { id: "lower_back", label: "Bederní páteř", region: "core" },
  { id: "upper_back", label: "Hrudní páteř", region: "core" },
  { id: "neck", label: "Krk", region: "core" },
]
```

### 4. AI-Suggested Tags (Chytrá doporučení)

**Scénář**: Aplikace navrhne tagy na základě historie

**Řešení**: ML model doporučí nejpravděpodobnější stav

```tsx
// Na základě minulých check-inů + čas
const suggestedTags = calculateSuggestedTags({
  history: userCheckInHistory,
  timeOfDay: "morning",
  dayOfWeek: "monday",
  lastCheckIn: lastCheckIn,
});

// Zobrazí: "Obvykle v pondělí ráno uvádíte..."
```

## Implementační fáze

### Fáze 1: Quick Preset Tags (nyní hotovo ✅)
- ✅ RatingButtons komponenta
- ✅ Optimalizovaný formulář
- ⬜ Quick tag tlačítka nahoře formuláře

### Fáze 2: Symptom Tags
- ⬜ Multi-select chip komponenta
- ⬜ Integrace do formuláře (náhrada textarea)
- ⬜ DB schema pro tagy

### Fáze 3: Location Tags
- ⬜ Body diagram komponenta (SVG)
- ⬜ Touch-interactive oblasti
- ⬜ Pain heatmap vizualizace

### Fáze 4: AI Suggestions
- ⬜ ML model pro pattern recognition
- ⬜ Personalizované doporučení
- ⬜ "One-tap check-in" pro typické dny

## UX Principy

1. **Rychlost first** - Check-in max 30 sekund
2. **Progresivní zjednodušování** - Začít s tagy, detaily optional
3. **Konzistence** - Tagy = standardizovaná data pro výzkum
4. **Personalizace** - Naučit se uživatelovy vzory
5. **Flexibilita** - Vždy možnost vlastního vstupu

## Data Benefits

- **Strukturovaná data** - Lepší pro analýzu než volný text
- **Konzistence** - Stejné symptomy mají stejný tag
- **Rychlost** - Výzkumníci vidí trendy okamžitě
- **Multi-language** - Tagy lze překládat bez ztráty významu

## Technické poznámky

### DB Schema (návrh)

```sql
CREATE TABLE health_check_in_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID REFERENCES health_check_ins(id),
  tag_type TEXT NOT NULL, -- 'symptom', 'location', 'mood'
  tag_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tag_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  icon TEXT,
  preset_data JSONB NOT NULL, -- {pain_level: 5, ...}
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Komponenta struktura

```
src/components/member/
  ActivityCheckInForm.tsx (hlavní formulář)
  QuickTagButtons.tsx (rychlé presety)
  SymptomTagSelector.tsx (multi-select)
  BodyLocationPicker.tsx (interaktivní diagram)
  
src/components/ui/
  rating-buttons.tsx ✅
  tag-chip.tsx (pro symptomy)
  body-diagram.tsx (SVG komponenta)
```

## Metrics (KPIs)

- **Time to complete**: Cílová hodnota < 60s → s tagy < 30s
- **Completion rate**: Zvýšení z ~60% na ~85%
- **Data quality**: Strukturovaná data 80%+ místo volného textu
- **User satisfaction**: NPS > 8/10

---

**Status**: Návrh - čeká na finální schválení a prioritizaci  
**Next Step**: Diskuse o Fázi 1 (Quick Preset Tags)

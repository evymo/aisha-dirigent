# Tag-Based Onboarding Questionnaire

**Status:** 📝 Návrh  
**Priorita:** P2  
**Datum:** 20. prosince 2025

---

## 🎯 Koncept

Transformace onboarding dotazníku na **tag-first** přístup, kde uživatel může dokončit celý proces **klikáním na tagy** bez nutnosti psaní. Psaní je vždy **volitelné** pro ty, kdo chtějí upřesnit.

### Filozofie

> "Klikni, neklikej na klávesnici"

- **Rychlost:** Onboarding pod 2 minuty
- **Přístupnost:** Funguje na mobilu jedním palcem
- **Data kvalita:** Strukturovaná data pro výzkum
- **UX:** Gamifikace formou výběru "karet"

---

## 📋 Struktura dotazníku

### Step 1: Jak se cítím (Quick Feelings)

**Místo:** 5× RatingButtons (0-10)  
**Nově:** Výběr emoji/tag kombinací

```typescript
const FEELING_PRESETS = [
  {
    id: "great",
    emoji: "😄",
    label: "Skvěle",
    description: "Mám energii, cítím se dobře",
    values: {
      overall_feeling: 8,
      energy_perception: 8,
      mental_wellbeing: 8,
      physical_confidence: 7,
      sleep_satisfaction: 7,
    }
  },
  {
    id: "okay",
    emoji: "🙂",
    label: "Dobře",
    description: "Nic zvláštního, normál",
    values: {
      overall_feeling: 6,
      energy_perception: 6,
      mental_wellbeing: 6,
      physical_confidence: 6,
      sleep_satisfaction: 6,
    }
  },
  {
    id: "meh",
    emoji: "😐",
    label: "Tak tak",
    description: "Mohlo by být lepší",
    values: {
      overall_feeling: 5,
      energy_perception: 4,
      mental_wellbeing: 5,
      physical_confidence: 5,
      sleep_satisfaction: 5,
    }
  },
  {
    id: "tired",
    emoji: "😴",
    label: "Unavený/á",
    description: "Chybí mi energie",
    values: {
      overall_feeling: 4,
      energy_perception: 3,
      mental_wellbeing: 5,
      physical_confidence: 4,
      sleep_satisfaction: 3,
    }
  },
  {
    id: "struggling",
    emoji: "😔",
    label: "Bojuji",
    description: "Potřebuji pomoc",
    values: {
      overall_feeling: 3,
      energy_perception: 2,
      mental_wellbeing: 3,
      physical_confidence: 3,
      sleep_satisfaction: 3,
    }
  },
];
```

**UI Pattern:**
```
┌─────────────────────────────────────────────────────┐
│  Jak se aktuálně cítíte?                           │
│                                                     │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
│  │  😄   │  │  🙂   │  │  😐   │  │  😴   │  │  😔   │
│  │Skvěle │  │ Dobře │  │Tak tak│  │Unavený│  │Bojuji │
│  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘
│                                                     │
│  [Chci upřesnit detaily ▼] (expandable)            │
└─────────────────────────────────────────────────────┘
```

---

### Step 2: Co mě trápí (Concern Tags)

**Multi-select tagy** místo textového pole "primary_concern"

```typescript
const CONCERN_TAGS = [
  // Fyzické
  { id: "chronic_fatigue", emoji: "🔋", label: "Chronická únava", category: "physical" },
  { id: "joint_pain", emoji: "🦴", label: "Bolest kloubů", category: "physical" },
  { id: "back_pain", emoji: "🔙", label: "Bolest zad", category: "physical" },
  { id: "headaches", emoji: "🤕", label: "Bolesti hlavy", category: "physical" },
  { id: "muscle_pain", emoji: "💪", label: "Svalová bolest", category: "physical" },
  { id: "morning_stiffness", emoji: "🌅", label: "Ranní ztuhlost", category: "physical" },
  
  // Spánek & Energie
  { id: "sleep_issues", emoji: "😴", label: "Problémy se spánkem", category: "sleep" },
  { id: "insomnia", emoji: "🌙", label: "Nespavost", category: "sleep" },
  { id: "low_energy", emoji: "⚡", label: "Nízká energie", category: "energy" },
  { id: "afternoon_slump", emoji: "☕", label: "Odpolední únava", category: "energy" },
  
  // Trávení
  { id: "digestive_issues", emoji: "🍽️", label: "Trávicí potíže", category: "digestive" },
  { id: "bloating", emoji: "🎈", label: "Nadýmání", category: "digestive" },
  { id: "food_sensitivities", emoji: "🚫", label: "Citlivost na jídlo", category: "digestive" },
  
  // Psychické
  { id: "stress", emoji: "😰", label: "Stres", category: "mental" },
  { id: "anxiety", emoji: "😟", label: "Úzkost", category: "mental" },
  { id: "low_motivation", emoji: "📉", label: "Nízká motivace", category: "mental" },
  { id: "brain_fog", emoji: "🌫️", label: "Mozková mlha", category: "mental" },
  { id: "mood_swings", emoji: "🎭", label: "Výkyvy nálady", category: "mental" },
  
  // Imunita
  { id: "frequent_illness", emoji: "🤒", label: "Časté nemoci", category: "immune" },
  { id: "slow_recovery", emoji: "🐌", label: "Pomalé zotavení", category: "immune" },
  { id: "autoimmune", emoji: "🛡️", label: "Autoimunitní potíže", category: "immune" },
  
  // Metabolismus
  { id: "weight_issues", emoji: "⚖️", label: "Problémy s váhou", category: "metabolic" },
  { id: "blood_sugar", emoji: "📊", label: "Kolísání cukru", category: "metabolic" },
  { id: "hormonal", emoji: "🧬", label: "Hormonální nerovnováha", category: "metabolic" },
];
```

**UI Pattern:**
```
┌─────────────────────────────────────────────────────┐
│  Co vás aktuálně nejvíc trápí?                     │
│  (Vyberte 1-5 oblastí)                              │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  │ 🔋 Chronická │  │ 😴 Problémy  │  │ 😰 Stres    │
│  │    únava     │  │  se spánkem  │  │             │
│  └──────────────┘  └──────────────┘  └──────────────┘
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  │ 🦴 Bolest    │  │ 🍽️ Trávicí  │  │ 🌫️ Mozková │
│  │   kloubů    │  │   potíže     │  │    mlha     │
│  └──────────────┘  └──────────────┘  └──────────────┘
│  ... (více tagů, scrollable)                        │
│                                                     │
│  [Něco jiného? Napište...] (optional textarea)     │
└─────────────────────────────────────────────────────┘
```

---

### Step 3: Co chci dosáhnout (Goal Tags)

```typescript
const GOAL_TAGS = [
  // Energie & Vitalita
  { id: "more_energy", emoji: "⚡", label: "Více energie", category: "energy" },
  { id: "stable_energy", emoji: "📈", label: "Stabilní energie", category: "energy" },
  { id: "morning_freshness", emoji: "🌅", label: "Svěží ráno", category: "energy" },
  
  // Spánek
  { id: "better_sleep", emoji: "😴", label: "Lepší spánek", category: "sleep" },
  { id: "fall_asleep_easier", emoji: "🌙", label: "Snadnější usínání", category: "sleep" },
  { id: "restful_nights", emoji: "⭐", label: "Klidné noci", category: "sleep" },
  
  // Bolest & Pohyb
  { id: "pain_relief", emoji: "💆", label: "Úleva od bolesti", category: "pain" },
  { id: "better_mobility", emoji: "🚶", label: "Lepší pohyblivost", category: "pain" },
  { id: "active_lifestyle", emoji: "🏃", label: "Aktivní životní styl", category: "pain" },
  
  // Mentální zdraví
  { id: "less_stress", emoji: "🧘", label: "Méně stresu", category: "mental" },
  { id: "mental_clarity", emoji: "🧠", label: "Jasná mysl", category: "mental" },
  { id: "emotional_balance", emoji: "⚖️", label: "Emoční rovnováha", category: "mental" },
  { id: "more_motivation", emoji: "🎯", label: "Větší motivace", category: "mental" },
  
  // Trávení
  { id: "better_digestion", emoji: "🍀", label: "Lepší trávení", category: "digestive" },
  { id: "no_bloating", emoji: "✨", label: "Bez nadýmání", category: "digestive" },
  
  // Imunita
  { id: "stronger_immunity", emoji: "🛡️", label: "Silnější imunita", category: "immune" },
  { id: "faster_recovery", emoji: "🚀", label: "Rychlejší zotavení", category: "immune" },
  
  // Celkové
  { id: "feel_younger", emoji: "🌟", label: "Cítit se mladší", category: "general" },
  { id: "overall_wellness", emoji: "💚", label: "Celková pohoda", category: "general" },
  { id: "preventive_care", emoji: "🔮", label: "Prevence", category: "general" },
];
```

---

### Step 4: O mně (Quick Profile)

**Tag-based výběr** místo dropdown/textů:

```typescript
// Věková kategorie jako vizuální karty
const AGE_CARDS = [
  { id: "18-25", emoji: "🌱", label: "18-25" },
  { id: "26-35", emoji: "🌿", label: "26-35" },
  { id: "36-45", emoji: "🌳", label: "36-45" },
  { id: "46-55", emoji: "🍂", label: "46-55" },
  { id: "56-65", emoji: "🍁", label: "56-65" },
  { id: "65+", emoji: "🌲", label: "65+" },
];

// Časový rámec jako vizuální škála
const TIMEFRAME_CARDS = [
  { id: "asap", emoji: "🚀", label: "Co nejdříve", description: "Akutní situace" },
  { id: "1_month", emoji: "📅", label: "1 měsíc", description: "Rychlé výsledky" },
  { id: "3_months", emoji: "🗓️", label: "3 měsíce", description: "Postupná změna" },
  { id: "6_months", emoji: "📆", label: "6 měsíců", description: "Hluboká transformace" },
  { id: "1_year", emoji: "🎯", label: "1 rok+", description: "Dlouhodobá cesta" },
];

// Preference mentora
const MENTOR_CARDS = [
  { id: "female", emoji: "👩", label: "Žena" },
  { id: "male", emoji: "👨", label: "Muž" },
  { id: "no_preference", emoji: "🤝", label: "Bez preference" },
];

// Styl komunikace
const COMMUNICATION_CARDS = [
  { id: "frequent", emoji: "💬", label: "Častý kontakt", description: "Check-in každý týden" },
  { id: "moderate", emoji: "📱", label: "Střední", description: "Check-in 1-2× měsíčně" },
  { id: "minimal", emoji: "📨", label: "Minimální", description: "Jen když potřebuji" },
];
```

---

## 🧩 Komponenty

### TagCard Component

```tsx
// src/components/ui/tag-card.tsx
interface TagCardProps {
  emoji: string;
  label: string;
  description?: string;
  selected?: boolean;
  onClick: () => void;
  size?: "sm" | "md" | "lg";
}

export function TagCard({ 
  emoji, 
  label, 
  description, 
  selected, 
  onClick,
  size = "md" 
}: TagCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all",
        "hover:scale-105 hover:shadow-md",
        selected 
          ? "border-primary bg-primary/10 ring-2 ring-primary/20" 
          : "border-muted hover:border-primary/50",
        size === "sm" && "p-2 text-sm",
        size === "lg" && "p-6 text-lg"
      )}
    >
      <span className="text-3xl mb-2">{emoji}</span>
      <span className="font-medium">{label}</span>
      {description && (
        <span className="text-xs text-muted-foreground mt-1">{description}</span>
      )}
    </button>
  );
}
```

### TagGrid Component

```tsx
// src/components/ui/tag-grid.tsx
interface TagGridProps {
  tags: Array<{ id: string; emoji: string; label: string; description?: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelect?: number;
  columns?: 2 | 3 | 4;
}

export function TagGrid({ 
  tags, 
  selected, 
  onChange, 
  maxSelect = 5,
  columns = 3 
}: TagGridProps) {
  const toggleTag = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else if (selected.length < maxSelect) {
      onChange([...selected, id]);
    }
  };

  return (
    <div className={cn(
      "grid gap-3",
      columns === 2 && "grid-cols-2",
      columns === 3 && "grid-cols-2 sm:grid-cols-3",
      columns === 4 && "grid-cols-2 sm:grid-cols-4"
    )}>
      {tags.map(tag => (
        <TagCard
          key={tag.id}
          emoji={tag.emoji}
          label={tag.label}
          description={tag.description}
          selected={selected.includes(tag.id)}
          onClick={() => toggleTag(tag.id)}
        />
      ))}
    </div>
  );
}
```

### FeelingSelector Component

```tsx
// src/components/onboarding/FeelingSelector.tsx
interface FeelingSelectorProps {
  value: string | null;
  onChange: (preset: FeelingPreset) => void;
}

export function FeelingSelector({ value, onChange }: FeelingSelectorProps) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {FEELING_PRESETS.map(preset => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChange(preset)}
          className={cn(
            "flex flex-col items-center p-6 rounded-2xl transition-all",
            "hover:scale-110 hover:shadow-lg",
            value === preset.id
              ? "bg-primary text-primary-foreground scale-110 shadow-lg"
              : "bg-muted hover:bg-muted/80"
          )}
        >
          <span className="text-5xl mb-2">{preset.emoji}</span>
          <span className="font-semibold">{preset.label}</span>
          <span className="text-xs opacity-70 mt-1">{preset.description}</span>
        </button>
      ))}
    </div>
  );
}
```

---

## 📊 Data Model

### DB Schema Update

```sql
-- Add tag support to onboarding_responses
ALTER TABLE onboarding_responses 
ADD COLUMN IF NOT EXISTS feeling_preset TEXT,
ADD COLUMN IF NOT EXISTS concern_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS goal_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS profile_tags JSONB DEFAULT '{}';

-- Comment
COMMENT ON COLUMN onboarding_responses.feeling_preset IS 'Quick feeling preset ID (great, okay, meh, tired, struggling)';
COMMENT ON COLUMN onboarding_responses.concern_tags IS 'Array of concern tag IDs selected by user';
COMMENT ON COLUMN onboarding_responses.goal_tags IS 'Array of goal tag IDs selected by user';
COMMENT ON COLUMN onboarding_responses.profile_tags IS 'JSON object with profile tag selections (age, timeframe, mentor, communication)';
```

---

## 🔄 Migration Path

### Zachování zpětné kompatibility

1. **Stávající pole zůstávají** - pro detailní vstupy
2. **Nová tag pole jsou volitelná** - starší záznamy fungují
3. **UI nabízí oba módy:**
   - Default: Tag-first (rychlé)
   - Expandable: Detailní vstup (pro ty co chtějí)

### UI Flow

```
┌─────────────────────────────────────────────────────┐
│  [Rychlý výběr]  |  Detailní vstup                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Pokud vyberete "Rychlý výběr":                    │
│  → 4 kroky s tagy (< 2 min)                        │
│                                                     │
│  Pokud vyberete "Detailní vstup":                  │
│  → Původní formulář s RatingButtons                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📱 Mobile UX

### Touch Targets

- Minimální velikost tagu: 48×48px
- Dostatečný spacing: 12px mezi tagy
- Swipe gesture pro kategorie tagů

### Performance

- Lazy load kategorií tagů
- Optimistic UI updates
- Offline-capable (PWA ready)

---

## 🎯 Metriky úspěchu

| Metrika | Aktuální | Cíl |
|---------|----------|-----|
| Completion time | ~5 min | < 2 min |
| Completion rate | ~70% | > 90% |
| Mobile completion | ~60% | > 85% |
| User satisfaction | N/A | NPS > 8 |

---

## 🚀 Implementační plán

### Fáze 1: UI Components
- [ ] `TagCard` component
- [ ] `TagGrid` component  
- [ ] `FeelingSelector` component
- [ ] Unit testy

### Fáze 2: Integration
- [ ] DB migrace pro nová pole
- [ ] Aktualizace `OnboardingForm`
- [ ] Dual-mode UI (quick/detailed)
- [ ] i18n pro všechny tagy

### Fáze 3: Polish
- [ ] Animace a micro-interactions
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] A/B testing setup

---

**Status:** 📝 Návrh - připraveno k implementaci  
**Related:** [TAG_BASED_CHECKIN.md](TAG_BASED_CHECKIN.md), [ONBOARDING_CERTIFICATION_SYSTEM.md](../ONBOARDING_CERTIFICATION_SYSTEM.md)

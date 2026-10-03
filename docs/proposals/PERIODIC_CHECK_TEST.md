# Periodický Check Test (Tag-Based)

**Status:** 📝 Návrh  
**Priorita:** P2  
**Datum:** 20. prosince 2025

---

## 🎯 Koncept

Periodický check test pro **průběžné sledování stavu** uživatele. Navrženo pro:
- **Denní** rychlé check-iny (30 sekund)
- **Týdenní** souhrnné hodnocení (2 minuty)
- **Měsíční** hloubkový review (5 minut)

### Filozofie

> "Jak se ti dnes daří?" - Ne medicínský výslech

- **Rychlost:** Denní check < 30 sekund
- **Konzistence:** Standardizovaná data pro výzkum
- **Engagement:** Gamifikace, streak tracking
- **Personalizace:** Tagy přizpůsobené historii uživatele

---

## 📅 Typy Check Testů

### 1. Daily Quick Check (< 30s)

**Účel:** Zachytit denní stav jedním kliknutím

```typescript
const DAILY_MOOD_TAGS = [
  { id: "excellent", emoji: "🌟", label: "Výborně", score: 10 },
  { id: "great", emoji: "😄", label: "Skvěle", score: 8 },
  { id: "good", emoji: "🙂", label: "Dobře", score: 7 },
  { id: "okay", emoji: "😐", label: "Normálně", score: 5 },
  { id: "tired", emoji: "😴", label: "Unavený/á", score: 4 },
  { id: "meh", emoji: "😕", label: "Tak tak", score: 3 },
  { id: "struggling", emoji: "😔", label: "Bojuji", score: 2 },
];

// Volitelné follow-up tagy (zobrazí se po výběru nálady)
const DAILY_CONTEXT_TAGS = [
  // Pozitivní
  { id: "slept_well", emoji: "😴", label: "Spal/a jsem dobře", sentiment: "positive" },
  { id: "active", emoji: "🏃", label: "Byl/a jsem aktivní", sentiment: "positive" },
  { id: "productive", emoji: "✅", label: "Produktivní den", sentiment: "positive" },
  { id: "social", emoji: "👥", label: "Sociální kontakt", sentiment: "positive" },
  
  // Negativní
  { id: "poor_sleep", emoji: "💤", label: "Špatný spánek", sentiment: "negative" },
  { id: "pain", emoji: "🩹", label: "Bolest", sentiment: "negative" },
  { id: "stress", emoji: "😰", label: "Stres", sentiment: "negative" },
  { id: "fatigue", emoji: "🔋", label: "Únava", sentiment: "negative" },
];
```

**UI Flow:**
```
┌─────────────────────────────────────────────────────┐
│  Jak se dnes cítíš?                                │
│                                                     │
│  🌟  😄  🙂  😐  😴  😕  😔                        │
│                                                     │
│  [Klik na emoji = check hotový]                    │
│                                                     │
│  ─────────────────────────────────────             │
│  Chceš přidat kontext? (volitelné)                 │
│                                                     │
│  [😴 Spal/a dobře] [🏃 Aktivní] [😰 Stres]        │
│                                                     │
│  [✓ Uložit]                                        │
└─────────────────────────────────────────────────────┘
```

---

### 2. Weekly Summary Check (2 min)

**Účel:** Týdenní reflexe a tracking trendů

```typescript
const WEEKLY_SECTIONS = [
  {
    id: "overall_week",
    title: "Jak hodnotíš uplynulý týden?",
    type: "single_select",
    tags: [
      { id: "amazing", emoji: "🚀", label: "Úžasný", score: 10 },
      { id: "great", emoji: "⭐", label: "Skvělý", score: 8 },
      { id: "good", emoji: "👍", label: "Dobrý", score: 7 },
      { id: "average", emoji: "➡️", label: "Průměrný", score: 5 },
      { id: "challenging", emoji: "💪", label: "Náročný", score: 3 },
      { id: "difficult", emoji: "😓", label: "Těžký", score: 2 },
    ]
  },
  {
    id: "energy_trend",
    title: "Jak byla tvá energie během týdne?",
    type: "single_select",
    tags: [
      { id: "high_stable", emoji: "⚡", label: "Vysoká a stabilní" },
      { id: "variable", emoji: "📈📉", label: "Kolísavá" },
      { id: "afternoon_dip", emoji: "☕", label: "Odpolední propady" },
      { id: "low_stable", emoji: "🔋", label: "Nízká konstantně" },
      { id: "morning_low", emoji: "🌅", label: "Těžká rána" },
    ]
  },
  {
    id: "sleep_quality",
    title: "Jak jsi spal/a tento týden?",
    type: "single_select",
    tags: [
      { id: "excellent", emoji: "😴", label: "Výborně" },
      { id: "good", emoji: "🛏️", label: "Dobře" },
      { id: "variable", emoji: "🌙", label: "Různě" },
      { id: "poor", emoji: "💤", label: "Špatně" },
      { id: "very_poor", emoji: "😵", label: "Velmi špatně" },
    ]
  },
  {
    id: "highlights",
    title: "Co bylo tento týden pozitivní?",
    type: "multi_select",
    maxSelect: 3,
    tags: [
      { id: "exercise", emoji: "🏃", label: "Cvičil/a jsem" },
      { id: "good_meals", emoji: "🥗", label: "Zdravé jídlo" },
      { id: "social", emoji: "👥", label: "Čas s blízkými" },
      { id: "nature", emoji: "🌳", label: "Pobyt v přírodě" },
      { id: "relaxation", emoji: "🧘", label: "Relaxace" },
      { id: "achievement", emoji: "🏆", label: "Dosáhl/a jsem cíle" },
      { id: "learning", emoji: "📚", label: "Naučil/a jsem se něco" },
      { id: "creativity", emoji: "🎨", label: "Kreativní činnost" },
    ]
  },
  {
    id: "challenges",
    title: "Co bylo tento týden náročné?",
    type: "multi_select",
    maxSelect: 3,
    tags: [
      { id: "work_stress", emoji: "💼", label: "Pracovní stres" },
      { id: "health_issue", emoji: "🩺", label: "Zdravotní potíže" },
      { id: "sleep_trouble", emoji: "😴", label: "Problémy se spánkem" },
      { id: "pain", emoji: "🩹", label: "Bolest" },
      { id: "fatigue", emoji: "🔋", label: "Únava" },
      { id: "anxiety", emoji: "😰", label: "Úzkost" },
      { id: "conflict", emoji: "⚡", label: "Konflikty" },
      { id: "overwhelm", emoji: "🌊", label: "Přehlcení" },
    ]
  },
  {
    id: "next_week_focus",
    title: "Na co se chceš zaměřit příští týden?",
    type: "multi_select",
    maxSelect: 2,
    tags: [
      { id: "more_sleep", emoji: "😴", label: "Více spánku" },
      { id: "exercise", emoji: "🏃", label: "Více pohybu" },
      { id: "nutrition", emoji: "🥗", label: "Lepší stravování" },
      { id: "stress_mgmt", emoji: "🧘", label: "Zvládání stresu" },
      { id: "social", emoji: "👥", label: "Sociální kontakty" },
      { id: "productivity", emoji: "✅", label: "Produktivita" },
      { id: "self_care", emoji: "💆", label: "Self-care" },
      { id: "routine", emoji: "📅", label: "Dodržovat rutinu" },
    ]
  },
];
```

---

### 3. Monthly Deep Check (5 min)

**Účel:** Měsíční hloubková reflexe pro partnerskou konzultaci

```typescript
const MONTHLY_SECTIONS = [
  // Section 1: Overall Progress
  {
    id: "month_rating",
    title: "Jak bys ohodnotil/a uplynulý měsíc?",
    type: "emoji_scale",
    scale: [
      { emoji: "🌟", value: 10, label: "Výjimečný" },
      { emoji: "😄", value: 8, label: "Velmi dobrý" },
      { emoji: "🙂", value: 6, label: "Dobrý" },
      { emoji: "😐", value: 5, label: "Průměrný" },
      { emoji: "😕", value: 4, label: "Podprůměrný" },
      { emoji: "😔", value: 2, label: "Těžký" },
    ]
  },
  
  // Section 2: Activity Dimensions
  {
    id: "health_dimensions",
    title: "Ohodnoť jednotlivé oblasti (1-10)",
    type: "dimension_rating",
    dimensions: [
      { id: "energy", emoji: "⚡", label: "Energie" },
      { id: "sleep", emoji: "😴", label: "Spánek" },
      { id: "mood", emoji: "🧠", label: "Nálada" },
      { id: "pain", emoji: "🩹", label: "Bolest (méně = lépe)" },
      { id: "digestion", emoji: "🍽️", label: "Trávení" },
      { id: "focus", emoji: "🎯", label: "Soustředění" },
      { id: "motivation", emoji: "🚀", label: "Motivace" },
      { id: "immunity", emoji: "🛡️", label: "Imunita" },
    ]
  },
  
  // Section 3: Symptom Tracking
  {
    id: "symptom_frequency",
    title: "Jak často jsi zažíval/a tyto symptomy?",
    type: "frequency_matrix",
    options: ["Nikdy", "Občas", "Často", "Denně"],
    symptoms: [
      { id: "headache", emoji: "🤕", label: "Bolest hlavy" },
      { id: "joint_pain", emoji: "🦴", label: "Bolest kloubů" },
      { id: "fatigue", emoji: "🔋", label: "Únava" },
      { id: "insomnia", emoji: "🌙", label: "Nespavost" },
      { id: "anxiety", emoji: "😰", label: "Úzkost" },
      { id: "bloating", emoji: "🎈", label: "Nadýmání" },
      { id: "brain_fog", emoji: "🌫️", label: "Mozková mlha" },
    ]
  },
  
  // Section 4: Lifestyle
  {
    id: "lifestyle_habits",
    title: "Co se ti dařilo dodržovat?",
    type: "habit_tracker",
    habits: [
      { id: "products", emoji: "💊", label: "Suplementace", target: "Denně" },
      { id: "exercise", emoji: "🏃", label: "Cvičení", target: "3× týdně" },
      { id: "sleep_routine", emoji: "🛏️", label: "Spánková rutina", target: "Konzistentní" },
      { id: "hydration", emoji: "💧", label: "Pitný režim", target: "2L denně" },
      { id: "meditation", emoji: "🧘", label: "Meditace/relaxace", target: "Pravidelně" },
      { id: "journaling", emoji: "📔", label: "Deník/reflexe", target: "Týdně" },
    ],
    options: ["Vůbec", "Občas", "Většinou", "Vždy"]
  },
  
  // Section 5: Progress vs Goals
  {
    id: "goal_progress",
    title: "Jak se daří tvoje cíle z onboardingu?",
    type: "goal_review",
    // Dynamicky načteno z onboarding_responses.goal_tags
  },
  
  // Section 6: Changes & Observations
  {
    id: "notable_changes",
    title: "Zaznamenal/a jsi nějaké změny?",
    type: "multi_select",
    tags: [
      // Pozitivní změny
      { id: "more_energy", emoji: "⬆️⚡", label: "Více energie", sentiment: "positive" },
      { id: "better_sleep", emoji: "⬆️😴", label: "Lepší spánek", sentiment: "positive" },
      { id: "less_pain", emoji: "⬇️🩹", label: "Méně bolesti", sentiment: "positive" },
      { id: "better_mood", emoji: "⬆️🧠", label: "Lepší nálada", sentiment: "positive" },
      { id: "weight_change", emoji: "⚖️", label: "Změna váhy", sentiment: "neutral" },
      
      // Negativní změny
      { id: "worse_energy", emoji: "⬇️⚡", label: "Méně energie", sentiment: "negative" },
      { id: "worse_sleep", emoji: "⬇️😴", label: "Horší spánek", sentiment: "negative" },
      { id: "more_pain", emoji: "⬆️🩹", label: "Více bolesti", sentiment: "negative" },
      { id: "new_symptom", emoji: "🆕", label: "Nový symptom", sentiment: "negative" },
    ]
  },
  
  // Section 7: Partner Communication
  {
    id: "partner_topics",
    title: "O čem bys rád/a mluvil/a s mentorem?",
    type: "multi_select",
    maxSelect: 5,
    tags: [
      { id: "products", emoji: "💊", label: "Suplementace" },
      { id: "diet", emoji: "🥗", label: "Stravování" },
      { id: "exercise", emoji: "🏃", label: "Pohyb" },
      { id: "sleep", emoji: "😴", label: "Spánek" },
      { id: "stress", emoji: "🧘", label: "Stres" },
      { id: "symptoms", emoji: "🩺", label: "Symptomy" },
      { id: "labs", emoji: "🔬", label: "Výsledky testů" },
      { id: "goals", emoji: "🎯", label: "Cíle" },
      { id: "nothing", emoji: "✅", label: "Nic konkrétního" },
    ]
  },
];
```

---

## 🧩 Komponenty

### DailyMoodPicker

```tsx
// src/components/checkin/DailyMoodPicker.tsx
interface DailyMoodPickerProps {
  onSubmit: (data: DailyCheckData) => void;
}

export function DailyMoodPicker({ onSubmit }: DailyMoodPickerProps) {
  const [mood, setMood] = useState<string | null>(null);
  const [contextTags, setContextTags] = useState<string[]>([]);
  const [showContext, setShowContext] = useState(false);

  const handleMoodSelect = (moodId: string) => {
    setMood(moodId);
    setShowContext(true);
  };

  const handleSubmit = () => {
    if (mood) {
      onSubmit({
        mood,
        contextTags,
        timestamp: new Date().toISOString(),
      });
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold text-center mb-6">
        Jak se dnes cítíš?
      </h2>
      
      {/* Mood Selection */}
      <div className="flex justify-center gap-2 flex-wrap">
        {DAILY_MOOD_TAGS.map(tag => (
          <button
            key={tag.id}
            onClick={() => handleMoodSelect(tag.id)}
            className={cn(
              "text-4xl p-3 rounded-full transition-all",
              "hover:scale-125 hover:bg-muted",
              mood === tag.id && "scale-125 bg-primary/20 ring-2 ring-primary"
            )}
            title={tag.label}
          >
            {tag.emoji}
          </button>
        ))}
      </div>

      {/* Context Tags (shown after mood selection) */}
      {showContext && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-6 pt-6 border-t"
        >
          <p className="text-sm text-muted-foreground text-center mb-4">
            Chceš přidat kontext? (volitelné)
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {DAILY_CONTEXT_TAGS.map(tag => (
              <Badge
                key={tag.id}
                variant={contextTags.includes(tag.id) ? "default" : "outline"}
                className="cursor-pointer text-sm py-1 px-3"
                onClick={() => {
                  setContextTags(prev =>
                    prev.includes(tag.id)
                      ? prev.filter(t => t !== tag.id)
                      : [...prev, tag.id]
                  );
                }}
              >
                {tag.emoji} {tag.label}
              </Badge>
            ))}
          </div>
        </motion.div>
      )}

      {/* Submit */}
      {mood && (
        <Button
          onClick={handleSubmit}
          className="w-full mt-6"
          size="lg"
        >
          ✓ Uložit check-in
        </Button>
      )}
    </Card>
  );
}
```

### WeeklyCheckForm

```tsx
// src/components/checkin/WeeklyCheckForm.tsx
interface WeeklyCheckFormProps {
  onSubmit: (data: WeeklyCheckData) => void;
}

export function WeeklyCheckForm({ onSubmit }: WeeklyCheckFormProps) {
  const [currentSection, setCurrentSection] = useState(0);
  const [responses, setResponses] = useState<Record<string, string | string[]>>({});

  const section = WEEKLY_SECTIONS[currentSection];
  const isLastSection = currentSection === WEEKLY_SECTIONS.length - 1;

  const handleNext = () => {
    if (isLastSection) {
      onSubmit({ responses, timestamp: new Date().toISOString() });
    } else {
      setCurrentSection(prev => prev + 1);
    }
  };

  return (
    <Card className="p-6">
      {/* Progress */}
      <div className="flex gap-1 mb-6">
        {WEEKLY_SECTIONS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded",
              i <= currentSection ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Current Section */}
      <h2 className="text-xl font-semibold mb-6">{section.title}</h2>

      <TagGrid
        tags={section.tags}
        selected={
          Array.isArray(responses[section.id])
            ? responses[section.id] as string[]
            : responses[section.id]
              ? [responses[section.id] as string]
              : []
        }
        onChange={(selected) => {
          setResponses(prev => ({
            ...prev,
            [section.id]: section.type === "single_select" ? selected[selected.length - 1] : selected,
          }));
        }}
        maxSelect={section.maxSelect || (section.type === "single_select" ? 1 : 5)}
      />

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => setCurrentSection(prev => prev - 1)}
          disabled={currentSection === 0}
        >
          ← Zpět
        </Button>
        <Button onClick={handleNext}>
          {isLastSection ? "Dokončit ✓" : "Další →"}
        </Button>
      </div>
    </Card>
  );
}
```

### MonthlyReviewForm

```tsx
// src/components/checkin/MonthlyReviewForm.tsx
// Podobná struktura jako WeeklyCheckForm, ale s více sekcemi
// a speciálními komponenty pro dimension rating a frequency matrix
```

---

## 📊 Data Model

### DB Schema

```sql
-- Periodic check-ins table
CREATE TABLE periodic_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  check_type TEXT NOT NULL CHECK (check_type IN ('daily', 'weekly', 'monthly')),
  
  -- Common fields
  mood_tag TEXT,
  context_tags TEXT[] DEFAULT '{}',
  responses JSONB DEFAULT '{}',
  
  -- Computed scores (for trends)
  overall_score INTEGER CHECK (overall_score BETWEEN 1 AND 10),
  energy_score INTEGER CHECK (energy_score BETWEEN 1 AND 10),
  sleep_score INTEGER CHECK (sleep_score BETWEEN 1 AND 10),
  
  -- Metadata
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INTEGER, -- How long it took to complete
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE periodic_check_ins ENABLE ROW LEVEL SECURITY;

-- Users can only access their own check-ins
CREATE POLICY "Users can read own check-ins" ON periodic_check_ins
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own check-ins" ON periodic_check_ins
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Index for efficient queries
CREATE INDEX idx_periodic_checkins_user_type ON periodic_check_ins(user_id, check_type, completed_at DESC);

-- Audited RPC for reading check-ins
CREATE OR REPLACE FUNCTION get_my_periodic_check_ins_audited(
  p_check_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  check_type TEXT,
  mood_tag TEXT,
  context_tags TEXT[],
  responses JSONB,
  overall_score INTEGER,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Audit log
  INSERT INTO audit_journal (user_id, action, target_type, details)
  VALUES (auth.uid(), 'sensitive-data_READ', 'periodic_check_ins', 
    jsonb_build_object('check_type', p_check_type, 'limit', p_limit));

  RETURN QUERY
  SELECT 
    pc.id, pc.check_type, pc.mood_tag, pc.context_tags,
    pc.responses, pc.overall_score, pc.completed_at
  FROM periodic_check_ins pc
  WHERE pc.user_id = auth.uid()
    AND (p_check_type IS NULL OR pc.check_type = p_check_type)
  ORDER BY pc.completed_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION get_my_periodic_check_ins_audited FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_periodic_check_ins_audited TO authenticated;
```

---

## 🔔 Notification & Reminder System

### Check-in Reminders

```typescript
const CHECK_IN_SCHEDULE = {
  daily: {
    defaultTime: "20:00", // Večer pro reflexi dne
    reminderText: "Jak se dnes cítíš? 🌟",
    snoozeOptions: ["1h", "tomorrow"],
  },
  weekly: {
    defaultDay: "sunday", // Neděle večer
    defaultTime: "18:00",
    reminderText: "Čas na týdenní check! 📊",
    snoozeOptions: ["3h", "tomorrow"],
  },
  monthly: {
    defaultDay: "last_sunday", // Poslední neděle v měsíci
    defaultTime: "15:00",
    reminderText: "Měsíční přehled je tu! 📅",
    snoozeOptions: ["1d", "next_week"],
  },
};
```

---

## 🏆 Gamification

### Streak System

```typescript
const STREAK_REWARDS = [
  { days: 3, badge: "🔥", title: "3 dny v řadě!" },
  { days: 7, badge: "⭐", title: "Týdenní streak!" },
  { days: 14, badge: "🌟", title: "2 týdny!" },
  { days: 30, badge: "🏆", title: "Měsíční mistr!" },
  { days: 60, badge: "💎", title: "2 měsíce!" },
  { days: 90, badge: "👑", title: "Čtvrtletní šampion!" },
];
```

### Progress Visualization

```tsx
// Trend chart showing mood/energy over time
// Weekly comparison cards
// Monthly heatmap calendar
```

---

## 📱 Mobile UX

### Swipe Interface

- Swipe left/right pro výběr nálady
- Tap pro context tagy
- Pull-to-refresh pro nový check-in

### Widget Support (Future)

- iOS Widget pro daily check-in
- Android Widget
- Apple Watch complication

---

## 🎯 Metriky úspěchu

| Metrika | Cíl |
|---------|-----|
| Daily completion rate | > 60% |
| Weekly completion rate | > 80% |
| Monthly completion rate | > 90% |
| Average daily check time | < 30s |
| 7-day streak retention | > 40% |

---

## 🚀 Implementační plán

### Fáze 1: Daily Check
- [ ] `DailyMoodPicker` component
- [ ] DB migrace
- [ ] Základní UI
- [ ] Unit testy

### Fáze 2: Weekly Check
- [ ] `WeeklyCheckForm` component
- [ ] Progress visualization
- [ ] i18n

### Fáze 3: Monthly Check
- [ ] `MonthlyReviewForm` component
- [ ] Partner dashboard integration
- [ ] Export pro konzultace

### Fáze 4: Polish
- [ ] Streak system
- [ ] Notifications
- [ ] Trend charts
- [ ] A/B testing

---

**Status:** 📝 Návrh - připraveno k implementaci  
**Related:** [TAG_BASED_CHECKIN.md](TAG_BASED_CHECKIN.md), [TAG_BASED_ONBOARDING_QUESTIONNAIRE.md](TAG_BASED_ONBOARDING_QUESTIONNAIRE.md)

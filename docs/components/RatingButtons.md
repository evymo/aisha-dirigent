# RatingButtons Component

Optimalizovaná komponenta pro rychlé hodnocení s plnou podporou přístupnosti.

## Použití

### Základní varianta (číselná)

```tsx
import { RatingButtons } from "@/components/ui/rating-buttons";

<RatingButtons
  value={painLevel}
  onChange={setPainLevel}
  min={0}
  max={10}
  labels={{
    low: "Bez bolesti",
    high: "Silná bolest",
  }}
/>
```

### Varianta s emoji (připraveno pro budoucnost)

```tsx
const moodIcons = ["😢", "☹️", "😐", "🙂", "😊", "😄", "🤩"];

<RatingButtons
  value={mood}
  onChange={setMood}
  min={0}
  max={6}
  icons={moodIcons}
  labels={{
    low: "Velmi špatná",
    high: "Skvělá",
  }}
/>
```

## Vlastnosti

| Prop | Typ | Výchozí | Popis |
|------|-----|---------|-------|
| `value` | `number \| undefined` | - | **Povinné.** Aktuálně vybraná hodnota |
| `onChange` | `(value: number) => void` | - | **Povinné.** Callback volaný při změně |
| `min` | `number` | `0` | Minimální hodnota |
| `max` | `number` | `10` | Maximální hodnota |
| `labels` | `{ low: string; high: string }` | - | Popisky pro nízkou a vysokou hodnotu |
| `icons` | `string[]` | - | Emoji/ikony pro jednotlivé hodnoty |
| `disabled` | `boolean` | `false` | Zakázat interakci |
| `className` | `string` | - | Dodatečné CSS třídy |

## Přístupnost (A11y)

- ✅ **WCAG AA compliant** - Kontrast barev splňuje normy
- ✅ **Keyboard navigation** - Plná podpora Tab, Enter, Space
- ✅ **Screen readers** - Správné ARIA atributy (`role="radiogroup"`, `aria-checked`)
- ✅ **Focus management** - Viditelný focus ring
- ✅ **Touch targets** - Min. 44px výška (iOS/Android guidelines)

## Výhody oproti Slider

1. **Rychlejší input** - Jeden klik místo drag operace
2. **Lepší na mobilu** - Velké dotykové plochy
3. **Vizuální feedback** - Okamžitě vidíte vybranou hodnotu
4. **Přístupnější** - Lepší pro screen readery i klávesnici
5. **Menší chybovost** - Přesná volba, ne "přibližné táhnutí"

## UX Design

- **Animace**: Jemné `scale` transformace při hover/select
- **Barvy**: Organic design system (zelená primary, krémové pozadí)
- **Spacing**: Optimální mezery pro dotyková zařízení
- **Responsive**: Grid 6 sloupců na mobilu, 11 na desktopu

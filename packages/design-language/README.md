# @aisha/design-language

The design language every AISHA surface is drawn in — tokens, utility classes
and 20 presentational components. One language, many brands: an instance
re-skins the whole extranet by overriding **semantic tokens** in its overlay and
ships no code.

Not to be confused with `@aisha/design-tokens`, which brands the stack's
**internal** surfaces (setup cockpit, admin). This package is the
**customer-facing** design system.

---

## The one rule

> **Components read semantic, functional and structural tokens — never a named
> brand scale.**

That is what makes the language re-brandable. A component that reaches for
`--ignition-500` has silently pinned one customer's amber into the product; the
next instance then has to fork the component instead of shipping a colour.

---

## Four layers, three owners

| # | layer | lives in | owner |
|---|---|---|---|
| 1 | **structure** — type scale, spacing, radii, shadows, motion | this package | the language |
| 2 | **functional colour** — `--gain` `--loss` `--warning` `--info` | this package | the language |
| 3 | **semantic tokens** — `--bg` `--surface` `--text` `--primary` … | this package *(defaults)* → **overridden by the instance** | the instance |
| 4 | **brand palette** — named scales (`--carbon-900`, `--ignition-500`, sector tints) | `instances/<slug>/public/tokens.css` | the instance |

Layer 2 belongs to the language on purpose: **red means loss and green means
gain everywhere, always paired with a sign or arrow.** Re-branding those would
change meaning, not looks.

### Why `:where()`

Every token block in `styles.css` is wrapped in `:where(…)` → **zero
specificity**. The built bundle's CSS loads *after* the instance's
`/tokens.css`, so without this the package defaults would win on load order and
the overlay would appear to do nothing. If you add a token block, wrap it.

---

## Two themes, pure CSS

`carbon` (dark cockpit signature) and `daylight` (light surface for documents,
reports, contracts). `<Theme name="carbon">` sets `data-theme` on its own
`<div>`; every descendant reads the right values. **No provider, no context** —
so a Daylight report panel can nest inside a Carbon dashboard.

```tsx
<Theme name="carbon" padded>
  <KpiTile caption="Operating efficiency" value="82.4 %" delta="−1.8 %" deltaDirection="down" />
</Theme>
```

---

## Rules that override aesthetics

1. **One primary action per view.** Never tint whole panels with the signal colour.
2. **Red = loss, green = gain, always with a sign.** Use `Delta`, never colour alone.
3. **No number without a source.** Every data value, chart and AI answer carries a
   `ProvenanceBadge` (source · freshness). This is the visible face of the block
   contract's mandatory `provenance`.
4. **Edges over shadows** — separate with a 1px border.
5. **Motion ≤ 240 ms**, and `prefers-reduced-motion` is honoured in the stylesheet.

---

## Localisation

The package ships **no locale**. Every user-visible string is a prop with a
neutral English fallback (`ProvenanceBadge.sourceLabel`, `StatusChip` children,
`LiveIndicator.label`, `AskPanel.placeholder`, `ThemeToggle.ariaLabel`). The
shell passes translated text, because translations are managed centrally by key
— the same way pages and questionnaires are.

A default that renders Czech would make the language un-shippable to the next
customer, and the failure would be invisible until someone opened it in English.

---

## Re-branding for a new instance

1. Copy `instances/_default/public/tokens.css` to `instances/<slug>/public/`.
2. Define the brand palette (your neutrals, your signal colour).
3. Map it onto the semantic tokens under `:root` / `[data-theme="daylight"]` /
   `[data-theme="carbon"]`. Plain selectors — they beat the package defaults.
4. Load your fonts there if they differ.

No component changes. If a re-skin requires touching `apps/*-shell` or this
package, something has leaked out of layer 3/4 — that is the bug to fix.

---

## Composing a surface

Masks map onto components one-to-one:

| block_type | components |
|---|---|
| `kpi_tile` | `KpiTile` + `Delta` |
| `chart` | `ChartCard` + `Sparkline` |
| `table` | `DataTable` |
| `review_queue` | `Card` + `StatusChip` + `Button` |
| `record_detail` | `Card` + `DataTable` |
| `findings` / `alert_feed` | `Card` + `StatusChip` |
| `narrative` | `Card` + `.rdl-body` |
| every block | `ProvenanceBadge` |

Style your own layout with the tokens and `rdl-*` utilities — never raw hex.

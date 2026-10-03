# Terminology Context Translation Skill

## Cíl

Jednotný workflow pro bezpečnou změnu terminologie napříč:

- web i18n segmenty (`src/i18n/segments`)
- mobile i18n (`mobile-app/src/i18n` a `mobile-app/src/i18n/web`)
- DB source-of-truth překlady (`supabase/seed/translations`)

Skill je určený pro kontextové přepisy typu:

- `user/uživatel` -> `member/člen`
- `product/produkt` -> `preparation/preparát` (dle kontextu často `product preparation`)
- `purchase/buy/nákup` -> `order/request/objednat` (dle kontextu předplatné vs objednávka)

## Kontextová pravidla

- **Modern UI/obsah** (`partner`, `admin`, `member`, `shop`, `checkout`, `protocol`, `distribution`) -> automatický přepis.
- **Historické/archivní materiály** (`archive`, `excerpt`, `timeline`, `editorial`, `whitepaper`, `story`) -> pouze `review`, bez auto přepisu.
- **Technické řetězce** (`namespace: products`, `products.*`, URL `/products`, placeholdery) -> bez přepisu.
- **Vědecké výjimky** (např. `products of aerobic metabolism`) -> bez přepisu.

## Příkazy

Audit všech vrstev:

```bash
npm run i18n:terminology:audit -- --json /tmp/terminology-audit.json --limit 200
```

Aplikace všech bezpečných (actionable) přepisů napříč web+mobile+seed:

```bash
npm run i18n:terminology:apply
```

Jen web:

```bash
npm run i18n:terminology:apply:web
```

Jen mobile:

```bash
npm run i18n:terminology:audit -- --scope mobile --apply
```

Jen DB seed překlady:

```bash
npm run i18n:terminology:audit -- --scope seed --apply
```

## DeepL doplnění (missing klíče)

DeepL klíč je brán z root `.env`.

```bash
set -a; source .env; set +a
npm run i18n:segments:report-missing
npm run i18n:segments:translate-missing -- --write
npm run i18n:mobile:translate-all-langs
```

Poznámka: Tyto příkazy řeší hlavně chybějící překlady. Terminologické přepisy v existujících hodnotách dělá `terminology-context-audit.mjs`.

## Validace po změnách

```bash
npm run i18n:terminology:audit -- --limit 120
npm run i18n:segments:check
npm run i18n:mobile:check
```

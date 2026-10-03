# Web templates (`domains/templates/<name>/`)

Brand-neutral, OSS **reference web designs** an operator can pick as the starting
point for their instance. A template is a *public reference implementation* —
the same slot `aisha.guru` fills privately for our own production.

## The model: structures in the base, content in the instance

| Layer | What it is | Where it lives |
|---|---|---|
| **Platform default** (`AISHA_SEED_PROFILE=platform`) | ready-to-run skeleton: admin + services, **empty content tables**, no PII | the OSS base |
| **Opt-in demo** (`AISHA_SEED_PROFILE=demo`/`full`) | the skeleton **+** showcase fixtures — strictly opt-in | `aisha/db/seed/demo/` |
| **Templates** (this folder) | brand-neutral *structures* the operator fills | committed, OSS |
| **Instance** | the operator's **content + brand** | their DB rows / private implementation / repo (never the base) |

A template **ships empty and functional**. Its data-driven sections are *live
runtime blocks* that render the operator's own rows the moment they add them in
admin. We do **not** pre-seed fake products/articles — that data is *instance
data* by definition (the operator replaces it). "Demo" content, when wanted, is
the opt-in `demo` profile, not per-template fixtures.

Seed a template as an instance's web:

```
AISHA_SEED_DOMAIN=cafe-shop      # svc-web-artifact /seed-default ingests this folder
# (or /seed-default { "source_dir": "cafe-shop" })
```

## File structure

```
<name>/
  index.html        # the page; static chrome (data-i18n-key) + live runtime blocks
  styles.css        # layout/chrome, reads the --color-* tokens
  tokens.css        # the palette (see "Theming" — this is the load-bearing convention)
  manifest.json     # { title_key, description_key, slug }  (or pages[] for multi-page)
  i18n.json         # every data-i18n-key value, in all 6 locales (en cs de fr ru th)
```

## Theming — the one convention that matters

The page is rendered by `PageRenderer`, which scopes a template's CSS under
`.gjs-page-content` and maps the canvas-root selectors (`:root`/`html`/`body`)
to the wrapper **itself** (see `src/components/web/scopeCanvasCss.ts`). Runtime
blocks (`product-catalog`, `knowledge-preview`, `news-list`, …) are React
components that read the **shadcn token set** via `hsl(var(--token))`.

So `tokens.css` MUST:

1. Define the shadcn token set — `--background --foreground --card
   --card-foreground --muted --muted-foreground --primary --primary-foreground
   --secondary --accent --border --ring` — as **bare-HSL triplets** (`"H S% L%"`),
   from the template's palette. **Never hex** for these — `--primary:#c98a3d`
   yields invalid `hsl(#c98a3d)` and the block silently falls back to the global
   app brand.
2. Alias the template's own semantic names to them, e.g.
   `--color-primary: hsl(var(--primary));`, so `styles.css` chrome and the live
   block share **one** palette by plain CSS inheritance — no `!important`, no JS.

Author the block as `:root { … }` (matches the GrapesJS editor); PageRenderer
maps it to `.gjs-page-content` at render. Light template → light values; dark
template → dark values (there is no `.dark` toggle on the web route).

The `web-template-runtime-blocks` gate enforces the bare-HSL rule for any
template that embeds a runtime block.

## Runtime blocks — making a section dynamic

Replace a static repeating grid with a single placeholder:

```html
<div data-runtime-block="product-catalog" data-block-config='{"columns":4}'></div>
```

- The id **must** be one of the registered blocks
  (`src/lib/builder/runtimeBlockRegistry.ts`). A missing capability is a
  follow-up Aisha-driven dev story — **never** invent a block id inline.
- When you convert a section to a block, **retire** its now-dead per-item
  `data-i18n-key`s from `i18n.json` (keep the section chrome keys). The block
  brings its own empty/loading states and its content i18n (app `shop`/`news`/
  `knowledge` namespaces).
- Match `columns` to the template's original desktop grid.

## Gates (CI-enforced)

- `web-template-i18n-integrity` — every referenced key resolves in all 6 locales,
  no orphans, no broken assets.
- `web-template-runtime-blocks` — every `data-runtime-block` id is registered (and
  the registry / detector `KNOWN_BLOCKS` / docstring lists stay in sync); deepened
  templates set the runtime-consumed shadcn tokens as bare-HSL.

## Adoption follow-ups (separate, focused PRs)

These integrate a **live path that is verified in a running stack**, so they are
intentionally NOT bundled with the template/theming work:

- **Brand-on-pick.** The setup cockpit already captures `AISHA_SEED_DOMAIN` +
  `AISHA_BRAND_*` to `.env`. The remaining piece is cold-start applying the brand:
  the operator-bootstrap (which runs as the seeded admin) reads `AISHA_BRAND_*`,
  converts HEX→HSL, and calls `set_branding_profile_admin` (the existing,
  admin-gated writer — there is no service-role seed insert for branding). This
  themes the **app chrome** per instance; it composes with the per-page template
  scope above.
- **Appsmith dashboard auto-import.** `build-aisha-appsmith.mjs` renders
  `dist/appsmith/<slug>.json` but does not push it; the multipart-import primitive
  already exists in `scripts/provision-intranet.sh`. The minimal correct seam
  imports the rendered dashboard **idempotently** (hash-skip) and **repo-wins but
  skips when `_metadata.manual_locked_widgets` is non-empty** (never clobber an
  operator's UI edits), default OFF.

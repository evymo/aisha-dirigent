# Aisha stack — default web seed

This directory is the **community-distributable, branding-neutral hello page** that
ships with every fresh Aisha stack. On first cold-start, the bootstrap chain calls
`svc-web-artifact /seed-default`, which parses `index.html` + `tokens.css` +
`styles.css` through the same ingest pipeline operators use for their own designs.
The resulting GrapesJS canvas is upserted into the `web_pages` row with
`slug='index'` and `story_id IS NULL`.

The seed is **idempotent** — re-running cold-start with the same content is a
no-op. Pass `{ "force": true }` to `/seed-default` to overwrite.

## Replacing this page

Two options, both go through the existing admin surface:

1. **Story-driven** (preferred): `/admin/stories` → new story → upload your zip
   or scrape your URL → review Aisha's suggestions → apply.
2. **Direct edit**: `/admin/pages/<id>/edit` for fine-grained GrapeJS work.

## Conventions

- **i18n keys**: every visible text node carries `data-i18n-key="web.default.*"`.
  The render side resolves through `src/i18n/segments/{en,cs}/web.json`. Add a
  new language by appending a segment file — keys are checked by
  `npm run i18n:check`.
- **No Aisha brand**: the tokens and copy are intentionally generic. Operators
  represent themselves, not us. The Aisha marketing site lives in
  `domains/templates/aisha.guru/` and is **not** the default.
- **Runtime block placeholders**: this seed has none. Operators add them via
  the admin block library.

## File layout

| File           | Role                                                              |
|----------------|-------------------------------------------------------------------|
| `index.html`   | semantic HTML5 — 1 header, 3 sections (welcome / what / cta), footer |
| `tokens.css`   | `:root` CSS custom properties (color, font, spacing)              |
| `styles.css`   | minimal layout + typography baseline                              |
| `manifest.json`| seed metadata (`title_key`, `description_key`, `slug`)            |
| `README.md`    | this file                                                         |

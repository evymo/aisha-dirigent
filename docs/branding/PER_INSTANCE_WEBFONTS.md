# Per-instance webfonts — stack vs instance-specific

Typography splits the same way everything else does in this platform: a
**stack part** (open-source, shipped in this repo, sane default) and an
**instance-specific part** (private, supplied when a concrete instance is
imported/seeded). Fonts are no exception.

## The split

| Layer | What lives here | Font behaviour |
|-------|-----------------|----------------|
| **Stack (OSS, this repo)** | The *mechanism*: the `font_faces` column, the resolver RPCs, `BrandingThemeProvider`, the admin editor. | `branding_profiles.font_faces = NULL` → the bundled OSS face **Nunito Sans** (SIL OFL 1.1) renders. No commercial binary in the repo. |
| **Instance-specific (private, on import)** | The *values*: a branding-profile row that names a licensed font and points at where the instance hosts the woff2. | `font_family_* = '<licensed font>'` + `font_faces = [{…}]` → the instance's own font renders. |

The stack never contains a commercial font binary or a commercial font name as
a default. An instance opts in by **seeding** its own branding row (or editing
it in the admin panel). Removing the instance layer falls back to the OSS
default automatically — nothing in the stack breaks.

## `font_faces` shape

A JSON array; each entry becomes one sanitised `@font-face` at runtime
(`BrandingThemeProvider.buildFontFaceCss` — only `https://` or root-relative
URLs without CSS-breaking characters are emitted):

```json
[
  {
    "family": "Avenir",
    "src_url": "https://assets.<instance-host>/fonts/avenir.woff2",
    "weight": "400 800",
    "style": "normal",
    "unicode_range": "U+0000-00FF,U+0100-017F"
  }
]
```

Only `family` + `src_url` are required. `family` must match the
`font_family_brand` / `font_family_body` token that references it.

## How an instance applies it

The font **binary is hosted by the instance** (its branding-assets host / CDN)
— it is never committed to this repo. The instance's private seed layer
(`aisha/db/seed/instance/`, the `aisha-instance-data` submodule) sets the row.
Template (no private data — illustrative only):

```sql
-- aisha/db/seed/instance/NN_branding.sql  (private overlay, applied on import)
UPDATE public.branding_profiles
SET
  font_family_brand = 'Avenir, sans-serif',
  font_family_body  = 'Avenir, sans-serif',
  font_faces = '[
    {"family":"Avenir","src_url":"https://assets.example-instance.tld/fonts/avenir.woff2","weight":"400 800"}
  ]'::jsonb
WHERE partner_id IS NULL AND status = 'published';
```

Or programmatically via the admin RPC (same effect, audited):

```sql
SELECT public.set_branding_profile_admin(
  p_font_family_brand => 'Avenir, sans-serif',
  p_font_family_body  => 'Avenir, sans-serif',
  p_font_faces => '[{"family":"Avenir","src_url":"https://assets.example-instance.tld/fonts/avenir.woff2","weight":"400 800"}]'::jsonb,
  p_publish => true
);
```

Admins can also edit `font_faces` in **Admin → Settings → Branding → Typography**
(JSON editor, validated against the same schema).

## Why it is safe / OSS-clean

- The repo ships **only** Nunito Sans (OFL). No Avenir binary, no Avenir default.
- The commercial font is the instance operator's own licence + own hosting.
- `font_faces` is sanitised at render time, so an admin-supplied URL cannot
  inject arbitrary CSS.

See also: PR #298 (Avenir → Nunito retirement), PR #302 (this seam).

# AISHA brand assets

**Single source of truth:** [`aisha-icon.svg`](./aisha-icon.svg) — the AISHA robot mark
(transparent, ember-gradient, auto-cropped).

All app icons, launcher icons, favicons, notification icons, splash images and the
n8n / workbench / extension marks are **generated** from this one file.

## Regenerate everything

```bash
npm run gen:icons
```

This runs [`scripts/gen-icons.mjs`](../scripts/gen-icons.mjs) (requires the `sharp`
devDependency) and rewrites every target in-place:

| Context | Variant |
|---------|---------|
| iOS / App Store / extension marketplace | opaque dark square tile (no alpha) |
| Android adaptive foreground, favicons, workbench Linux icons | transparent robot |
| Android notification icon | white silhouette (Android renders it as a mask) |
| Web / n8n / workbench / extension logo SVGs | robot on dark circle |
| macOS `code.icns` | rounded "squircle" tile |
| Splash | centered robot on near-black (`#0E0E10`) |

**Do not hand-edit generated icons.** Edit `brand/aisha-icon.svg` and re-run `npm run gen:icons`.

# Publishing runbook — reproducible iOS release (AISHA Dirigent)

> The whole release is reproducible from this repo: bump → build → upload → screenshots → metadata → submit.
> Every input is either in the repo or comes from the cold-start (wipe + fresh deploy), so a fresh operator can repeat it end to end.
> App: **AISHA Dirigent** · `cz.id3a.aisha.app` · iPhone + iPad. Kit lives in `mobile-app/store/`.

---

## 0. One-time machine prerequisites
- Xcode + CocoaPods; the project's **App Store Connect Apple ID signed into Xcode** (Xcode → Settings → Accounts) — that signed-in account is the upload auth, so no `.p8` API key is needed. (The specific account is not committed.)
- Build credentials (gitignored, **live in the parent checkout, not worktrees**): `mobile-app/.env.production`, `mobile-app/.env.build.local` (sets `APPLE_TEAM_ID` + signing config — values never committed), `mobile-app/GoogleService-Info.plist`. Copy them into a worktree before building there. The build + Xcode tasks read `APPLE_TEAM_ID` from the environment — no team/account code is hardcoded in the repo.
- Node 22 (`.nvmrc`).

## 1. Types are generated from the SoT (already wired)
`npm run db:types:gen` emits **both** web `src/integrations/db/types.ts` and mobile `mobile-app/src/types/database.ts` in one step (gate `db-types-mobile-web-sync.gate.test.ts` keeps them in sync). The mobile `@aisha/api-core` client is typed off it — no manual type work at release time. Faithful regen against a clean SoT: `npm run db:types:refresh:throwaway`.

## 2. Bump the build number
Edit `mobile-app/version.json` → bump `build`, `ios.buildNumber`, `android.versionCode` (App Store Connect rejects a duplicate build number for the same `version`). `app.config.ts` reads version.json, so prebuild bakes it into Info.plist.

## 3. App icon (brand) — already installed, reproducible
Source of truth: `mobile-app/trash/aisha-icon-o.png` (orange AISHA robot). Reinstall any time:
```bash
python3 - <<'PY'
from PIL import Image
src = Image.open("trash/aisha-icon-o.png").convert("RGBA")
bg = Image.new("RGB", src.size, (10,10,10)); bg.paste(src, mask=src.split()[3])
icon = bg.resize((1024,1024), Image.LANCZOS)
icon.save("assets/icon.png"); icon.save("assets/adaptive-icon.png")
icon.save("store/design/icon-1024-appstore.png")   # App Store marketing icon (no alpha)
PY
```
The source PNG already has no alpha; the flatten guarantees the App Store 1024 icon is opaque (Apple rejects alpha in the marketing icon).

## 4. Build + upload to TestFlight
```bash
cd mobile-app
./scripts/build-ios.sh --upload      # prebuild → pods → archive → export+upload (Xcode account auth)
```
Then in App Store Connect → TestFlight, the build appears "Processing" → "Ready". Hermes dSYM upload warning is non-blocking; fetch dSYMs for Sentry with `scripts/download-dsyms.sh`.

## 5. Demo account — comes from the cold-start seed (reproducible, no PII)
The reviewer + screenshot account is a **seeded** member, so it's reproducible from a wipe + fresh deploy (not a hand-made account):

- **Account:** `demo-user5@example.com` — role **Member** (synthetic `@example.com`, pre-enrolled with consent + story data → screens look populated). Defined in `aisha/db/seed/demo/00_prod_users.sql` + related demo seeds; applied during cold-start.
  - (Alternatives: `demo-user4/6@example.com` members; `demo-operator@example.com` partner; `demo-admin@example.com` admin.)
- **Password:** set during cold-start seeding. After the **wipe + fresh deploy from scratch**, take the demo member password from the cold-start operator output and record it in `SUBMISSION_SETTINGS.md` → App Review Information (and use it for screenshots below). *Do not commit the password.*
- ⚠️ `00_prod_users.sql` is flagged for a synthetic-PII scrub (`[[security_demo_prod_users_pii]]`) — the `@example.com` members are the safe demo identities to expose to review.

## 6. Screenshots — reproducible from the simulator
Native simulator screenshots = exact App Store sizes (no resize). After the app is installed on the simulator (`npx expo run:ios --device "iPhone 17 Pro Max"`), and signed in once with the demo account:
```bash
./store/capture-screenshots.sh en-US iphone69     # iPhone 17 Pro Max → 1320×2868
./store/capture-screenshots.sh cs    iphone69
./store/capture-screenshots.sh en-US ipad13       # iPad Pro 13" (M5) → 2064×2752
./store/capture-screenshots.sh cs    ipad13
```
Captures the 6 marketing screens (deep-linked) into `store/screenshots/<locale>/<device>/`. Login is the one manual step (OAuth sheet isn't scriptable). See `SCREENSHOTS_PLAN.md` for the fully-unattended Maestro option.

## 7. App Store metadata
Paste from the kit:
- Listing (EN + CS): `APP_STORE_LISTING.md`
- App Privacy nutrition label: `APP_PRIVACY.md`
- Category / age rating / export compliance / review notes: `SUBMISSION_SETTINGS.md`
- Marketing icon: `design/icon-1024-appstore.png`; banner: `design/aisha-brand-banner.png`
- Screenshots: from step 6.

## 8. Pre-submit gate (`PUBLISHING_CHECKLIST.md`)
Privacy Policy + Support URLs live · demo account filled · screenshots present · category set · `PrivacyInfo.xcprivacy` present · in-app account deletion reachable.

## 9. Submit
Select the build → fill metadata → Submit for Review (or distribute via a TestFlight external group + Beta App Review).

---

### Reproducibility summary
| Input | Source (reproducible) |
|---|---|
| Types | `npm run db:types:gen` from SoT DB |
| Icon | `trash/aisha-icon-o.png` → step 3 script |
| Build number | `version.json` |
| Build + upload | `scripts/build-ios.sh --upload` (auth = the Apple ID signed into Xcode) |
| Demo account | cold-start seed (`demo-user5@example.com`); password from post-wipe operator output |
| Screenshots | `store/capture-screenshots.sh` (simulator, native sizes) |
| Metadata | `store/*.md` (committed) |

The only non-repo input is the demo password (provided once after a fresh deploy) — by design, never committed.

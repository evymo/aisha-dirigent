# Publishing checklist — AISHA Dirigent (iOS)

> Master index for App Store / TestFlight submission. Files referenced live in `mobile-app/store/`.
> App: **AISHA Dirigent** · `cz.id3a.aisha.app` · v1.0.0 (build 6) · iPhone + iPad.

## What's in this kit
| File | Contents |
|---|---|
| **`PUBLISHING_RUNBOOK.md`** | **Start here** — the reproducible end-to-end release (bump → build → upload → demo account from cold-start → screenshots → metadata → submit). |
| `APP_STORE_LISTING.md` | Name, subtitle, promo, description, keywords, what's-new, URLs — **EN + CS**, copy-paste ready. |
| `APP_PRIVACY.md` | App Privacy nutrition-label answers (health-data accurate) + privacy-manifest + account-deletion actions. |
| `SUBMISSION_SETTINGS.md` | Category, age rating, export compliance, **App Review demo-account + notes**, TestFlight. |
| `SCREENSHOTS_PLAN.md` | Required sizes, screen order, EN/CS captions, capture instructions. |
| `capture-screenshots.sh` | One-keypress simulator capture loop → correctly-named PNGs. |
| `design/` | **New brand icon** (orange AISHA robot) installed as the app icon + **`icon-1024-appstore.png`** (1024², no alpha — ready to upload). Plus `aisha-brand-banner.png` (locomotive marketing banner) + `aisha-guru-pruvodce.png`, `splash.png`, `adaptive-icon.png`. |
| `screenshots/` | Drop captured PNGs here (created on first capture run). |

## Status

### ✅ Done (in this kit)
- [x] Listing copy — EN + CS, within character limits.
- [x] App Privacy nutrition-label mapping (data types, purposes, "not used to track").
- [x] Submission settings (category guidance, age rating, export-compliance = exempt, review notes).
- [x] Screenshot plan + captions + capture script.
- [x] **New brand icon installed** (orange AISHA robot, from `trash/aisha-icon-o.png`) → `assets/icon.png` + `assets/adaptive-icon.png` + `design/icon-1024-appstore.png` (all 1024², no alpha). Use `design/icon-1024-appstore.png` for the ASC marketing icon.
- [x] **Build 6** (old icon) uploaded to TestFlight — functional build for testing.
- [⏳] **Build 7** (NEW icon) building + uploading — **this is the build to submit** (1.0.0/7).

### ⚠️ Must do before you can submit (blocking)
- [ ] **Privacy Policy URL live** — `https://aisha.guru/privacy` (or final URL) must resolve. Required for review.
- [ ] **Support URL live** — `https://aisha.guru/support` (or final URL).
- [ ] **Demo/review account** — seed a member account + put credentials in `SUBMISSION_SETTINGS.md` → App Review Information. Without it a login-gated health app is auto-rejected.
- [ ] **Screenshots captured** — run `capture-screenshots.sh` for iPhone 6.9" (+ iPad 13" if keeping universal). 6 screens, EN + CS.
- [ ] **Category** — set primary to Health & Fitness (or Medical); update `version.json` `app.category` + ASC to match.
- [ ] **`PrivacyInfo.xcprivacy`** present in the build with Required-Reason-API + data-type declarations (build script warns if missing). Confirm it's in `mobile-app/`.
- [ ] **In-app account deletion** reachable (Guideline 5.1.1(v)) — confirm Settings exposes it or document the support route.

### ◻️ Decide
- [ ] **iPhone-only vs universal?** App is `supportsTablet: true` → iPad screenshots required. Either capture iPad shots or set the app to iPhone-only in ASC.
- [ ] **Public App Store vs TestFlight-only** distribution (members are invite-based). TestFlight external groups need Beta App Review; internal testers don't.
- [ ] **Rewards/leaderboard** confirmed non-monetary (affects age rating "Contests").

## Submit flow (once blocking items are green)
1. **App Store Connect → My Apps** → create the app record if new (bundle `cz.id3a.aisha.app`, primary language English).
2. Wait for **build 6** to finish processing under **TestFlight** (email arrives; ~10–30 min after upload). Answer export compliance if prompted (→ exempt).
3. Internal testing: add the build to an internal group → it's testable immediately.
4. App Store tab: paste **APP_STORE_LISTING.md** fields (EN primary, add CS localization), set **category**, upload **icon-1024-appstore.png** + **screenshots**, set **age rating**, fill **App Privacy** from `APP_PRIVACY.md`, fill **App Review Information** from `SUBMISSION_SETTINGS.md` (incl. demo account), set **Privacy Policy URL**.
5. Select build 6 → **Submit for Review** (or distribute via TestFlight external group + Beta App Review).

## Verify the upload landed
- App Store Connect → TestFlight → iOS builds → **1.0.0 (6)** appears "Processing" then "Ready to Submit".
- dSYMs: `scripts/download-dsyms.sh` (for Sentry symbolication) after processing.

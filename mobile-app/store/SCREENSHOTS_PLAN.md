# Screenshots — plan, sizes, captions, capture kit

## Required sizes (App Store Connect, 2026)

The app is **universal** (`ios.supportsTablet: true`), so **iPad screenshots are required** unless you set the app to iPhone-only in ASC.

| Device class | Pixel size (portrait) | Required? | Covers |
|---|---|---|---|
| iPhone 6.9" (16 Pro Max / 15 Pro Max) | **1320 × 2868** | ✅ required | all modern iPhones (one 6.9" OR 6.7" set is mandatory) |
| iPhone 6.7" (14/15 Plus, 13 Pro Max) | 1290 × 2796 | alt to 6.9" | — |
| iPad 13" (M4) / 12.9" | **2064 × 2752** (or 2048 × 2732) | ✅ required *(universal app)* | all iPads |

- 3–10 screenshots per device class per locale. Aim for **6**.
- Portrait orientation (app is `orientation: portrait`).
- No alpha, sRGB/P3, PNG or JPEG.
- **Decision:** if you'd rather not ship iPad shots, set the app to **iPhone only** in ASC (App → General → check only iPhone). Otherwise iPad shots are mandatory.

## Screen order + captions (marketing-ordered)

Capture these 6 screens. Captions are short overlay text (optional but recommended); EN + CS provided.

| # | Screen (route) | EN caption | CS caption |
|---|---|---|---|
| 1 | Home / dashboard (`(tabs)/index`) | "Your day, at a glance" | "Váš den na jednom místě" |
| 2 | Your story — board + timeline (`(tabs)/projects`, `project/[id]`) | "Follow every step of your story" | "Sledujte každý krok svého příběhu" |
| 3 | Studies — discover & enroll (`studies`, `study/[id]`) | "Join studies that fit you" | "Zapojte se do studií pro vás" |
| 4 | Health check-in + trends (`health`) | "Track how you feel" | "Sledujte, jak se cítíte" |
| 5 | AISHA chat (`project/[id]` → Chat / AISHA) | "Ask AISHA about your story" | "Zeptejte se AISHY na svůj příběh" |
| 6 | Privacy & consents (`privacy`) | "Your data, your rules" | "Vaše data, vaše pravidla" |

Optional extras (if you want 7–8): Questionnaire (`questionnaire/[id]`), Wallet & services (`(tabs)/wallet`), Leaderboard (`leaderboard`).

## Capture kit

`store/capture-screenshots.sh` boots the right simulators and gives you a one-keypress capture loop that writes correctly-named, correctly-sized PNGs into `store/screenshots/<locale>/<device>/`.

**Prerequisites for real screenshots** (the app is login-gated):
1. A **simulator build** of the app: `npx expo run:ios` (debug) or a Release simulator build.
2. A **test/demo account** to log in (the same one you give App Store review — see SUBMISSION_SETTINGS.md).
3. The backend reachable from the Mac (production gateway, or a seeded demo backend).

Because capture needs the app running + a login, it is a **separate runnable step** from the device archive build. Run it after the upload, or hand it to whoever has a test account. (Fully-automated capture is also possible via a Maestro flow or `fastlane snapshot` UITest — ask and it can be added.)

### Naming convention (fastlane deliver-compatible)
```
store/screenshots/en-US/
  iphone69/  01_home.png 02_story.png 03_studies.png 04_health.png 05_aisha.png 06_privacy.png
  ipad13/    01_home.png ...
store/screenshots/cs/
  iphone69/ ...
  ipad13/ ...
```

### Framing tips
- Use a clean demo account with realistic (non-PII, synthetic) data so the screens look populated, not empty.
- Hide the status-bar clutter: `xcrun simctl status_bar booted override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`.
- Keep captions in the top ~20% if you add an overlay; leave the live UI readable.

## Can the framework auto-generate these? — yes

- **Sizes are free.** A simulator screenshot (`xcrun simctl io screenshot`) is captured at the device's **native resolution**, which is exactly the App Store size. Boot **iPhone 17 Pro Max** → 1320×2868 (6.9"), **iPad Pro 13-inch (M5)** → 2064×2752 (13"). No resizing/letterboxing needed.
- **Build for the simulator** with Expo: `npx expo run:ios --device "iPhone 17 Pro Max"` (builds, installs, launches). Repeat for the iPad device.
- **Navigation** is automated via the app's own **expo-router deep links** (scheme `aisha-dirigent://studies`, `…/health`, `…/privacy`, …) — `capture-screenshots.sh` does this.
- **The one manual step: login.** The OAuth/Keycloak sign-in uses the system auth sheet, which isn't scriptable. Log in **once** per simulator when the script prompts; everything after is automatic.
## Automated capture (Maestro — reuses the E2E tests) ✅ implemented

The screen walk we run as a test IS the capture. `e2e/flows/smoke/post-login-navigation.yaml`
navigates the 6 marketing screens, `assertVisible` each (the test), and `takeScreenshot`
each at native = App-Store resolution. The wrapper boots the right sim, sets a clean
9:41 status bar + the locale, and runs it:

```bash
# one-time per sim: install the app
npx expo run:ios --configuration Release --device "iPhone 17 Pro Max"
npx expo run:ios --configuration Release --device "iPad Pro 13-inch (M5)"

# capture (per locale × device) — writes store/screenshots/<locale>/<device>/*.png
./store/capture-screenshots-maestro.sh en-US iphone69
./store/capture-screenshots-maestro.sh cs    iphone69
./store/capture-screenshots-maestro.sh en-US ipad13
./store/capture-screenshots-maestro.sh cs    ipad13
```

### Auth for capture — systematic, no app-side exception
Production ships **OAuth-only** (Keycloak); there is **no test/password backdoor in the
app**. The capture needs the app in a **signed-in session**. Two supported ways:

1. **Standard sign-in (zero code change):** sign in once via OAuth in the booted sim; the
   session persists in the keychain, so every subsequent `capture-screenshots-maestro.sh`
   run reuses it (no re-login). The OAuth system sheet is the only non-scriptable step.
2. **Unattended against a LOCAL stack (no prod secret):** bring up the local stack, obtain a
   **refresh token** for the seeded local demo user from the **local** Keycloak (Direct
   Grant), and let the app re-establish the session through its **existing**
   `authService.restoreFromRefreshToken` abstraction (the same path biometric unlock uses) —
   not a new auth method. Disabling the demo user in Keycloak disables it everywhere.

For **App Store review**, none of this is needed: a reviewer (a human) signs in on the
Keycloak web page with the demo account from *App Review Information* (see
`SUBMISSION_SETTINGS.md`). The demo user is enabled for review and disabled afterwards.

> The earlier interactive `./store/capture-screenshots.sh` (manual login + per-screen
> keypress) still works and needs no Maestro; the Maestro path above is the unattended one.


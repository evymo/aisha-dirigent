# App Privacy — nutrition label answers (App Store Connect)

> Fill these into **App Store Connect → App Privacy**. This app handles **sensitive health data**, so accuracy matters and Apple reviews it closely.
> Verified against the app's actual data flows (auth, health check-ins, questionnaires, consents, chat, push, wallet). Anything marked ⚠️ VERIFY needs a human confirm against the backend before you publish.

## Headline answers

- **Do you or your third-party partners collect data from this app?** → **Yes**
- **Is data used to track you?** → **No.** The app ships the `withRemoveAdId` config plugin (strips the Android advertising ID) and has **no advertising or cross-app-tracking SDKs**. Answer **"Data is NOT used to track you."**
- **Account required?** Yes — sign-in via the organization's identity provider (Keycloak / OIDC).

## Data types collected

Each row → in ASC pick the type, then **Linked to the user: Yes** (the app is account-based) and **Used for tracking: No**, with the purposes listed.

| ASC category → type | Collected | Linked | Purpose(s) | Notes |
|---|---|---|---|---|
| **Contact Info → Email address** | Yes | Yes | App Functionality | From the identity provider at sign-in. |
| **Contact Info → Name** | ⚠️ VERIFY | Yes | App Functionality | If profile/display name is stored. |
| **Health & Fitness → Health** | **Yes** | Yes | App Functionality | Daily check-ins (mood, energy, sleep, pain, medication), questionnaire responses, study participation. **Sensitive.** |
| **Identifiers → User ID** | Yes | Yes | App Functionality | Account/member ID. |
| **Identifiers → Device ID** | Yes | Yes | App Functionality | Push-notification token / device session (FCM/APNs). |
| **User Content → Other user content** | Yes | Yes | App Functionality | Chat messages (AISHA + care-team), timeline/journal entries, uploaded documents. |
| **Diagnostics → Crash Data** | Yes | ⚠️ VERIFY | App Functionality | Sentry. Linked only if user context is attached — confirm Sentry `setUser` usage. |
| **Diagnostics → Performance Data** | Yes | ⚠️ VERIFY | App Functionality | Sentry performance tracing. |
| **Financial Info → Other financial info** | ⚠️ VERIFY | Yes | App Functionality | Cosmos wallet address (a blockchain identifier) + subscription status. **No card/payment data is entered in the app.** |

## Data types NOT collected (answer "No")

Precise/Coarse Location · Contacts · Browsing History · Search History · Photos/Videos (unless document upload uses the photo library — ⚠️ VERIFY) · Audio Data (voice/PTT is **not** shipped in build 6) · Purchases (no in-app purchases) · Advertising Data · Sensitive Info beyond health (no race/religion/orientation fields) · Gameplay Content · Customer Support free-text beyond the in-app messaging already covered.

## Plain-language privacy summary (for the Privacy Policy page + reviewer notes)

> AISHA Dirigent collects only what it needs to run your health/research programme: your sign-in identity, the health information you choose to log, your questionnaire answers, your consents, and the messages you send. It is all linked to your account so it can be shown back to you and to your care team. We use crash/performance diagnostics to keep the app stable. **We do not track you across other apps, we show no ads, and we never sell your data.** You can review or withdraw any consent in Settings → Privacy at any time.

## Privacy manifest (PrivacyInfo.xcprivacy)

iOS requires a privacy manifest in the build. The build script warns if `mobile-app/PrivacyInfo.xcprivacy` is missing.
- ⚠️ **ACTION:** confirm `PrivacyInfo.xcprivacy` exists and declares: collected data types (above) + **Required Reason API** declarations for any of: `UserDefaults`, file timestamp, system boot time, disk space APIs (Expo/RN SDKs commonly trip these). See SCREENSHOTS_PLAN.md → checklist. Without it, upload/processing can be rejected.

## Account deletion (App Store Guideline 5.1.1(v))

Apps with account creation **must** offer in-app account deletion (or a clear path to it).
- ⚠️ **ACTION:** confirm Settings exposes "Delete account" (or a documented support route). Reviewers check this for any login-gated app.

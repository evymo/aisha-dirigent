# Submission settings — categories, age rating, export compliance, review info

## Categories
- **Primary (recommended): Health & Fitness** — accurate for a health-tracking + research app and lighter review than Medical.
  - Alternative: **Medical** — most precise (clinical questionnaires/consent) but Apple expects a recognized medical entity as seller and applies stricter review. Choose only if the seller account is such an entity.
  - ⚠️ `version.json` currently sets `public.app-category.productivity` (used for `LSApplicationCategoryType`). Update version.json + the ASC category to match the chosen category before submitting.
- Secondary (optional): Medical *(if primary is Health & Fitness)*.

## Age rating
Answer the ASC age questionnaire as:
- **Medical/Treatment Information:** Yes → expect a **17+** rating (or 12+ under the new system). This is expected for a health app.
- Violence / Sexual content / Profanity / Horror / Gambling (real-money): **None**.
- ⚠️ **Rewards / leaderboard:** confirm rewards are non-monetary (points/badges), NOT real-money gambling — if so, "Contests" = none.
- Unrestricted web access: **No** (no in-app browser to arbitrary web).
- User-generated content: the in-app messaging is **private** (member ↔ care team / AISHA), not a public social feed. If Apple flags UGC, be ready to describe moderation (messages are between a member and their care team only).

## Export compliance (encryption)
- The app sets **`ITSAppUsesNonExemptEncryption = false`** (and `ios.config.usesNonExemptEncryption: false`) in `app.config.ts` → already baked into Info.plist.
- Result: uses only standard encryption (HTTPS/TLS) → **exempt**; App Store Connect will not prompt per build. No CCATS / year-end self-classification report needed.

## App Review Information (App Store Connect → App Review Information)

**Sign-in is required** (Keycloak / OIDC). A health app behind a login is **rejected without working review credentials.** The demo account is **seeded by the cold-start** (reproducible from a wipe + fresh deploy — see PUBLISHING_RUNBOOK.md §5), not hand-made:

```
Sign-in required:        YES
Demo account username:   demo-user5@example.com   (seeded MEMBER, pre-enrolled with story + consent data)
Demo account password:   ⚠️ FILL IN from the cold-start operator output after the fresh deploy (do NOT commit)
```

**Review notes (paste into ASC, fill the ⚠️ bits):**
```
AISHA Dirigent is a companion app for members of partner health and research
programmes. Please sign in with the demo account above (organization SSO).

After signing in you can:
• Home — daily overview and gamification.
• Your story — a board + timeline of the member's care/research journey.
• Studies — browse studies, review details, give consent, enrol.
• Health — log a daily check-in (mood/sleep/pain/energy) and view trends.
• Ask AISHA — open a story and use the Chat / AISHA tab to chat with the AI
  assistant and the care team.
• Privacy — review and manage consents and data-sharing.

Notes:
• Some programme-specific content requires an invitation; the demo account is
  pre-enrolled so all primary flows are reachable.
• The app does not provide medical advice/diagnosis/treatment (stated in-app).
• No in-app purchases. Sign-in via the organization identity provider.
• Backend region/data handling: see the Privacy Policy URL.
```

## Contact + routing
- **App Review contact:** name / email / phone — ⚠️ FILL IN (a monitored address; use the project's developer Apple ID — do NOT commit it).
- **Content rights:** confirm you hold rights to all content shown.
- **Account deletion path:** see APP_PRIVACY.md (Guideline 5.1.1(v)) — must be reachable in-app or clearly documented.

## TestFlight (if distributing via TestFlight rather than public App Store)
- **Beta App Description / "What to Test":** reuse the "What's New" + the review notes above.
- **Feedback email:** ⚠️ FILL IN.
- **Beta App Review** is required only for **external** groups; internal testers (up to 100, on your team) need no review and get the build as soon as it finishes processing.
- Export compliance answer (exempt) is reused for TestFlight.

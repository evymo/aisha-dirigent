# Getting Started Page — Wiring Plan ("Jak začít")

> Companion to the i18n content in `src/i18n/segments/{cs,en}/gettingStarted.json`.
> Target: public route `/getting-started` for preview users (cs + en, other languages via DeepL).

## 1. What ships

| Artifact | Path | Status |
|----------|------|--------|
| CS content segment | `src/i18n/segments/cs/gettingStarted.json` | provided |
| EN content segment | `src/i18n/segments/en/gettingStarted.json` | provided |
| Page component | `src/pages/GettingStarted.tsx` | to build (sketch below) |
| Route | `/getting-started` in `src/router.tsx` | to add |
| Footer link | `src/components/layout/Footer.tsx` | to add |

Content structure (namespace `gettingStarted`): `meta`, `hero`, `whatIs` (stories / backend / governance / dirigent), `firstSteps` (step1–step5), `workingWithAi` (context / knowledge / verify / iterate / rules.items[]), `preview` (limits[], feedback), `closing`. All feature names match real UI strings: Příběhy/Stories, Přehled/Časová osa/Znalosti tabs (`storyDetail.tabs.*`), flowboard node kinds (`flowboard.kind.*`: Spouštěče, Agenti, Nástroje MCP, Akce, Brány), Spustit/Run + „čeká na schválení“ + „Schválit a pokračovat“ (`flowboard.page.*`, `flowboard.block.*`), „Zeptejte se AISHA“ (`flowboard.canvas.askAisha`), „Použité zdroje“ (`rag.citations.panelTitle`), faithfulness chip „Nízká věrnost — ověřte odpověď před použitím“ (`rag.chip.low`), Agent Marketplace (`/agents`), account deletion (`/account/delete`).

## 2. i18n pipeline (segments are SoT — locales are generated)

1. Drop the two segment files into `src/i18n/segments/cs/` and `src/i18n/segments/en/`.
2. Generate the remaining languages (de, fr, ru, th) with DeepL — NEVER copy EN as a fallback:
   ```bash
   DEEPL_API_KEY=… npm run i18n:segments:translate-missing
   ```
3. Rebuild compiled locales (never edit `src/i18n/locales/*.json` by hand):
   ```bash
   npm run i18n:segments:build
   npm run i18n:segments:check
   ```

The builder (`scripts/i18n/segments-build.mjs`) deep-merges every `segments/{lang}/*.json` into `locales/{lang}.json`, so the file's root key `gettingStarted` becomes the key prefix: `t("gettingStarted.hero.title")`. Arrays (`workingWithAi.rules.items`, `preview.limits`) are read with `t(key, { returnObjects: true })` — same pattern as `AccountDeletion.tsx`.

## 3. Route (`src/router.tsx`)

Add a lazy import next to the other legal/info pages (around line 78):

```tsx
const GettingStarted = lazy(() => import("./pages/GettingStarted"));
```

Register the route next to the legal pages block (around line 969, public — no `RequireAuth`, so prospective users can read it before logging in):

```tsx
<Route path="/getting-started" element={<GettingStarted />} />
<Route path="/jak-zacit" element={<Navigate to="/getting-started" replace />} />
```

The `/jak-zacit` alias mirrors the existing `/privacy` → `/privacy-policy` redirect convention and gives a Czech-friendly URL for preview onboarding e-mails.

## 4. Component sketch (`src/pages/GettingStarted.tsx`)

Reuse the legal-page layout exactly as `PrivacyPolicy.tsx` does — `Header` + centered container + `Card` sections + `Footer`:

```tsx
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

/** Getting-started mini-course for preview users. Content: i18n ns `gettingStarted`. */
export default function GettingStarted() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t("gettingStarted.meta.title")} | AISHA`;
  }, [t]);

  const rules = t("gettingStarted.workingWithAi.rules.items", { returnObjects: true }) as string[];
  const limits = t("gettingStarted.preview.limits", { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {/* Hero */}
        <div className="text-center space-y-3">
          <Badge variant="secondary">{t("gettingStarted.hero.badge")}</Badge>
          <h1 className="text-3xl font-bold">{t("gettingStarted.hero.title")}</h1>
          <p className="text-muted-foreground">{t("gettingStarted.hero.subtitle")}</p>
        </div>

        {/* Section 1 — what AISHA is: 4 sub-cards (stories, backend, governance, dirigent) */}
        <Card>
          <CardHeader><CardTitle>{t("gettingStarted.whatIs.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p>{t("gettingStarted.whatIs.intro")}</p>
            {(["stories", "backend", "governance", "dirigent"] as const).map((k) => (
              <div key={k}>
                <h3 className="font-semibold">{t(`gettingStarted.whatIs.${k}.title`)}</h3>
                <p className="text-muted-foreground">{t(`gettingStarted.whatIs.${k}.text`)}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Section 2 — first 10 minutes: numbered steps step1..step5 (ordered list styling) */}
        {/* Section 3 — working with AI: context/knowledge/verify/iterate + rules bullet list */}
        {/* Section 4 — preview: limits list + feedback card with mailto CTA */}
        <a href="mailto:ask@aisha.guru" className="...">{t("gettingStarted.preview.feedback.cta")}</a>

        {/* Closing card */}
      </div>
      <Footer />
    </div>
  );
}
```

Sections 2–4 repeat the same Card pattern; steps render as an `<ol>` over `step1`–`step5`, `rules`/`limits` as `<ul>` over the arrays. No new components, no new dependencies — only existing shadcn/ui primitives already used by `PrivacyPolicy.tsx` and `AccountDeletion.tsx`.

## 5. Footer link (`src/components/layout/Footer.tsx`)

Add the page to the `footerLinks.services` group (around line 22), reusing the segment's own key so `core.json` does not need to change in all six languages:

```tsx
{ name: t("gettingStarted.meta.title"), href: "/getting-started" },
```

Optional (nicer alignment with existing `footer.*` keys): add `footer.gettingStarted` to `segments/{lang}/core.json` instead — but that touches 6 files and requires the DeepL pass, so reuse of `gettingStarted.meta.title` is the recommended minimal wiring.

## 6. Verification checklist

1. `npm run i18n:segments:translate-missing` (with `DEEPL_API_KEY`) → de/fr/ru/th segments created.
2. `npm run i18n:segments:build && npm run i18n:segments:check` → locales regenerated, parity green.
3. `npx tsc --noEmit` / project lint.
4. Manual: open `/getting-started` logged out (public), switch cs ↔ en, click the mailto CTA, follow the footer link.
5. Confirm no hardcoded strings in the component — everything through `t()`.

## 7. Honest-content notes (for reviewers)

- The Flowboard is currently mounted at `/admin/flowboard` behind `view_admin_dashboard`/`view_staff_dashboard`; the guide therefore says flowboard access "is enabled gradually based on role and permissions" rather than promising it to everyone.
- Account deletion path is `/account/delete` (alias `/remove-account`) — the guide uses the canonical path.
- The guide makes no claims about analytics (none exist in the web app) and points feedback to ask@aisha.guru, the operator contact (Evymo).

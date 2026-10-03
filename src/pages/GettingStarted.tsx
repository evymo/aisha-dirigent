import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

/**
 * Getting-started mini-course for preview users ("Jak začít").
 * Content lives in the i18n namespace `gettingStarted` (segments are the SoT;
 * cs+en hand-written, other locales via DeepL). Layout mirrors the legal pages
 * (PrivacyPolicy.tsx): Header + centered cards + Footer, public route.
 */

/** One titled subsection (title + text) inside a section card. */
function SubSection({ titleKey, textKey }: { titleKey: string; textKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{t(titleKey)}</h3>
      <p className="text-sm text-muted-foreground">{t(textKey)}</p>
    </div>
  );
}

export default function GettingStarted() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t("gettingStarted.meta.title")} | AISHA`;
  }, [t]);

  // Arrays are read with returnObjects — same pattern as AccountDeletion.tsx.
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
          <p className="text-muted-foreground max-w-2xl mx-auto">{t("gettingStarted.hero.subtitle")}</p>
        </div>

        {/* 1 — What AISHA is and how it thinks */}
        <Card>
          <CardHeader>
            <CardTitle>{t("gettingStarted.whatIs.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gettingStarted.whatIs.intro")}</p>
            <SubSection titleKey="gettingStarted.whatIs.stories.title" textKey="gettingStarted.whatIs.stories.text" />
            <SubSection titleKey="gettingStarted.whatIs.backend.title" textKey="gettingStarted.whatIs.backend.text" />
            <SubSection titleKey="gettingStarted.whatIs.governance.title" textKey="gettingStarted.whatIs.governance.text" />
            <SubSection titleKey="gettingStarted.whatIs.dirigent.title" textKey="gettingStarted.whatIs.dirigent.text" />
          </CardContent>
        </Card>

        {/* 2 — First 10 minutes */}
        <Card>
          <CardHeader>
            <CardTitle>{t("gettingStarted.firstSteps.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gettingStarted.firstSteps.intro")}</p>
            <ol className="space-y-3 list-none">
              {(["step1", "step2", "step3", "step4", "step5"] as const).map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-sm">{t(`gettingStarted.firstSteps.${step}.title`)}</h3>
                    <p className="text-sm text-muted-foreground">{t(`gettingStarted.firstSteps.${step}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* 3 — Working with AI effectively */}
        <Card>
          <CardHeader>
            <CardTitle>{t("gettingStarted.workingWithAi.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gettingStarted.workingWithAi.intro")}</p>
            <SubSection titleKey="gettingStarted.workingWithAi.context.title" textKey="gettingStarted.workingWithAi.context.text" />
            <SubSection titleKey="gettingStarted.workingWithAi.knowledge.title" textKey="gettingStarted.workingWithAi.knowledge.text" />
            <SubSection titleKey="gettingStarted.workingWithAi.verify.title" textKey="gettingStarted.workingWithAi.verify.text" />
            <SubSection titleKey="gettingStarted.workingWithAi.iterate.title" textKey="gettingStarted.workingWithAi.iterate.text" />
            <div className="space-y-2">
              <h3 className="font-semibold">{t("gettingStarted.workingWithAi.rules.title")}</h3>
              <ul className="space-y-1 list-disc pl-5">
                {rules.map((rule) => (
                  <li key={rule} className="text-sm text-muted-foreground">{rule}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* 4 — What "preview" means */}
        <Card>
          <CardHeader>
            <CardTitle>{t("gettingStarted.preview.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gettingStarted.preview.intro")}</p>
            <ul className="space-y-1 list-disc pl-5">
              {limits.map((limit) => (
                <li key={limit} className="text-sm text-muted-foreground">{limit}</li>
              ))}
            </ul>
            <div className="rounded-md border p-4 space-y-1">
              <h3 className="font-semibold text-sm">{t("gettingStarted.preview.feedback.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("gettingStarted.preview.feedback.text")}</p>
              <a href="mailto:ask@aisha.guru" className="text-sm font-medium text-primary hover:underline">
                {t("gettingStarted.preview.feedback.cta")}
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Closing */}
        <div className="text-center space-y-2 py-4">
          <h2 className="text-xl font-semibold">{t("gettingStarted.closing.title")}</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">{t("gettingStarted.closing.text")}</p>
        </div>
      </div>
      <Footer />
    </div>
  );
}

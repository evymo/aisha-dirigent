import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StudyConsentSigning } from "@/components/member/StudyConsentSigning";

/**
 * Member study/charter consent signing page — the documents a member still has to
 * sign for the cohorts they are enrolled in. Distinct from /member/consents, which
 * manages data-sharing consents granted to partners.
 */
export default function MemberStudyConsents() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {t("studyConsents.title")}
            </h1>
            <p className="text-muted-foreground">{t("studyConsents.description")}</p>
          </div>

          <StudyConsentSigning />
        </div>
      </main>
      <Footer />
    </div>
  );
}

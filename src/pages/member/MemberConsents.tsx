import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DataSharingConsents } from "@/components/member/DataSharingConsents";

/**
 * Member data sharing consents page.
 */
export default function MemberConsents() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-12">
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {t("dataSharing.consents.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("dataSharing.consents.description")}
            </p>
          </div>

          <DataSharingConsents />
        </div>
      </main>
      <Footer />
    </div>
  );
}

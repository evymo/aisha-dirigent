import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";

export default function ArchiveProvenance() {
  const { t } = useTranslation();

  const badgeItems = t("archiveProvenance.badges", { returnObjects: true }) as Array<{
    label: string;
    description: string;
  }>;

  const verifyItems = t("archiveProvenance.verifyItems", { returnObjects: true }) as string[];
  const cannotVerifyItems = t("archiveProvenance.cannotVerifyItems", { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("archiveProvenance.sectionLabel")}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t("archiveProvenance.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("archiveProvenance.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-foreground mb-6">
              {t("archiveProvenance.whatIsTitle")}
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-10">
              {t("archiveProvenance.whatIsText")}
            </p>

            <h2 className="font-serif text-3xl font-bold text-foreground mb-6">
              {t("archiveProvenance.badgesTitle")}
            </h2>
            <div className="space-y-4 mb-12">
              {badgeItems.map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-card p-4">
                  <div className="font-semibold text-foreground">{item.label}</div>
                  <div className="text-sm text-muted-foreground mt-1">{item.description}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="font-semibold text-foreground mb-3">{t("archiveProvenance.weVerifyTitle")}</h3>
                <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                  {verifyItems.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="font-semibold text-foreground mb-3">{t("archiveProvenance.weCannotVerifyTitle")}</h3>
                <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                  {cannotVerifyItems.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

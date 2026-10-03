import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";

export default function ArchiveMethods() {
  const { t } = useTranslation();

  const sections = t("archiveMethods.sections", { returnObjects: true }) as Array<{
    title: string;
    body: string;
  }>;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("archiveMethods.sectionLabel")}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t("archiveMethods.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("archiveMethods.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto space-y-12">
            {sections.map((s) => (
              <article key={s.title} className="rounded-lg border border-border bg-card p-6">
                <h2 className="font-serif text-2xl font-bold text-foreground mb-3">{s.title}</h2>
                <p className="text-muted-foreground leading-relaxed">{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

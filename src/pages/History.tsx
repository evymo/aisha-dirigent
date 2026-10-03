import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";

type HistoryEvent = {
  year: string;
  title: string;
  description: string;
};

export default function History() {
  const { t } = useTranslation();

  const events = t("history.events", { returnObjects: true }) as HistoryEvent[];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("history.sectionLabel")}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t("history.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("history.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <div className="relative pl-6 border-l border-border">
              {events.map((event) => (
                <div key={`${event.year}-${event.title}`} className="relative pb-10 last:pb-0">
                  <div className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full bg-primary" />
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-semibold text-primary">{event.year}</div>
                    <h3 className="text-xl font-semibold text-foreground">{event.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">{event.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

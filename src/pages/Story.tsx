import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Code2,
  Handshake,
  Monitor,
  Rocket,
  Server,
  Settings,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const TIMELINE_EVENTS = ["2023-07", "2023-08", "2024", "2025-03", "2025-11", "2026"] as const;

const TIMELINE_ICONS: Record<string, React.ElementType> = {
  "2023-07": Sparkles,
  "2023-08": Code2,
  "2024": Server,
  "2025-03": Wrench,
  "2025-11": BrainCircuit,
  "2026": Rocket,
};

const CAPABILITY_ICONS: Record<string, React.ElementType> = {
  development: Code2,
  operations: Server,
  monitoring: Monitor,
  maintenance: Wrench,
};

const SERVICE_ICONS: Record<string, React.ElementType> = {
  managed: Settings,
  oversight: Shield,
  consulting: Handshake,
};

export default function Story() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("story.sectionLabel")}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t("story.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-3xl">
              {t("story.subtitle")}
            </p>
            <div className="flex flex-wrap gap-4">
              <Button asChild>
                <a href="#vision">
                  {t("story.learnMore")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/contact">
                  {t("story.contactUs")}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Vision */}
      <section id="vision" className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("story.vision.sectionLabel")}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-8">
              {t("story.vision.title")}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 items-start">
              <div className="space-y-6">
                <p className="text-lg text-muted-foreground leading-relaxed">
                  {t("story.vision.paragraph1")}
                </p>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  {t("story.vision.paragraph2")}
                </p>
              </div>
              <div className="hidden lg:flex items-center justify-center w-32 h-32 rounded-2xl bg-accent/10">
                <Bot className="h-16 w-16 text-accent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 bg-card border-y border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("story.timeline.sectionLabel")}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground">
              {t("story.timeline.title")}
            </h2>
          </div>

          <div className="max-w-4xl mx-auto space-y-12">
            {TIMELINE_EVENTS.map((eventKey, index) => {
              const Icon = TIMELINE_ICONS[eventKey] ?? Sparkles;
              const isLast = index === TIMELINE_EVENTS.length - 1;

              return (
                <div key={eventKey} className="flex gap-6">
                  <div className="flex-shrink-0 w-24 text-right pt-1">
                    <span className="font-bold text-accent text-sm">
                      {t(`story.timeline.events.${eventKey}.year`)}
                    </span>
                  </div>
                  <div
                    className={`flex-1 pb-8 ${
                      !isLast ? "border-l-2 border-border" : "border-l-2 border-transparent"
                    } pl-6 relative`}
                  >
                    <div className="absolute -left-[13px] top-0 w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
                      <Icon className="h-3.5 w-3.5 text-accent" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">
                      {t(`story.timeline.events.${eventKey}.title`)}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {t(`story.timeline.events.${eventKey}.description`)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("story.capabilities.sectionLabel")}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {t("story.capabilities.title")}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {t("story.capabilities.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {(["development", "operations", "monitoring", "maintenance"] as const).map((key) => {
              const Icon = CAPABILITY_ICONS[key] ?? Code2;
              return (
                <div key={key} className="bg-card border border-border rounded-lg p-6">
                  <Icon className="h-8 w-8 text-accent mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">
                    {t(`story.capabilities.items.${key}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`story.capabilities.items.${key}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="py-16 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center mb-12">
            <span className="text-sm font-medium uppercase tracking-wider opacity-80 mb-4 block">
              {t("story.services.sectionLabel")}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold mb-4">
              {t("story.services.title")}
            </h2>
            <p className="text-lg opacity-90 leading-relaxed max-w-2xl mx-auto">
              {t("story.services.intro")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {(["managed", "oversight", "consulting"] as const).map((key) => {
              const Icon = SERVICE_ICONS[key] ?? Settings;
              return (
                <div key={key} className="bg-primary-foreground/10 rounded-lg p-6">
                  <Icon className="h-8 w-8 opacity-80 mb-4" />
                  <h3 className="font-semibold mb-2">
                    {t(`story.services.items.${key}.title`)}
                  </h3>
                  <p className="text-sm opacity-80">
                    {t(`story.services.items.${key}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Technology Partner */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("story.partner.sectionLabel")}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-8">
              {t("story.partner.title")}
            </h2>
            <div className="space-y-6">
              <p className="text-lg text-muted-foreground leading-relaxed">
                {t("story.partner.paragraph1")}
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {t("story.partner.paragraph2")}
              </p>
              <p className="text-sm text-muted-foreground/80 italic">
                {t("story.partner.team")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-muted/30 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {t("story.cta.title")}
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              {t("story.cta.subtitle")}
            </p>
            <Button size="lg" asChild>
              <Link to="/contact">
                {t("story.cta.button")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

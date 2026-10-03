import { useDocumentTitle } from "@/hooks/use-document-title";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Handshake, Phone, FileText, Bot, Package, Check } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useNavigate } from "react-router-dom";

const PartnersPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t("web.partners.title"));

  const partnerBenefits = [
    "web.partners.model.benefit1",
    "web.partners.model.benefit2",
    "web.partners.model.benefit3",
    "web.partners.model.benefit4",
  ];

  const onboardingSteps = [
    { icon: Phone, key: "step1" },
    { icon: FileText, key: "step2" },
    { icon: Bot, key: "step3" },
    { icon: Package, key: "step4" },
  ];

  const faqKeys = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-18">
        {/* Hero */}
        <section className="py-24 bg-primary text-center">
          <div className="container mx-auto px-6 max-w-3xl">
            <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-primary-foreground mb-6">{t("web.partners.title")}</h1>
              <p className="font-sans text-primary-foreground/60 text-lg leading-relaxed">{t("web.partners.subtitle")}</p>
            </motion.div>
          </div>
        </section>

        {/* Partner model */}
        <section className="py-20 bg-background">
          <div className="container mx-auto px-6 max-w-4xl">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <div className="flex items-center gap-3 mb-6">
                <Handshake className="text-gold" size={28} />
                <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground">{t("web.partners.model.title")}</h2>
              </div>
              <p className="font-sans text-muted-foreground leading-relaxed mb-8">{t("web.partners.model.desc")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {partnerBenefits.map((key) => (
                  <div key={key} className="flex items-center gap-3 p-4 border border-border rounded-lg">
                    <Check className="text-gold shrink-0" size={18} />
                    <span className="font-sans text-sm text-foreground">{t(key)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* Onboarding */}
        <section className="py-20 bg-secondary">
          <div className="container mx-auto px-6 max-w-4xl">
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground text-center mb-12">{t("web.partners.onboarding.title")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {onboardingSteps.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 * i }}
                  className="text-center relative"
                >
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gold/10 flex items-center justify-center">
                    <step.icon className="text-gold" size={20} />
                  </div>
                  <span className="text-gold font-sans text-xs font-bold">{i + 1}</span>
                  <h3 className="font-serif text-base font-semibold text-foreground mt-1 mb-2">{t(`web.partners.onboarding.${step.key}.title`)}</h3>
                  <p className="font-sans text-muted-foreground text-sm leading-relaxed">{t(`web.partners.onboarding.${step.key}.desc`)}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-background">
          <div className="container mx-auto px-6 max-w-2xl">
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground text-center mb-12">{t("web.partners.faq.title")}</h2>
            <Accordion type="single" collapsible className="space-y-3">
              {faqKeys.map((k) => (
                <AccordionItem key={k} value={k} className="border border-border rounded-lg px-4">
                  <AccordionTrigger className="font-sans text-sm font-medium text-foreground hover:text-gold py-4">
                    {t(`web.partners.faq.${k}`)}
                  </AccordionTrigger>
                  <AccordionContent className="font-sans text-sm text-muted-foreground pb-4 leading-relaxed">
                    {t(`web.partners.faq.a${k.slice(1)}`)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-primary text-center">
          <div className="container mx-auto px-6">
            <button
              onClick={() => navigate({ pathname: "/", hash: "#contact" })}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground px-8 py-4 rounded-full font-sans font-semibold text-sm tracking-wide transition-all duration-300"
            >
              {t("web.partners.cta.text")}
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default PartnersPage;

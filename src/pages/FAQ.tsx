import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";

const FAQ = () => {
  const { t } = useTranslation();

  const faqCategories = [
    {
      categoryKey: "faq.categories.general",
      questions: [
        { questionKey: "faq.general.q1.question", answerKey: "faq.general.q1.answer" },
        { questionKey: "faq.general.q2.question", answerKey: "faq.general.q2.answer" },
        { questionKey: "faq.general.q3.question", answerKey: "faq.general.q3.answer" },
      ],
    },
    {
      categoryKey: "faq.categories.platform",
      questions: [
        { questionKey: "faq.platform.q1.question", answerKey: "faq.platform.q1.answer" },
        { questionKey: "faq.platform.q2.question", answerKey: "faq.platform.q2.answer" },
        { questionKey: "faq.platform.q3.question", answerKey: "faq.platform.q3.answer" },
      ],
    },
    {
      categoryKey: "faq.categories.agents",
      questions: [
        { questionKey: "faq.agents.q1.question", answerKey: "faq.agents.q1.answer" },
        { questionKey: "faq.agents.q2.question", answerKey: "faq.agents.q2.answer" },
        { questionKey: "faq.agents.q3.question", answerKey: "faq.agents.q3.answer" },
      ],
    },
    {
      categoryKey: "faq.categories.services",
      questions: [
        { questionKey: "faq.services.q1.question", answerKey: "faq.services.q1.answer" },
        { questionKey: "faq.services.q2.question", answerKey: "faq.services.q2.answer" },
        { questionKey: "faq.services.q3.question", answerKey: "faq.services.q3.answer" },
      ],
    },
    {
      categoryKey: "faq.categories.security",
      questions: [
        { questionKey: "faq.security.q1.question", answerKey: "faq.security.q1.answer" },
        { questionKey: "faq.security.q2.question", answerKey: "faq.security.q2.answer" },
        { questionKey: "faq.security.q3.question", answerKey: "faq.security.q3.answer" },
      ],
    },
    {
      categoryKey: "faq.categories.pricing",
      questions: [
        { questionKey: "faq.pricing.q1.question", answerKey: "faq.pricing.q1.answer" },
        { questionKey: "faq.pricing.q2.question", answerKey: "faq.pricing.q2.answer" },
        { questionKey: "faq.pricing.q3.question", answerKey: "faq.pricing.q3.answer" },
      ],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto text-center">
              <Badge variant="outline" className="mb-6">
                <HelpCircle className="h-3 w-3 mr-1" />
                {t("faq.badge")}
              </Badge>
              <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
                {t("faq.title")}
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("faq.subtitle")}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ Content */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto space-y-12">
              {faqCategories.map((category, categoryIndex) => (
                <div key={categoryIndex}>
                  <h2 className="text-2xl font-serif font-bold text-foreground mb-6">
                    {t(category.categoryKey)}
                  </h2>
                  
                  <Accordion type="single" collapsible className="space-y-4">
                    {category.questions.map((faq, index) => (
                      <AccordionItem 
                        key={index} 
                        value={`${categoryIndex}-${index}`}
                        className="border rounded-lg px-4 bg-card"
                      >
                        <AccordionTrigger className="text-left hover:no-underline">
                          <span className="font-medium">{t(faq.questionKey)}</span>
                        </AccordionTrigger>
                        <AccordionContent className="text-muted-foreground whitespace-pre-line">
                          {t(faq.answerKey)}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="py-8 bg-muted/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs text-muted-foreground text-center max-w-3xl mx-auto">
              {t("faq.disclaimer")}
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default FAQ;

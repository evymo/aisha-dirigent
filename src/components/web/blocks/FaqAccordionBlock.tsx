/**
 * FaqAccordionBlock — Runtime block for an FAQ accordion.
 *
 * Renders all 6 FAQ categories (general, platform, agents, services,
 * security, pricing) × 3 questions each using shadcn Accordion.
 * Fully i18n-driven — no backend data needed.
 *
 * Editor placeholder: `<div data-runtime-block="faq-accordion"></div>`
 *
 * @module
 */

import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

const FAQ_CATEGORIES = [
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
] as const;

/**
 * Runtime block that renders an FAQ accordion with all categories.
 * Purely i18n-driven — no backend data fetching.
 */
export default function FaqAccordionBlock(_props: RuntimeBlockProps) {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      {FAQ_CATEGORIES.map((category, categoryIndex) => (
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
  );
}

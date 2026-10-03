import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { 
  Download, 
  FileText, 
  BookOpen, 
  Shield, 
  Scale, 
  Eye,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  ArrowRight
} from "lucide-react";
import { useTranslation } from "react-i18next";

const sectionIcons = {
  introduction: BookOpen,
  methods: Shield,
  curation: CheckCircle,
  digitization: FileText,
  editorial: Eye,
  glossary: HelpCircle,
  compliance: Scale
};

const sectionKeys = ["introduction", "methods", "curation", "digitization", "editorial", "glossary", "compliance"] as const;

export default function Whitepaper() {
  const { t } = useTranslation();

  const glossaryTerms = t('whitepaper.glossaryTerms', { returnObjects: true }) as Array<{
    period: string;
    modern: string;
    context: string;
  }>;

  const digitizationSteps = t('whitepaper.digitizationSteps', { returnObjects: true }) as string[];
  const verifyItems = t('whitepaper.verifyItems', { returnObjects: true }) as string[];
  const cannotVerifyItems = t('whitepaper.cannotVerifyItems', { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-2">
              <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
                {t('whitepaper.version')}
              </span>
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
                {t('whitepaper.title')}
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                {t('whitepaper.subtitle')}
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" asChild>
                  <a href="/directives/AISHA-Token-Whitepaper-v3.pdf" download>
                    <Download className="mr-2 h-4 w-4" />
                    {t('common.downloadPDF')}
                  </a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/archive">
                    {t('whitepaper.browseArchive')}
                  </Link>
                </Button>
              </div>
            </div>
            
            {/* Table of Contents */}
            <div className="bg-muted/50 rounded-lg p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-4">{t('common.contents')}</h3>
              <nav className="space-y-2">
                {sectionKeys.map((key) => {
                  const IconComponent = sectionIcons[key];
                  return (
                    <a
                      key={key}
                      href={`#${key}`}
                      className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <IconComponent className="h-4 w-4" />
                      {t(`whitepaper.sections.${key}`)}
                    </a>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            
            {/* Introduction */}
            <article id="introduction" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <BookOpen className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.introduction')}</h2>
              </div>
              <div className="prose prose-neutral max-w-none">
                <p className="text-muted-foreground leading-relaxed mb-4">
                  {t('whitepaper.introText1')}
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  {t('whitepaper.introText2')}
                </p>
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 mt-6">
                  <p className="text-sm text-foreground italic">
                    {t('whitepaper.introQuote')}
                  </p>
                </div>
              </div>
            </article>

            {/* Methods & Integrity */}
            <article id="methods" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <Shield className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.methods')}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-card border border-border rounded-lg p-6">
                  <CheckCircle className="h-8 w-8 text-secondary mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.whatWeVerify')}</h3>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    {verifyItems.map((item, index) => (
                      <li key={index}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-card border border-border rounded-lg p-6">
                  <AlertCircle className="h-8 w-8 text-accent mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.whatWeCannotVerify')}</h3>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    {cannotVerifyItems.map((item, index) => (
                      <li key={index}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {t('whitepaper.methodsNote')}
              </p>
            </article>

            {/* Curation Rules */}
            <article id="curation" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <CheckCircle className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.curation')}</h2>
              </div>
              <div className="space-y-6">
                <div className="border-l-4 border-primary pl-6">
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.curationRules.rule1.title')}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t('whitepaper.curationRules.rule1.description')}
                  </p>
                </div>
                <div className="border-l-4 border-secondary pl-6">
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.curationRules.rule2.title')}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t('whitepaper.curationRules.rule2.description')}
                  </p>
                </div>
                <div className="border-l-4 border-accent pl-6">
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.curationRules.rule3.title')}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t('whitepaper.curationRules.rule3.description')}
                  </p>
                </div>
                <div className="border-l-4 border-muted-foreground pl-6">
                  <h3 className="font-semibold text-foreground mb-2">{t('whitepaper.curationRules.rule4.title')}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t('whitepaper.curationRules.rule4.description')}
                  </p>
                </div>
              </div>
            </article>

            {/* Digitization */}
            <article id="digitization" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <FileText className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.digitization')}</h2>
              </div>
              <ol className="space-y-4">
                {digitizationSteps.map((step, index) => (
                  <li key={index} className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="text-muted-foreground pt-1">{step}</span>
                  </li>
                ))}
              </ol>
            </article>

            {/* Editorial Policy */}
            <article id="editorial" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <Eye className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.editorial')}</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                {t('whitepaper.editorialIntro')}
              </p>
              <div className="bg-muted/50 rounded-lg p-6 border border-border space-y-4">
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{t('whitepaper.editorialPolicies.translations.title')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('whitepaper.editorialPolicies.translations.description')}
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{t('whitepaper.editorialPolicies.redactions.title')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('whitepaper.editorialPolicies.redactions.description')}
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-foreground mb-1">{t('whitepaper.editorialPolicies.corrections.title')}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t('whitepaper.editorialPolicies.corrections.description')}
                  </p>
                </div>
              </div>
            </article>

            {/* Glossary */}
            <article id="glossary" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <HelpCircle className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.glossary')}</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                {t('whitepaper.glossaryIntro')}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-semibold text-foreground">{t('whitepaper.glossaryHeaders.period')}</th>
                      <th className="text-left py-3 px-4 font-semibold text-foreground">{t('whitepaper.glossaryHeaders.modern')}</th>
                      <th className="text-left py-3 px-4 font-semibold text-foreground">{t('whitepaper.glossaryHeaders.context')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glossaryTerms.map((term, index) => (
                      <tr key={index} className="border-b border-border">
                        <td className="py-3 px-4 font-medium text-foreground">{term.period}</td>
                        <td className="py-3 px-4 text-muted-foreground">{term.modern}</td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">{term.context}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            {/* Compliance */}
            <article id="compliance" className="mb-16 scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <Scale className="h-6 w-6 text-primary" />
                <h2 className="font-serif text-3xl font-bold text-foreground">{t('whitepaper.sections.compliance')}</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                {t('whitepaper.complianceIntro')}
              </p>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
                <h4 className="font-semibold text-foreground mb-3">{t('whitepaper.standardDisclaimer')}</h4>
                <p className="text-sm text-muted-foreground italic">
                  {t('whitepaper.disclaimerText')}
                </p>
              </div>
            </article>

          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-muted/50 border-t border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
              {t('whitepaper.cta.title')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t('whitepaper.cta.subtitle')}
            </p>
            <Button asChild>
              <Link to="/archive">
                {t('whitepaper.cta.button')}
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

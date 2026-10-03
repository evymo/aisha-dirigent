import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FileText, Download, BookOpen } from "lucide-react";

export function WhitepaperSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row gap-8 items-center p-8 md:p-10 bg-gradient-to-br from-primary/5 to-primary/10 rounded-3xl border border-primary/20">
            {/* Icon */}
            <div className="flex-shrink-0 w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center">
              <FileText className="w-10 h-10 text-primary" />
            </div>

            {/* Content */}
            <div className="flex-1 text-center md:text-left">
              <p className="text-sm font-medium text-primary uppercase tracking-wide mb-2">
                {t('whitepaperSection.label')}
              </p>
              <h2 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-3">
                {t('whitepaperSection.title')}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t('whitepaperSection.description')}
              </p>
              
              <div className="flex flex-wrap justify-center md:justify-start gap-3">
                <Button asChild className="rounded-full">
                  <Link to="/whitepaper">
                    <BookOpen className="mr-2 h-4 w-4" />
                    {t('whitepaperSection.readOnline')}
                  </Link>
                </Button>
                <Button variant="outline" asChild className="rounded-full">
                  <a href="/directives/AISHA-Token-Whitepaper-v3.pdf" download>
                    <Download className="mr-2 h-4 w-4" />
                    {t('common.downloadPDF')}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

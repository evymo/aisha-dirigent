import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MarkdownRenderer } from "@/components/legal/MarkdownRenderer";

/**
 * Terms of Service page - displays the full terms and conditions.
 * Content is rendered from the `legal.termsOfService.fullText` i18n key (Markdown).
 */
export default function TermsOfService() {
  const { t } = useTranslation();
  const fullText = t("legal.termsOfService.fullText");

  useEffect(() => {
    document.title = `${t("legal.termsOfService.title")} | Platform`;
  }, [t]);

  return (
    <>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl font-bold">
                {t("legal.termsOfService.title")}
              </CardTitle>
              <p className="text-muted-foreground">
                {t("legal.termsOfService.lastUpdated", {
                  date: new Date().toLocaleDateString(),
                })}
              </p>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={fullText} />
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    </>
  );
}

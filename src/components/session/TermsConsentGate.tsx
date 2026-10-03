import { ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useConsents } from "@/hooks/useStudies";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/legal/MarkdownRenderer";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

/**
 * Gate that asks authenticated users to accept terms consent
 * before they can access member-only content.
 *
 * Renders a full-page with the terms content inline (scrollable)
 * and a consent checkbox at the bottom.
 *
 * Only active on `/member/*` routes.
 */
export function TermsConsentGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const location = useLocation();
  const { loading, hasConsent, grantConsent, refetch } = useConsents();

  const [isChecked, setIsChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMemberRoute = location.pathname.startsWith("/member");
  const hasTermsConsent = hasConsent("data_processing");
  const shouldBlock = isMemberRoute && Boolean(user) && !loading && !hasTermsConsent;

  useEffect(() => {
    if (!shouldBlock) {
      setIsChecked(false);
    }
  }, [shouldBlock]);

  const handleAccept = async () => {
    if (!isChecked || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await grantConsent("data_processing");
      if (result.error) {
        throw new Error(result.error);
      }
      await refetch();
    } catch {
      toast.error(t("common.error"), {
        description: t("errors.genericError"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Not on a member route or already has consent — pass through
  if (!shouldBlock) return <>{children}</>;

  const fullText = t("legal.termsOfService.fullText");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-4xl mt-20">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" />
              <CardTitle className="text-2xl font-bold">
                {t("auth.consent_terms_title")}
              </CardTitle>
            </div>
            <p className="text-muted-foreground text-sm">
              {t("auth.consent_terms_desc")}
            </p>
          </CardHeader>

          <CardContent>
            {/* Scrollable terms content */}
            <div className="border rounded-lg bg-muted/30">
              <ScrollArea className="h-[50vh]">
                <div className="p-6 prose prose-sm dark:prose-invert max-w-none">
                  <MarkdownRenderer content={fullText} />
                </div>
              </ScrollArea>
            </div>

            <p className="text-xs text-muted-foreground mt-3 italic">
              {t("auth.consent_terms_scroll_hint")}
            </p>
          </CardContent>

          <CardFooter className="flex flex-col gap-4 border-t pt-6">
            <div className="flex items-start gap-3 w-full">
              <Checkbox
                id="terms-consent-gate"
                checked={isChecked}
                onCheckedChange={(checked) => setIsChecked(Boolean(checked))}
                className="mt-0.5"
              />
              <Label
                htmlFor="terms-consent-gate"
                className="text-sm leading-relaxed cursor-pointer"
              >
                {t("auth.agree_terms")}
              </Label>
            </div>

            <Button
              type="button"
              onClick={handleAccept}
              disabled={!isChecked || isSubmitting}
              className="w-full sm:w-auto sm:self-end"
              size="lg"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("common.continue")}
            </Button>
          </CardFooter>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

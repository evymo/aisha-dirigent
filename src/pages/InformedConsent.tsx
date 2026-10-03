import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { InformedConsentForm } from "@/components/consent/InformedConsentForm";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default function InformedConsent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useSession();

  const studyId = searchParams.get("studyId") || undefined;
  const studyName = searchParams.get("studyName") || undefined;
  const returnTo = searchParams.get("returnTo") || "/member";

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl mx-auto px-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('auth.loginRequired')}</CardTitle>
                <CardDescription>
                  {t('auth.loginRequiredDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/auth")}>
                  {t('common.signIn')}
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          <Button
            variant="ghost"
            onClick={() => navigate(returnTo)}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('common.back')}
          </Button>

          <InformedConsentForm
            studyId={studyId}
            studyName={studyName}
            onConsentGranted={() => navigate(returnTo)}
            onCancel={() => navigate(returnTo)}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}

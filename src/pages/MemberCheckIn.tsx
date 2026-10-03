import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { TrackingCheckInForm } from "@/components/member/TrackingCheckInForm";
import { useSession } from "@/hooks/useSession";
import { RequireSecureMode } from "@/components/security/RequireSecureMode";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MemberCheckIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: loading } = useSession();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <RequireSecureMode>
          <div className="container max-w-2xl mx-auto px-4">
            <Button
              variant="ghost"
              className="mb-6"
              onClick={() => navigate("/member")}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t("checkIn.backToDashboard")}
            </Button>

            <div className="mb-8">
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("checkIn.title")}
              </h1>
              <p className="text-muted-foreground mt-2">
                {t("checkIn.subtitle")}
              </p>
            </div>

            <TrackingCheckInForm />
          </div>
        </RequireSecureMode>
      </main>

      <Footer />
    </div>
  );
}

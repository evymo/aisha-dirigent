import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { RequireSecureMode } from "@/components/security/RequireSecureMode";
import { TrackingDataDashboard } from "@/components/tracking/TrackingDataDashboard";
import { TrackingDocumentsManager } from "@/components/member/TrackingDocumentsManager";
import { useLabResults } from "@/hooks/useTracking";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Member health overview page.
 */
export default function MemberTracking() {
  const { t } = useTranslation();
  const { labResults, loading } = useLabResults();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-12">
        <RequireSecureMode>
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground">
                {t("tracking.summary")}
              </h1>
              <p className="text-muted-foreground">
                {t("memberPortal.tracking.latestEntries")}
              </p>
            </div>

            <TrackingDataDashboard />

            <Card>
              <CardHeader>
                <CardTitle>{t("memberPortal.labResults.title")}</CardTitle>
                <CardDescription>{t("memberPortal.labResults.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center text-muted-foreground py-6">
                    {t("common.loading")}
                  </div>
                ) : labResults.length > 0 ? (
                  <div className="space-y-3">
                    {labResults.slice(0, 5).map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <div>
                          <p className="font-medium">
                            {result.lab_name || t("memberPortal.labResults.labTest")}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(result.test_date).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {result.status}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-6">
                    {t("memberPortal.labResults.noResults")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("member.documents.title")}</CardTitle>
                <CardDescription>{t("member.documents.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <TrackingDocumentsManager />
              </CardContent>
            </Card>
          </div>
        </RequireSecureMode>
      </main>
      <Footer />
    </div>
  );
}

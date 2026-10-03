/**
 * MemberQuestionnaires - Member's pending questionnaires page
 *
 * Shows questionnaires from user's enrolled studies (including pending registration).
 * Users can fill questionnaires as part of qualification/screening process.
 */

import { useEffect } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Locale } from "date-fns";
import { format, parseISO } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/hooks/useSession";
import { useMyQuestionnaires, type MyQuestionnaire } from "@/hooks/useMyQuestionnaires";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  FlaskConical,
  Coins,
  Loader2,
} from "lucide-react";

function QuestionnaireStatusBadge({ status }: { status: MyQuestionnaire["status"] }) {
  const { t } = useTranslation();

  switch (status) {
    case "pending":
      return (
        <Badge variant="default" className="gap-1">
          <Clock className="h-3 w-3" />
          {t("memberQuestionnaires.status.pending")}
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800">
          <CheckCircle2 className="h-3 w-3" />
          {t("memberQuestionnaires.status.completed")}
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {t("memberQuestionnaires.status.expired")}
        </Badge>
      );
    case "not_started":
      return (
        <Badge variant="outline" className="gap-1">
          <ClipboardList className="h-3 w-3" />
          {t("memberQuestionnaires.status.notStarted")}
        </Badge>
      );
    default:
      return null;
  }
}

function QuestionnaireCard({
  questionnaire,
  dateLocale,
}: {
  questionnaire: MyQuestionnaire;
  dateLocale: Locale;
}) {
  const { t } = useTranslation();
  const isPending = questionnaire.status === "pending";
  const isCompleted = questionnaire.status === "completed";

  return (
    <Card className={isPending ? "border-primary/50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="font-medium truncate">{questionnaire.title}</h3>
              <QuestionnaireStatusBadge status={questionnaire.status} />
              {questionnaire.is_required && (
                <Badge variant="outline" className="text-xs">
                  {t("common.required")}
                </Badge>
              )}
            </div>

            {questionnaire.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {questionnaire.description}
              </p>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FlaskConical className="h-3 w-3" />
                {questionnaire.study_name}
              </span>
              {questionnaire.points_reward > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <Coins className="h-3 w-3" />
                  +{questionnaire.points_reward} {t("memberQuestionnaires.points")}
                </span>
              )}
              {questionnaire.deadline_at && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t("memberQuestionnaires.deadline")}:{" "}
                  {format(parseISO(questionnaire.deadline_at), "d. M. yyyy", {
                    locale: dateLocale,
                  })}
                </span>
              )}
              {isCompleted && questionnaire.last_completed_at && (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("memberQuestionnaires.completedAt")}:{" "}
                  {format(parseISO(questionnaire.last_completed_at), "d. M. yyyy", {
                    locale: dateLocale,
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="flex-shrink-0">
            {isPending && (
              <Button asChild size="sm" className="gap-1">
                <Link
                  to={`/questionnaire/${questionnaire.questionnaire_code}?registration=${questionnaire.registration_id}`}
                >
                  {t("memberQuestionnaires.fill")}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {isCompleted && (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link
                  to={`/questionnaire/${questionnaire.questionnaire_code}?registration=${questionnaire.registration_id}&view=true`}
                >
                  {t("memberQuestionnaires.view")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MemberQuestionnaires() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const {
    questionnairesByStudy,
    totalPending,
    totalCompleted,
    isLoading,
  } = useMyQuestionnaires();

  const dateLocale = getDateFnsLocale(i18n.language);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const hasQuestionnaires = Object.keys(questionnairesByStudy).length > 0;
  const totalQuestionnaires = totalPending + totalCompleted;
  const progressPercent = totalQuestionnaires > 0 ? Math.round((totalCompleted / totalQuestionnaires) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8 md:py-12 mt-16">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            {t("memberQuestionnaires.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("memberQuestionnaires.subtitle")}
          </p>
        </div>

        {/* Progress Card */}
        {hasQuestionnaires && (
          <Card className="mb-8">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium">
                    {t("memberQuestionnaires.progress")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("memberQuestionnaires.progressDescription", {
                      completed: totalCompleted,
                      total: totalQuestionnaires,
                    })}
                  </p>
                </div>
                <span className="text-2xl font-bold text-primary">
                  {progressPercent}%
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </CardContent>
          </Card>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasQuestionnaires ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">
                {t("memberQuestionnaires.empty.title")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("memberQuestionnaires.empty.description")}
              </p>
              <Button asChild>
                <Link to="/studies">
                  {t("memberQuestionnaires.empty.browseStudies")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(questionnairesByStudy).map(([studyId, data]) => {
              const pendingCount = data.questionnaires.filter(
                (q) => q.status === "pending"
              ).length;

              return (
                <div key={studyId}>
                  <div className="flex items-center gap-3 mb-4">
                    <FlaskConical className="h-5 w-5 text-primary" />
                    <h2 className="text-xl font-semibold">{data.study_name}</h2>
                    {pendingCount > 0 && (
                      <Badge variant="default">
                        {pendingCount} {t("memberQuestionnaires.pendingCount")}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Pending first, then by display_order */}
                    {[...data.questionnaires]
                      .sort((a, b) => {
                        // Pending first
                        if (a.status === "pending" && b.status !== "pending") return -1;
                        if (a.status !== "pending" && b.status === "pending") return 1;
                        // Then by display_order
                        return a.display_order - b.display_order;
                      })
                      .map((q) => (
                        <QuestionnaireCard
                          key={q.study_questionnaire_id}
                          questionnaire={q}
                          dateLocale={dateLocale}
                        />
                      ))}
                  </div>

                  <Separator className="mt-8" />
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

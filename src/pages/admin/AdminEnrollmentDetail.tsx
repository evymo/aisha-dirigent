import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, User, FileText, Calendar, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useRegistrationDetail } from "@/hooks/useRegistrationDetail";

/**
 * Admin page for viewing detailed registration information including questionnaire responses.
 */
export default function AdminRegistrationDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { registration, questionnaireResponses, isLoading, error } = useRegistrationDetail(id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <p className="text-destructive">{error}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/registrations">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Link>
        </Button>
      </div>
    );
  }

  if (!registration) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{t("admin.registrationDetail.notFound")}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/registrations">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Link>
        </Button>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
      case "enrolled":
      case "completed":
        return <CheckCircle className="w-4 h-4" />;
      case "screening":
        return <Clock className="w-4 h-4" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "active":
      case "enrolled":
        return "default";
      case "completed":
        return "secondary";
      case "withdrawn":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin/registrations">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">
            {t("admin.registrationDetail.title")}
          </h1>
          <p className="text-muted-foreground">
            {registration.profile?.display_name || t("admin.registrations.unnamed")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Participant Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              {t("admin.registrationDetail.participantInfo")}
            </CardTitle>
            <CardDescription>
              {t("admin.registrationDetail.participantInfoDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.name")}</p>
                <p className="font-medium">{registration.profile?.display_name || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.email")}</p>
                <p className="font-medium">{registration.profile?.email || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.phone")}</p>
                <p className="font-medium">{registration.profile?.phone || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.dateOfBirth")}</p>
                <p className="font-medium">
                  {registration.profile?.date_of_birth
                    ? format(new Date(registration.profile.date_of_birth), "dd.MM.yyyy")
                    : "-"}
                </p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.diagnosis")}</p>
              <p className="font-medium">{registration.profile?.primary_diagnosis || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.medications")}</p>
              <p className="font-medium">{registration.profile?.current_medications || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.medicalHistory")}</p>
              <p className="font-medium text-sm">{registration.profile?.medical_history || "-"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Registration Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {t("admin.registrationDetail.registrationStatus")}
            </CardTitle>
            <CardDescription>
              {t("admin.registrationDetail.registrationStatusDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("admin.registrations.table.status")}</span>
              <Badge variant={getStatusVariant(registration.status)} className="flex items-center gap-1">
                {getStatusIcon(registration.status)}
                {t(`admin.registrations.statuses.${registration.status}`)}
              </Badge>
            </div>
            <Separator />
            <div>
              <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.study")}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{registration.study?.code}</Badge>
                <span className="font-medium">{registration.study?.name}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.table.applied")}</p>
                <p className="font-medium">
                  {registration.created_at
                    ? format(new Date(registration.created_at), "dd.MM.yyyy HH:mm")
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.table.enrolled")}</p>
                <p className="font-medium">
                  {registration.enrolled_at
                    ? format(new Date(registration.enrolled_at), "dd.MM.yyyy HH:mm")
                    : t("admin.registrations.notYet")}
                </p>
              </div>
            </div>
            {registration.group_assignment && (
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrations.table.group")}</p>
                <Badge variant="secondary">{registration.group_assignment}</Badge>
              </div>
            )}
            {registration.notes && (
              <div>
                <p className="text-sm text-muted-foreground">{t("admin.registrationDetail.adminNotes")}</p>
                <p className="text-sm bg-muted p-3 rounded-md mt-1">{registration.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Questionnaire Responses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t("admin.registrationDetail.questionnaireResponses")}
          </CardTitle>
          <CardDescription>
            {t("admin.registrationDetail.questionnaireResponsesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {questionnaireResponses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mb-4 opacity-50" />
              <p>{t("admin.registrationDetail.noResponses")}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {questionnaireResponses.map((response) => (
                <div key={response.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <Badge variant="outline">
                      {t("admin.registrationDetail.questionnaire")} #{response.questionnaire_id.slice(0, 8)}
                    </Badge>
                    {response.completed_at && (
                      <span className="text-sm text-muted-foreground">
                        {t("admin.registrationDetail.completedAt")}: {format(new Date(response.completed_at), "dd.MM.yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {Object.entries(response.responses).map(([question, answer]) => (
                      <div key={question} className="border-l-2 border-muted pl-4">
                        <p className="text-sm font-medium text-muted-foreground">{question}</p>
                        <p className="mt-1">
                          {typeof answer === "object" 
                            ? JSON.stringify(answer, null, 2) 
                            : String(answer ?? "-")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

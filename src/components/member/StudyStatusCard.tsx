import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  FlaskConical, 
  CheckCircle2, 
  Clock, 
  XCircle,
  ChevronRight,
  FileCheck,
  GraduationCap,
  Award
} from "lucide-react";
import { useRIIMembership } from "@/hooks/useRIIMembership";
import { useHasInformedConsent } from "@/hooks/useInformedConsent";
import { usePermissions } from "@/hooks/usePermissions";
import { format } from "date-fns";

interface StatusItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: "completed" | "pending" | "not_started" | "failed";
  statusLabel: string;
  actionLabel?: string;
  actionLink?: string;
  details?: React.ReactNode;
}

function StatusItem({ 
  icon, 
  title, 
  description, 
  status, 
  statusLabel, 
  actionLabel, 
  actionLink,
  details 
}: StatusItemProps) {
  const statusConfig = {
    completed: { 
      badge: "default" as const, 
      icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
      bg: "bg-green-50 dark:bg-green-950/30"
    },
    pending: { 
      badge: "secondary" as const, 
      icon: <Clock className="w-4 h-4 text-amber-600" />,
      bg: "bg-amber-50 dark:bg-amber-950/30"
    },
    not_started: { 
      badge: "outline" as const, 
      icon: <XCircle className="w-4 h-4 text-muted-foreground" />,
      bg: "bg-muted/50"
    },
    failed: { 
      badge: "destructive" as const, 
      icon: <XCircle className="w-4 h-4 text-destructive" />,
      bg: "bg-destructive/10"
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`p-4 rounded-lg ${config.bg}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-background shadow-sm">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-medium text-sm">{title}</h4>
            <Badge variant={config.badge} className="flex items-center gap-1 text-xs shrink-0">
              {config.icon}
              {statusLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{description}</p>
          {details && <div className="text-xs text-muted-foreground">{details}</div>}
          {actionLabel && actionLink && status !== "completed" && (
            <Button asChild variant="link" className="h-auto p-0 text-xs">
              <Link to={actionLink}>
                {actionLabel}
                <ChevronRight className="w-3 h-3 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function StudyStatusCard() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { registration, isRIIMember, isPendingRII, umbrellaStudy } = useRIIMembership();
  const { hasInformedConsent: hasActiveConsent } = useHasInformedConsent();

  // Check if user has member role (passed qualification test)
  const hasMemberRole = hasPermission("view_studies");

  // Determine RII status
  const getRIIStatus = (): StatusItemProps["status"] => {
    if (isRIIMember) return "completed";
    if (isPendingRII) return "pending";
    return "not_started";
  };

  const getRIIStatusLabel = () => {
    if (isRIIMember) return t("profile.studyStatus.enrolled");
    if (isPendingRII) return t("profile.studyStatus.pending");
    return t("profile.studyStatus.notEnrolled");
  };

  // Determine qualification test status
  const getQualificationStatus = (): StatusItemProps["status"] => {
    if (hasMemberRole) return "completed";
    return "not_started";
  };

  const getQualificationStatusLabel = () => {
    if (hasMemberRole) return t("profile.studyStatus.passed");
    return t("profile.studyStatus.notCompleted");
  };

  // Determine informed consent status
  const getConsentStatus = (): StatusItemProps["status"] => {
    if (hasActiveConsent) return "completed";
    return "not_started";
  };

  const getConsentStatusLabel = () => {
    if (hasActiveConsent) return t("profile.studyStatus.signed");
    return t("profile.studyStatus.notSigned");
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          {t("profile.studyStatus.title")}
        </h3>

        {/* RII Umbrella Study Registration */}
        <StatusItem
          icon={<FlaskConical className="w-4 h-4 text-primary" />}
          title={t("profile.studyStatus.riiRegistration")}
          description={t("profile.studyStatus.riiDescription")}
          status={getRIIStatus()}
          statusLabel={getRIIStatusLabel()}
          actionLabel={t("profile.studyStatus.enrollAction")}
          actionLink="/study-registration"
          details={
            registration && (
              <div className="mt-2 space-y-1">
                <p>
                  <span className="font-medium">{t("profile.studyStatus.studyCode")}:</span>{" "}
                  {umbrellaStudy?.code}
                </p>
                {registration.enrolled_at && (
                  <p>
                    <span className="font-medium">{t("profile.studyStatus.enrolledAt")}:</span>{" "}
                    {format(new Date(registration.enrolled_at), "d.M.yyyy")}
                  </p>
                )}
                <p>
                  <span className="font-medium">{t("profile.studyStatus.status")}:</span>{" "}
                  <Badge variant="outline" className="text-xs ml-1">
                    {registration.status}
                  </Badge>
                </p>
              </div>
            )
          }
        />

        {/* Qualification Test */}
        <StatusItem
          icon={<GraduationCap className="w-4 h-4 text-amber-600" />}
          title={t("profile.studyStatus.qualificationTest")}
          description={t("profile.studyStatus.qualificationDescription")}
          status={getQualificationStatus()}
          statusLabel={getQualificationStatusLabel()}
          actionLabel={t("profile.studyStatus.takeTestAction")}
          actionLink="/qualification-test"
          details={
            hasMemberRole && (
              <div className="mt-2 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {t("profile.studyStatus.memberRoleGranted")}
                </span>
              </div>
            )
          }
        />

        {/* Informed Consent */}
        <StatusItem
          icon={<FileCheck className="w-4 h-4 text-blue-600" />}
          title={t("profile.studyStatus.informedConsent")}
          description={t("profile.studyStatus.consentDescription")}
          status={getConsentStatus()}
          statusLabel={getConsentStatusLabel()}
          actionLabel={t("profile.studyStatus.signAction")}
          actionLink="/informed-consent"
        />

        {/* Progress Summary */}
        <div className="pt-3 border-t mt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("profile.studyStatus.progress")}</span>
            <span className="font-medium">
              {[isRIIMember, hasMemberRole, hasActiveConsent].filter(Boolean).length}/3{" "}
              {t("profile.studyStatus.stepsCompleted")}
            </span>
          </div>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500"
              style={{ 
                width: `${([isRIIMember, hasMemberRole, hasActiveConsent].filter(Boolean).length / 3) * 100}%` 
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

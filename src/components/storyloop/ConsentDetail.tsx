import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { format } from "date-fns";
import {
  Calendar,
  Check,
  ExternalLink,
  FileText,
  FlaskConical,
  Shield,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useConsentDetail } from "@/hooks/useConsentDetail";

interface ConsentDetailProps {
  /** Consent UUID to fetch and display */
  consentId: string | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
}

/**
 * Returns proper variant and label for consent status.
 */
function useConsentStatusInfo(granted: boolean, revokedAt: string | null) {
  const { t } = useTranslation();

  if (revokedAt) {
    return {
      label: t("storyloop.consentDetail.statusRevoked"),
      variant: "destructive" as const,
    };
  }

  if (granted) {
    return {
      label: t("storyloop.consentDetail.statusGranted"),
      variant: "default" as const,
    };
  }

  return {
    label: t("storyloop.consentDetail.statusPending"),
    variant: "secondary" as const,
  };
}

/**
 * Modal dialog for viewing consent details.
 *
 * Fetches the consent data via audited RPC and renders the metadata:
 * type, version, granted/revoked status, study reference, document link.
 */
export function ConsentDetail({
  consentId,
  open,
  onOpenChange,
}: ConsentDetailProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const { data, isLoading, isError, error } = useConsentDetail(consentId, {
    enabled: open && !!consentId,
  });

  const statusInfo = useConsentStatusInfo(
    data?.granted ?? false,
    data?.revoked_at ?? null,
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "PPp", { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <span>{t("storyloop.consentDetail.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("storyloop.consentDetail.description")}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("storyloop.consentDetail.loadError")}
              {error instanceof Error ? `: ${error.message}` : ""}
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="space-y-5">
            {/* Status badge */}
            <div className="flex items-center gap-3">
              <Badge variant={statusInfo.variant} className="text-sm px-3 py-1">
                {data.granted && !data.revoked_at ? (
                  <Check className="h-3.5 w-3.5 mr-1" />
                ) : data.revoked_at ? (
                  <X className="h-3.5 w-3.5 mr-1" />
                ) : null}
                {statusInfo.label}
              </Badge>
              {data.version && (
                <Badge variant="outline" className="text-xs">
                  {t("storyloop.consentDetail.version", {
                    version: data.version,
                  })}
                </Badge>
              )}
            </div>

            {/* Type and study info */}
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide block">
                    {t("storyloop.consentDetail.consentType")}
                  </span>
                  <span className="text-sm font-medium">
                    {t(
                      `storyloop.consentDetail.types.${data.consent_type}`,
                      data.consent_type,
                    )}
                  </span>
                </div>
              </div>

              {data.study_name && (
                <div className="flex items-start gap-2">
                  <FlaskConical className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide block">
                      {t("storyloop.consentDetail.study")}
                    </span>
                    <span className="text-sm font-medium">
                      {data.study_name}
                    </span>
                    {data.study_code && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {data.study_code}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {data.granted_at && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      {t("storyloop.consentDetail.grantedAt")}
                    </span>
                    <span>{formatDate(data.granted_at)}</span>
                  </div>
                </div>
              )}
              {data.revoked_at && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-destructive" />
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      {t("storyloop.consentDetail.revokedAt")}
                    </span>
                    <span className="text-destructive">
                      {formatDate(data.revoked_at)}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-xs text-muted-foreground block">
                    {t("storyloop.consentDetail.createdAt")}
                  </span>
                  <span>{formatDate(data.created_at)}</span>
                </div>
              </div>
            </div>

            {/* Document link */}
            {data.document_url && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="gap-2"
                >
                  <a
                    href={data.document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("storyloop.consentDetail.viewDocument")}
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

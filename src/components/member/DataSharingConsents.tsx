import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useMemberDataSharingConsents,
  useGrantConsentById,
  useRevokeConsentById,
  type ConsentRequest,
} from "@/hooks/useMemberDataSharingUI";
import { Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
export function DataSharingConsents() {
  const { t, i18n } = useTranslation();
  const [selectedConsent, setSelectedConsent] = useState<ConsentRequest | null>(null);
  const [actionType, setActionType] = useState<'grant' | 'revoke' | null>(null);

  const dateLocale = getDateFnsLocale(i18n.language);

  const { data: consents = [], isLoading: loading } = useMemberDataSharingConsents();
  const grantMutation = useGrantConsentById();
  const revokeMutation = useRevokeConsentById();

  const processing = grantMutation.isPending || revokeMutation.isPending;

  const handleGrantConsent = async (consentId: string) => {
    try {
      await grantMutation.mutateAsync(consentId);
      toast.success(t("dataSharing.consents.toast.grantSuccess"), {
        description: t("dataSharing.consents.toast.grantSuccessDesc"),
      });
      setActionType(null);
      setSelectedConsent(null);
    } catch {
      toast.error(t("dataSharing.consents.toast.grantError"), {
        description: t("dataSharing.consents.toast.grantErrorDesc"),
      });
    }
  };

  const handleRevokeConsent = async (consentId: string) => {
    try {
      await revokeMutation.mutateAsync(consentId);
      toast.success(t("dataSharing.consents.toast.revokeSuccess"), {
        description: t("dataSharing.consents.toast.revokeSuccessDesc"),
      });
      setActionType(null);
      setSelectedConsent(null);
    } catch {
      toast.error(t("dataSharing.consents.toast.revokeError"), {
        description: t("dataSharing.consents.toast.revokeErrorDesc"),
      });
    }
  };

  const getConsentStatus = (consent: ConsentRequest) => {
    if (consent.revoked_at) {
      return {
        label: t("dataSharing.consents.status.revoked"),
        variant: "destructive" as const,
        icon: <XCircle className="w-4 h-4" />
      };
    }
    if (consent.granted_at) {
      const isExpired = consent.expires_at && new Date(consent.expires_at) < new Date();
      if (isExpired) {
        return {
          label: t("dataSharing.consents.status.expired"),
          variant: "destructive" as const,
          icon: <AlertTriangle className="w-4 h-4" />
        };
      }
      return {
        label: t("dataSharing.consents.status.active"),
        variant: "default" as const,
        icon: <CheckCircle2 className="w-4 h-4" />
      };
    }
    return {
      label: t("dataSharing.consents.status.pending"),
      variant: "secondary" as const,
      icon: <Clock className="w-4 h-4" />
    };
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("dataSharing.consents.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            {t("dataSharing.consents.loading")}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("dataSharing.consents.title")}
          </CardTitle>
          <CardDescription>
            {t("dataSharing.consents.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consents.length === 0 ? (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertDescription>
                {t("dataSharing.consents.noRequests")}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {consents.map((consent) => {
                const status = getConsentStatus(consent);
                const isPending = !consent.granted_at && !consent.revoked_at;
                const isActive = consent.granted_at && !consent.revoked_at;
                const isExpired = consent.expires_at && new Date(consent.expires_at) < new Date();

                return (
                  <Card key={consent.id} className="border-2">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="space-y-1">
                          <p className="font-medium">{consent.partner_name}</p>
                          <p className="text-sm text-muted-foreground">{consent.partner_email}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("dataSharing.consents.requestedAgo", {
                              time: formatDistanceToNow(new Date(consent.consent_requested_at), {
                                addSuffix: true,
                                locale: dateLocale
                              })
                            })}
                          </p>
                        </div>
                        <Badge variant={status.variant} className="gap-1">
                          {status.icon}
                          {status.label}
                        </Badge>
                      </div>

                      {isActive && consent.expires_at && (
                        <Alert className="mb-4">
                          <Info className="w-4 h-4" />
                          <AlertDescription>
                            {t("dataSharing.consents.expiresIn", {
                              time: formatDistanceToNow(new Date(consent.expires_at), {
                                addSuffix: true,
                                locale: dateLocale
                              })
                            })}
                          </AlertDescription>
                        </Alert>
                      )}

                      {isExpired && (
                        <Alert variant="destructive" className="mb-4">
                          <AlertTriangle className="w-4 h-4" />
                          <AlertDescription>
                            {t("dataSharing.consents.expired")}
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="flex gap-2">
                        {isPending && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedConsent(consent);
                                setActionType('grant');
                              }}
                            >
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              {t("dataSharing.consents.actions.grant")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedConsent(consent);
                                setActionType('revoke');
                              }}
                            >
                              <XCircle className="w-4 h-4 mr-2" />
                              {t("dataSharing.consents.actions.reject")}
                            </Button>
                          </>
                        )}
                        {isActive && !isExpired && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setSelectedConsent(consent);
                              setActionType('revoke');
                            }}
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            {t("dataSharing.consents.actions.revoke")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={!!actionType} onOpenChange={() => { setActionType(null); setSelectedConsent(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'grant'
                ? t("dataSharing.consents.dialog.grantTitle")
                : t("dataSharing.consents.dialog.revokeTitle")}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'grant' ? (
                <>
                  {t("dataSharing.consents.dialog.grantDescription")} <strong>{selectedConsent?.partner_name}</strong>:
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>{t("dataSharing.consents.dialog.grantItems.checkIns")}</li>
                    <li>{t("dataSharing.consents.dialog.grantItems.labResults")}</li>
                    <li>{t("dataSharing.consents.dialog.grantItems.dosing")}</li>
                    <li>{t("dataSharing.consents.dialog.grantItems.questionnaires")}</li>
                  </ul>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("dataSharing.consents.dialog.validityNote")}
                  </p>
                </>
              ) : (
                <>
                  {t("dataSharing.consents.dialog.revokeDescription", { partner: selectedConsent?.partner_name })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setActionType(null); setSelectedConsent(null); }}
              disabled={processing}
            >
              {t("dataSharing.consents.dialog.cancel")}
            </Button>
            <Button
              variant={actionType === 'grant' ? 'default' : 'destructive'}
              onClick={() => {
                if (selectedConsent) {
                  if (actionType === 'grant') {
                    handleGrantConsent(selectedConsent.id);
                  } else {
                    handleRevokeConsent(selectedConsent.id);
                  }
                }
              }}
              disabled={processing}
            >
              {processing
                ? t("dataSharing.consents.dialog.processing")
                : actionType === 'grant'
                  ? t("dataSharing.consents.dialog.confirmGrant")
                  : t("dataSharing.consents.dialog.confirmRevoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

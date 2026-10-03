import { useTranslation } from "react-i18next";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  useDataSharingConsents, 
  useAvailablePartnersForSharing,
  useGrantDataSharing,
  useRevokeDataSharing 
} from "@/hooks/useDataSharingConsent";
import { Shield, ShieldCheck, ShieldOff, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
export function DataSharingManager() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const { data: consents = [], isLoading: consentsLoading } = useDataSharingConsents();
  const { data: availablePartners = [], isLoading: partnersLoading } = useAvailablePartnersForSharing();
  const grantMutation = useGrantDataSharing();
  const revokeMutation = useRevokeDataSharing();

  const activeConsents = consents.filter(c => !c.revoked_at);
  const revokedConsents = consents.filter(c => c.revoked_at);

  const handleToggleConsent = async (partnerId: string, partnerName: string, hasConsent: boolean) => {
    try {
      if (hasConsent) {
        // Find consent to revoke
        const consent = activeConsents.find(c => c.partner_id === partnerId);
        if (consent) {
          await revokeMutation.mutateAsync(consent.id);
          toast.success(t("dataSharing.revokeSuccess", { partner: partnerName }));
        }
      } else {
        await grantMutation.mutateAsync(partnerId);
        toast.success(t("dataSharing.grantSuccess", { partner: partnerName }));
      }
    } catch (error) {
      toast.error(getUserFacingDataErrorMessage(error));
    }
  };

  if (consentsLoading || partnersLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="animate-pulse text-center text-muted-foreground">
            {t("common.loading")}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Shield className="w-8 h-8 text-primary flex-shrink-0" />
            <div>
              <h3 className="font-semibold mb-1">{t("dataSharing.infoTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("dataSharing.infoDescription")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Partners */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {t("dataSharing.partnersTitle")}
          </CardTitle>
          <CardDescription>
            {t("dataSharing.partnersDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {availablePartners.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t("dataSharing.noPartners")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {availablePartners.map((partner) => (
                <div 
                  key={partner.id} 
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${partner.has_consent ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'}`}>
                      {partner.has_consent ? (
                        <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ShieldOff className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{partner.display_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {partner.business_name && `${partner.business_name} • `}
                        {partner.city}
                      </p>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {partner.certification_level === "certified_provider" 
                          ? t("partners.certifiedProvider")
                          : t("partners.certifiedPartner")}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {partner.has_consent 
                        ? t("dataSharing.accessGranted")
                        : t("dataSharing.accessDenied")}
                    </span>
                    <Switch
                      checked={partner.has_consent}
                      onCheckedChange={() => handleToggleConsent(partner.id, partner.display_name, partner.has_consent)}
                      disabled={grantMutation.isPending || revokeMutation.isPending}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Consents History */}
      {activeConsents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <ShieldCheck className="w-5 h-5" />
              {t("dataSharing.activeConsentsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeConsents.map((consent) => (
                <div key={consent.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">
                      {consent.partner_profile?.display_name || t("dataSharing.unknownPartner")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("dataSharing.grantedOn", {
                        date: format(new Date(consent.granted_at), "PPP", { locale: dateLocale })
                      })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeMutation.mutate(consent.id)}
                    disabled={revokeMutation.isPending}
                  >
                    {t("dataSharing.revoke")}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revoked Consents History */}
      {revokedConsents.length > 0 && (
        <Card className="opacity-75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="w-5 h-5" />
              {t("dataSharing.revokedConsentsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {revokedConsents.slice(0, 5).map((consent) => (
                <div key={consent.id} className="flex items-center justify-between py-2 text-muted-foreground">
                  <span>{consent.partner_profile?.display_name || t("dataSharing.unknownPartner")}</span>
                  <span>
                    {t("dataSharing.revokedOn", {
                      date: format(new Date(consent.revoked_at!), "PP", { locale: dateLocale })
                    })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useState, useCallback } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation, Trans } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useMyAssignedClients,
  useClientDetails,
  useRequestConsentFromClient,
  useRelinquishDataAccess,
  type AssignedClientValidated,
} from "@/hooks/useMyClients";
import { Users, AlertCircle, Eye, Lock, Unlock, Heart, Zap, Moon, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
type AssignedClient = AssignedClientValidated;

export function MyClientsPanel() {
  const { t, i18n } = useTranslation();

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [relinquishDialogOpen, setRelinquishDialogOpen] = useState(false);
  const [relinquishTarget, setRelinquishTarget] = useState<{ userId: string; name: string } | null>(
    null
  );

  const dateLocale = getDateFnsLocale(i18n.language);

  const { data: clients = [], isLoading } = useMyAssignedClients();
  const { data: selectedClient, isLoading: loadingDetails } = useClientDetails(selectedClientId);
  const requestConsentMutation = useRequestConsentFromClient();
  const relinquishMutation = useRelinquishDataAccess();

  const handleRequestConsent = useCallback(
    (userId: string, displayName: string) => {
      requestConsentMutation.mutate(
        {
          userId,
          message: t("partnerDashboard.myClients.consent.requestMessage"),
        },
        {
          onSuccess: () => {
            toast.success(t("partnerDashboard.myClients.toasts.requestSent.title"), {
              description: t("partnerDashboard.myClients.toasts.requestSent.description", {
                name: displayName,
              }),
            });
          },
          onError: () => {
            toast.error(t("partnerDashboard.myClients.toasts.requestFailed.title"), {
              description: t("partnerDashboard.myClients.toasts.requestFailed.description"),
            });
          },
        }
      );
    },
    [requestConsentMutation, t]
  );

  const handleRelinquish = useCallback(
    (userId: string, displayName: string) => {
      relinquishMutation.mutate(
        {
          userId,
          reason: t("partnerDashboard.myClients.relinquishReason"),
        },
        {
          onSuccess: () => {
            toast.success(t("partnerDashboard.myClients.toasts.accessRelinquished.title"), {
              description: t("partnerDashboard.myClients.toasts.accessRelinquished.description", {
                name: displayName,
              }),
            });
            setRelinquishDialogOpen(false);
            setRelinquishTarget(null);
          },
          onError: () => {
            toast.error(t("partnerDashboard.myClients.toasts.relinquishFailed.title"), {
              description: t("partnerDashboard.myClients.toasts.relinquishFailed.description"),
            });
          },
        }
      );
    },
    [relinquishMutation, t]
  );

  const getStatusBadge = (client: AssignedClient) => {
    if (client.onboarding_completed) {
      return <Badge variant="default">{t("partnerDashboard.myClients.status.completed")}</Badge>;
    }
    if (client.phone_call_completed_at) {
      return <Badge variant="secondary">{t("partnerDashboard.myClients.status.afterCall")}</Badge>;
    }
    if (client.phone_call_scheduled_at) {
      return <Badge variant="outline">{t("partnerDashboard.myClients.status.callScheduled")}</Badge>;
    }
    return (
      <Badge variant="destructive">{t("partnerDashboard.myClients.status.waitingForCall")}</Badge>
    );
  };

  const getConsentBadge = (status: string) => {
    switch (status) {
      case "granted":
        return {
          icon: <Unlock className="w-3 h-3" />,
          text: t("partnerDashboard.myClients.consentStatus.granted"),
          variant: "default" as const,
          color: "text-green-600",
        };
      case "pending":
        return {
          icon: <AlertCircle className="w-3 h-3" />,
          text: t("partnerDashboard.myClients.consentStatus.pending"),
          variant: "secondary" as const,
          color: "text-yellow-600",
        };
      case "expired":
        return {
          icon: <AlertCircle className="w-3 h-3" />,
          text: t("partnerDashboard.myClients.consentStatus.expired"),
          variant: "destructive" as const,
          color: "text-red-600",
        };
      case "revoked":
        return {
          icon: <Lock className="w-3 h-3" />,
          text: t("partnerDashboard.myClients.consentStatus.revoked"),
          variant: "destructive" as const,
          color: "text-red-600",
        };
      default:
        return {
          icon: <Lock className="w-3 h-3" />,
          text: t("partnerDashboard.myClients.consentStatus.none"),
          variant: "outline" as const,
          color: "text-muted-foreground",
        };
    }
  };

  const isMutating =
    requestConsentMutation.isPending || relinquishMutation.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {t("partnerDashboard.myClients.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            {t("partnerDashboard.myClients.loading")}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {t("partnerDashboard.myClients.title")}
          </CardTitle>
          <CardDescription>{t("partnerDashboard.myClients.descriptionShort")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{t("partnerDashboard.myClients.noClients")}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {t("partnerDashboard.myClients.count", { count: clients.length })}
          </CardTitle>
          <CardDescription>{t("partnerDashboard.myClients.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {clients.map((client) => (
              <Card key={client.onboarding_id} className="border">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{client.display_name}</span>
                        {getStatusBadge(client)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("partnerDashboard.myClients.assignedAgo", {
                          time: formatDistanceToNow(new Date(client.assigned_at), {
                            addSuffix: true,
                            locale: dateLocale,
                          }),
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedClientId(client.user_id)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            {t("partnerDashboard.myClients.buttons.details")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>
                              {t("partnerDashboard.myClients.dialog.clientDetail.title")}
                            </DialogTitle>
                            <DialogDescription>{client.display_name}</DialogDescription>
                          </DialogHeader>
                          {loadingDetails ? (
                            <div className="py-8 text-center text-muted-foreground">
                              {t("partnerDashboard.myClients.loadingDetails")}
                            </div>
                          ) : selectedClient ? (
                            <div className="space-y-4">
                              {!selectedClient.has_consent ? (
                                <Alert variant="destructive">
                                  <Lock className="w-4 h-4" />
                                  <AlertDescription>
                                    <strong>
                                      {t("partnerDashboard.myClients.consent.noConsent.title")}
                                    </strong>
                                    <br />
                                    {t("partnerDashboard.myClients.consent.noConsent.description")}
                                  </AlertDescription>
                                </Alert>
                              ) : (
                                <>
                                  {/* Wellbeing Scores */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                                      <Heart className="w-5 h-5 mx-auto mb-1 text-primary" />
                                      <div className="text-2xl font-semibold">
                                        {selectedClient.overall_feeling}/10
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {t(
                                          "partnerDashboard.myClients.dialog.wellbeing.overallFeeling"
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                                      <Zap className="w-5 h-5 mx-auto mb-1 text-accent" />
                                      <div className="text-2xl font-semibold">
                                        {selectedClient.energy_perception}/10
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {t("partnerDashboard.myClients.dialog.wellbeing.energy")}
                                      </div>
                                    </div>
                                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                                      <Sparkles className="w-5 h-5 mx-auto mb-1 text-secondary" />
                                      <div className="text-2xl font-semibold">
                                        {selectedClient.mental_wellbeing}/10
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {t(
                                          "partnerDashboard.myClients.dialog.wellbeing.mentalWellbeing"
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                                      <Moon className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                                      <div className="text-2xl font-semibold">
                                        {selectedClient.sleep_satisfaction}/10
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {t("partnerDashboard.myClients.dialog.wellbeing.sleep")}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Concerns and Goals */}
                                  <div className="space-y-3">
                                    <div>
                                      <p className="text-sm font-medium text-muted-foreground mb-1">
                                        {t("partnerDashboard.myClients.dialog.sections.concerns")}
                                      </p>
                                      <p className="text-sm">{selectedClient.primary_concern}</p>
                                    </div>
                                    {selectedClient.secondary_concerns &&
                                      selectedClient.secondary_concerns.length > 0 && (
                                        <div>
                                          <p className="text-sm font-medium text-muted-foreground mb-2">
                                            {t(
                                              "partnerDashboard.myClients.dialog.sections.secondaryConcerns"
                                            )}
                                          </p>
                                          <div className="flex flex-wrap gap-2">
                                            {selectedClient.secondary_concerns.map(
                                              (concern, idx) => (
                                                <Badge key={idx} variant="outline">
                                                  {concern}
                                                </Badge>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    <div>
                                      <p className="text-sm font-medium text-muted-foreground mb-1">
                                        {t("partnerDashboard.myClients.dialog.sections.mainGoal")}
                                      </p>
                                      <p className="text-sm">{selectedClient.main_goal}</p>
                                    </div>
                                    {selectedClient.has_chronic_condition &&
                                      selectedClient.condition_brief && (
                                        <div>
                                          <p className="text-sm font-medium text-muted-foreground mb-1">
                                            {t(
                                              "partnerDashboard.myClients.dialog.sections.chronicCondition"
                                            )}
                                          </p>
                                          <p className="text-sm">
                                            {selectedClient.condition_brief}
                                          </p>
                                        </div>
                                      )}
                                  </div>

                                  {/* Preferences */}
                                  <div className="pt-3 border-t">
                                    <p className="text-sm font-medium text-muted-foreground mb-2">
                                      {t("partnerDashboard.myClients.dialog.sections.preferences")}
                                    </p>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      {selectedClient.age_range && (
                                        <Badge variant="outline">
                                          {selectedClient.age_range}{" "}
                                          {t(
                                            "partnerDashboard.myClients.dialog.preferences.years"
                                          )}
                                        </Badge>
                                      )}
                                      {selectedClient.communication_style && (
                                        <Badge variant="secondary">
                                          {t(
                                            `partnerDashboard.myClients.dialog.preferences.communication.${selectedClient.communication_style}`
                                          )}{" "}
                                          {t(
                                            "partnerDashboard.myClients.dialog.preferences.communication.label"
                                          )}
                                        </Badge>
                                      )}
                                      {selectedClient.timeframe_expectation && (
                                        <Badge variant="outline">
                                          {t(
                                            "partnerDashboard.myClients.dialog.preferences.goalLabel"
                                          )}{" "}
                                          {selectedClient.timeframe_expectation.replace("_", " ")}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="py-8 text-center text-muted-foreground">
                              {t("partnerDashboard.myClients.loadError")}
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  {/* Quick summary */}
                  <div className="space-y-2 text-sm">
                    <p className="line-clamp-1">
                      <span className="text-muted-foreground">
                        {t("partnerDashboard.myClients.dialog.sections.concern")}
                      </span>{" "}
                      {client.primary_concern}
                    </p>
                    <p className="line-clamp-1">
                      <span className="text-muted-foreground">
                        {t("partnerDashboard.myClients.dialog.sections.goal")}
                      </span>{" "}
                      {client.main_goal}
                    </p>
                  </div>

                  {/* Data sharing consent status */}
                  <div className="mt-4 pt-3 border-t">
                    {(() => {
                      const consentBadge = getConsentBadge(client.consent_status);

                      return (
                        <div className="flex items-center justify-between">
                          <div
                            className={`flex items-center gap-2 text-sm ${consentBadge.color}`}
                          >
                            {consentBadge.icon}
                            <span>
                              {t("partnerDashboard.myClients.consent.label")} {consentBadge.text}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {(client.consent_status === "none" ||
                              client.consent_status === "expired" ||
                              client.consent_status === "revoked") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleRequestConsent(client.user_id, client.display_name)
                                }
                                disabled={isMutating}
                              >
                                {requestConsentMutation.isPending &&
                                requestConsentMutation.variables?.userId === client.user_id
                                  ? t("partnerDashboard.myClients.buttons.requesting")
                                  : client.consent_status === "expired"
                                    ? t("partnerDashboard.myClients.buttons.renewConsent")
                                    : client.consent_status === "revoked"
                                      ? t("partnerDashboard.myClients.buttons.requestAgain")
                                      : t("partnerDashboard.myClients.buttons.requestConsent")}
                              </Button>
                            )}
                            {client.consent_status === "granted" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setRelinquishTarget({
                                    userId: client.user_id,
                                    name: client.display_name,
                                  });
                                  setRelinquishDialogOpen(true);
                                }}
                                disabled={isMutating}
                              >
                                {relinquishMutation.isPending &&
                                relinquishMutation.variables?.userId === client.user_id
                                  ? t("partnerDashboard.myClients.buttons.relinquishing")
                                  : t("partnerDashboard.myClients.buttons.relinquishAccess")}
                              </Button>
                            )}
                            {client.consent_status === "pending" && (
                              <Badge variant="secondary" className="gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {t("partnerDashboard.myClients.consent.waitingForResponse")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog for relinquishing access */}
      <Dialog open={relinquishDialogOpen} onOpenChange={setRelinquishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("partnerDashboard.myClients.dialog.relinquishAccess.title")}
            </DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="partnerDashboard.myClients.dialog.relinquishAccess.description"
                values={{ name: relinquishTarget?.name }}
                components={{ strong: <strong /> }}
              />
              <br />
              <br />
              {t("partnerDashboard.myClients.dialog.relinquishAccess.consequences")}
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>{t("partnerDashboard.myClients.dialog.relinquishAccess.bullet1")}</li>
                <li>{t("partnerDashboard.myClients.dialog.relinquishAccess.bullet2")}</li>
                <li>{t("partnerDashboard.myClients.dialog.relinquishAccess.bullet3")}</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRelinquishDialogOpen(false);
                setRelinquishTarget(null);
              }}
            >
              {t("partnerDashboard.myClients.buttons.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (relinquishTarget) {
                  handleRelinquish(relinquishTarget.userId, relinquishTarget.name);
                }
              }}
              disabled={relinquishMutation.isPending}
            >
              {relinquishMutation.isPending
                ? t("partnerDashboard.myClients.buttons.relinquishing")
                : t("partnerDashboard.myClients.buttons.confirmRelinquish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

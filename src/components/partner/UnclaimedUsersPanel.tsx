import { useEffect } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useUnclaimedUsers, useClaimUser } from "@/hooks/useUnclaimedUsers";
import { UserPlus, Clock, Mail, Heart, Zap, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
export function UnclaimedUsersPanel() {
  const { t, i18n } = useTranslation();

  const { data: users = [], isLoading: loading, isError, error } = useUnclaimedUsers();
  const claimMutation = useClaimUser();

  // Show toast on fetch error
  useEffect(() => {
    if (isError && error) {
      toast.error(t("partnerDashboard.unclaimedUsers.toasts.fetchFailed.title"), {
        description: t("partnerDashboard.unclaimedUsers.toasts.fetchFailed.description"),
      });
    }
  }, [isError, error, t]);

  const handleClaim = async (onboardingId: string, displayName: string) => {
    try {
      await claimMutation.mutateAsync(onboardingId);
      toast.success(t("partnerDashboard.unclaimedUsers.toasts.claimSuccess.title"), {
        description: t("partnerDashboard.unclaimedUsers.toasts.claimSuccess.description", { name: displayName }),
      });
    } catch {
      toast.error(t("partnerDashboard.unclaimedUsers.toasts.claimFailed.title"), {
        description: t("partnerDashboard.unclaimedUsers.toasts.claimFailed.description"),
      });
    }
  };

  const getWellbeingColor = (score: number): string => {
    if (score >= 7) return "text-green-600";
    if (score >= 4) return "text-yellow-600";
    return "text-red-600";
  };

  const getCommunicationBadge = (style: string) => {
    const styles: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
      frequent: { label: t("partnerDashboard.unclaimedUsers.badges.communicationFrequent"), variant: "default" },
      moderate: { label: t("partnerDashboard.unclaimedUsers.badges.communicationModerate"), variant: "secondary" },
      minimal: { label: t("partnerDashboard.unclaimedUsers.badges.communicationMinimal"), variant: "outline" },
    };
    return styles[style] || { label: style, variant: "outline" };
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            {t("partnerDashboard.unclaimedUsers.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">{t("partnerDashboard.unclaimedUsers.loading")}</div>
        </CardContent>
      </Card>
    );
  }

  if (users.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            {t("partnerDashboard.unclaimedUsers.title")}
          </CardTitle>
          <CardDescription>{t("partnerDashboard.unclaimedUsers.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription>
              {t("partnerDashboard.unclaimedUsers.empty.description")}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          {t("partnerDashboard.unclaimedUsers.titleWithCount", { count: users.length })}
        </CardTitle>
        <CardDescription>
          {t("partnerDashboard.unclaimedUsers.descriptionLong")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {users.map((user) => {
          const commStyle = getCommunicationBadge(user.communication_style);
          const isClaiming = claimMutation.isPending && claimMutation.variables === user.id;

          return (
            <Card key={user.id} className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{user.display_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDistanceToNow(new Date(user.created_at), {
                          addSuffix: true,
                          locale: getDateFnsLocale(i18n.language),
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleClaim(user.id, user.display_name)}
                    disabled={isClaiming}
                  >
                    {isClaiming ? t("partnerDashboard.unclaimedUsers.buttons.claiming") : t("partnerDashboard.unclaimedUsers.buttons.claim")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Wellbeing scores */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Heart className={`w-4 h-4 ${getWellbeingColor(user.overall_feeling)}`} />
                    <span className="text-sm">
                      {t("partnerDashboard.unclaimedUsers.wellbeing.overallFeeling")}: <strong className={getWellbeingColor(user.overall_feeling)}>{user.overall_feeling}/10</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className={`w-4 h-4 ${getWellbeingColor(user.energy_perception)}`} />
                    <span className="text-sm">
                      {t("partnerDashboard.unclaimedUsers.wellbeing.energy")}: <strong className={getWellbeingColor(user.energy_perception)}>{user.energy_perception}/10</strong>
                    </span>
                  </div>
                </div>

                <Separator />

                {/* Primary concern */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("partnerDashboard.unclaimedUsers.sections.concern")}</p>
                  <p className="text-sm line-clamp-2">{user.primary_concern}</p>
                </div>

                {/* Main goal */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("partnerDashboard.unclaimedUsers.sections.goal")}</p>
                  <p className="text-sm line-clamp-2">{user.main_goal}</p>
                </div>

                <Separator />

                {/* Preferences */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{user.age_range} {t("partnerDashboard.unclaimedUsers.badges.years")}</Badge>
                  <Badge variant={commStyle.variant}>{commStyle.label} {t("partnerDashboard.unclaimedUsers.badges.communication")}</Badge>
                  {user.mentor_preference !== "no_preference" && (
                    <Badge variant="secondary">
                      {user.mentor_preference === "male" ? t("partnerDashboard.unclaimedUsers.badges.prefersMale") : t("partnerDashboard.unclaimedUsers.badges.prefersFemale")}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}

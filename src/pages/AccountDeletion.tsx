import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Trash2, ArrowLeft, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useAccountDeletion } from "@/hooks/useAccountDeletion";
import { useSession } from "@/hooks/useSession";
import { RequireAuth } from "@/components/session/RequireAuth";
import { format } from "date-fns";

/**
 * Account Deletion page - allows users to request account deletion
 */
function AccountDeletionContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  const {
    pendingRequest,
    isLoading: _isLoading,
    requestDeletion,
    isRequesting,
    cancelDeletion,
    isCancelling,
  } = useAccountDeletion();

  const [emailConfirmation, setEmailConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const userEmail = user?.email ?? "";
  const emailMatches = emailConfirmation.toLowerCase() === userEmail.toLowerCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailMatches) return;

    try {
      await requestDeletion({ reason, feedback });
      setShowSuccess(true);
    } catch {
      // Error handled by hook
    }
  };

  const handleCancel = async () => {
    try {
      await cancelDeletion();
    } catch {
      // Error handled by hook
    }
  };

  // Show success state
  if (showSuccess) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">
              {t("legal.accountDeletion.requestSubmitted.title")}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t("legal.accountDeletion.requestSubmitted.message")}
            </p>
            <Button onClick={() => navigate("/member")}>
              {t("legal.accountDeletion.buttons.goBack")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show pending request
  if (pendingRequest) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {t("legal.accountDeletion.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("legal.accountDeletion.warning")}</AlertTitle>
            <AlertDescription>
              {t("legal.accountDeletion.requestSubmitted.message")}
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <Label>{t("common.requestedAt")}</Label>
              <p className="text-muted-foreground">
                {format(new Date(pendingRequest.requested_at), "PPP")}
              </p>
            </div>
            <div>
              <Label>{t("common.scheduledFor")}</Label>
              <p className="text-muted-foreground font-semibold">
                {format(new Date(pendingRequest.scheduled_deletion_at), "PPP")}
              </p>
            </div>
          </div>

          <Separator className="my-6" />

          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isCancelling}
              className="flex-1"
            >
              {isCancelling
                ? t("common.cancelling")
                : t("legal.accountDeletion.buttons.cancel")}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/member")}>
              {t("legal.accountDeletion.buttons.goBack")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="h-5 w-5" />
          {t("legal.accountDeletion.title")}
        </CardTitle>
        <CardDescription>
          {t("legal.accountDeletion.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("legal.accountDeletion.warning")}</AlertTitle>
        </Alert>

        {/* Consequences */}
        <div className="mb-6">
          <h3 className="font-semibold mb-3">
            {t("legal.accountDeletion.consequences.title")}
          </h3>
          <ul className="space-y-2">
            {(
              t("legal.accountDeletion.consequences.items", {
                returnObjects: true,
              }) as string[]
            ).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="text-destructive">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Data Retention Notice */}
        <Alert className="mb-6">
          <AlertTitle>{t("legal.accountDeletion.dataRetention.title")}</AlertTitle>
          <AlertDescription>
            {t("legal.accountDeletion.dataRetention.content")}
          </AlertDescription>
        </Alert>

        <Separator className="my-6" />

        {/* Confirmation Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h3 className="font-semibold mb-3">
              {t("legal.accountDeletion.confirmation.title")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("legal.accountDeletion.confirmation.instructions")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">
              {t("legal.accountDeletion.confirmation.emailLabel")}
            </Label>
            <Input
              id="email"
              type="email"
              value={emailConfirmation}
              onChange={(e) => setEmailConfirmation(e.target.value)}
              placeholder={t("legal.accountDeletion.confirmation.emailPlaceholder")}
              className={
                emailConfirmation && !emailMatches
                  ? "border-destructive"
                  : undefined
              }
            />
            {emailConfirmation && !emailMatches && (
              <p className="text-sm text-destructive">
                {t("legal.accountDeletion.confirmation.emailMismatch")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">
              {t("legal.accountDeletion.confirmation.reasonLabel")}
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder={t("common.selectOption")} />
              </SelectTrigger>
              <SelectContent>
                {[
                  "notUseful",
                  "privacyConcerns",
                  "tooComplicated",
                  "foundAlternative",
                  "temporaryBreak",
                  "other",
                ].map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`legal.accountDeletion.confirmation.reasons.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback">
              {t("legal.accountDeletion.confirmation.reasonPlaceholder")}
            </Label>
            <Textarea
              id="feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t("legal.accountDeletion.confirmation.reasonPlaceholder")}
              rows={3}
            />
          </div>

          <div className="flex gap-4 pt-4">
            <Button
              type="submit"
              variant="destructive"
              disabled={!emailMatches || isRequesting}
              className="flex-1"
            >
              {isRequesting
                ? t("legal.accountDeletion.buttons.deleting")
                : t("legal.accountDeletion.buttons.delete")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("legal.accountDeletion.buttons.goBack")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AccountDeletion() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t("legal.accountDeletion.title")} | Platform`;
  }, [t]);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <AccountDeletionContent />
        </div>
      </div>
    </RequireAuth>
  );
}

/**
 * Stránka pro registration do studie.
 *
 * Používá dynamicky načítaný dotazník z databáze.
 * Konsistentní s mobilní aplikací.
 *
 * @module pages/StudyRegistration
 */

import { useState, useMemo, useEffect } from "react";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Shield, CheckCircle, AlertCircle } from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useRIIMembership } from "@/hooks/useRIIMembership";
import { useStudyRegistrationQuestionnaireWithBlocks } from "@/hooks/useStudyRegistrationQuestionnaire";
import {
  useClaimInvitation,
  useStudyConsentRequirementsLocalized,
  useSubmitStudyConsentAcceptance,
  useInsertQuestionnaireResponse,
  useCreateStudyRegistration,
} from "@/hooks";
import { DynamicQuestionnaireForm, type QuestionnaireResponses } from "@/components/questionnaire/DynamicQuestionnaireForm";
import { safeError } from "@/lib/security/safeLogger";

// Consent requirements type is inferred from useStudyConsentRequirementsLocalized hook

/**
 * Dynamická stránka pro registration do umbrella studie.
 *
 * Flow:
 * 1. Načte umbrella studii
 * 2. Načte consent requirements
 * 3. Po schválení consentů zobrazí dynamický dotazník
 * 4. Po odeslání dotazníku vytvoří registration
 */
export default function DynamicStudyRegistration() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitationCode = searchParams.get("code") || searchParams.get("invite");
  const { user: _user } = useSession();
  const locale = getTranslationLocale(i18n.language);

  // RII membership status
  const {
    registration: existingRegistration,
    isRIIMember,
    isPendingRII: _isPendingRII,
    hasCompletedQuestionnaire,
    umbrellaStudyId,
    isLoading: riiLoading,
  } = useRIIMembership();

  // Dynamický dotazník pro studii
  const {
    questionnaire,
    questionnaireId,
    steps,
    isLoading: questionnaireLoading,
    error: questionnaireError,
  } = useStudyRegistrationQuestionnaireWithBlocks(umbrellaStudyId);

  // Consent requirements via hook
  const { data: consentRequirements, isLoading: consentLoading } =
    useStudyConsentRequirementsLocalized(umbrellaStudyId, locale);

  // Mutation hooks
  const submitConsentMutation = useSubmitStudyConsentAcceptance();
  const createRegistrationMutation = useCreateStudyRegistration();
  const insertResponseMutation = useInsertQuestionnaireResponse();
  const claimInvitationMutation = useClaimInvitation();

  // State
  const [phase, setPhase] = useState<"consent" | "questionnaire" | "complete">("consent");
  const [consentChecks, setConsentChecks] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (phase !== "questionnaire") return;
    if (typeof window === "undefined") return;

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // jsdom/noop environments can throw for scroll APIs
    }
  }, [phase]);

  // Initialize consent checks
  useEffect(() => {
    if (!consentRequirements) return;
    setConsentChecks((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const req of consentRequirements) {
        if (!(req.consent_template_id in next)) {
          next[req.consent_template_id] = false;
        }
      }
      return next;
    });
  }, [consentRequirements]);

  // Check if all required consents are accepted
  const requiredConsentIds = useMemo(() => {
    return (consentRequirements ?? [])
      .filter((r) => r.is_required)
      .map((r) => r.consent_template_id);
  }, [consentRequirements]);

  const hasAllRequiredConsents = useMemo(() => {
    if (!consentRequirements || consentRequirements.length === 0) return false;
    return requiredConsentIds.every((id) => consentChecks[id]);
  }, [consentChecks, consentRequirements, requiredConsentIds]);

  // Already enrolled - redirect
  useEffect(() => {
    if (!riiLoading && isRIIMember && hasCompletedQuestionnaire) {
      navigate("/member");
    }
  }, [riiLoading, isRIIMember, hasCompletedQuestionnaire, navigate]);

  // Handle consent submission
  const handleConsentSubmit = async () => {
    if (!umbrellaStudyId || !hasAllRequiredConsents) return;

    setIsSubmitting(true);
    try {
      // Submit each consent via hook
      for (const req of consentRequirements ?? []) {
        if (!req.is_required && !consentChecks[req.consent_template_id]) continue;

        await submitConsentMutation.mutateAsync({
          consentTemplateId: req.consent_template_id,
          granted: true,
          studyId: umbrellaStudyId,
        });
      }

      // Move to questionnaire phase
      setPhase("questionnaire");
    } catch (error) {
      safeError("DynamicStudyRegistration.consent", error);
      toast.error(t("study.messages.consentError"), {
        description: t("study.messages.consentErrorDesc"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle questionnaire submission
  const handleQuestionnaireSubmit = async (responses: QuestionnaireResponses) => {
    if (!questionnaireId || !umbrellaStudyId) return;

    setIsSubmitting(true);
    try {
      // Create registration if not exists via hook
      if (!existingRegistration) {
        await createRegistrationMutation.mutateAsync({
          initialStatus: invitationCode ? "enrolled" : "screening",
          studyId: umbrellaStudyId,
        });
      }

      // Submit questionnaire responses via hook
      await insertResponseMutation.mutateAsync({
        questionnaireId: questionnaireId,
        responses: responses,
        studyRegistrationId: existingRegistration?.id,
      });

      // Claim invitation if present via hook
      if (invitationCode) {
        try {
          await claimInvitationMutation.mutateAsync({ code: invitationCode });
        } catch (claimError) {
          safeError("DynamicStudyRegistration.claimInvitation", claimError);
        }
      }

      toast.success(t("study.messages.registrationSuccess"), {
        description: t("study.messages.registrationSuccessDesc"),
      });

      setPhase("complete");

      // Redirect after delay
      setTimeout(() => {
        navigate("/member");
      }, 2000);
    } catch (error) {
      safeError("DynamicStudyRegistration.submit", error);
      toast.error(t("study.messages.submitError"), {
        description: t("study.messages.submitErrorDesc"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  const isLoading = riiLoading || consentLoading || questionnaireLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">{t("common.loading")}</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Error state
  if (questionnaireError || !umbrellaStudyId) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container max-w-2xl mx-auto py-8 px-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>
              {t("study.messages.loadError")}
            </AlertDescription>
          </Alert>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container max-w-2xl mx-auto py-8 px-4">
        {/* Consent Phase */}
        {phase === "consent" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <CardTitle>{t("study.registration.consentsTitle")}</CardTitle>
              </div>
              <CardDescription>
                {t("study.registration.consentsDescription")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Consent items */}
              {consentRequirements?.map((consent) => (
                <div key={consent.id} className="space-y-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={consent.consent_template_id}
                      checked={consentChecks[consent.consent_template_id] ?? false}
                      onCheckedChange={(checked) =>
                        setConsentChecks((prev) => ({
                          ...prev,
                          [consent.consent_template_id]: !!checked,
                        }))
                      }
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor={consent.consent_template_id}
                        className="font-medium cursor-pointer"
                      >
                        {consent.title}
                        {consent.is_required && (
                          <span className="text-destructive ml-1">*</span>
                        )}
                      </Label>
                      <ScrollArea className="h-24 rounded border p-2">
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {consent.content}
                        </p>
                      </ScrollArea>
                    </div>
                  </div>
                  <Separator />
                </div>
              ))}

              <Button
                onClick={handleConsentSubmit}
                disabled={!hasAllRequiredConsents || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.processing")}
                  </>
                ) : (
                  t("study.registration.continueToQuestionnaire")
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Questionnaire Phase */}
        {phase === "questionnaire" && (
          <>
            {!questionnaire ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {t("study.registration.questionnaireMissingError")}
                </AlertDescription>
              </Alert>
            ) : (
              <ErrorBoundary>
                <DynamicQuestionnaireForm
                  steps={steps}
                  onSubmit={handleQuestionnaireSubmit}
                  onCancel={() => navigate(-1)}
                  isSubmitting={isSubmitting}
                  title={questionnaire.questionnaire_title}
                  description={questionnaire.questionnaire_description}
                />
              </ErrorBoundary>
            )}
          </>
        )}

        {/* Complete Phase */}
        {phase === "complete" && (
          <Card className="text-center">
            <CardContent className="py-12">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">
                {t("study.messages.registrationSuccess")}
              </h2>
              <p className="text-muted-foreground mb-6">
                {t("study.messages.registrationSuccessDesc")}
              </p>
              <Button onClick={() => navigate("/member")}>
                {t("study.registration.goToDashboard")}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Footer />
    </div>
  );
}

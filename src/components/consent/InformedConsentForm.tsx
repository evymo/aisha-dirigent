import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import { useConsents } from "@/hooks/useStudies";
import { useStudySpecialProvisions, useSubmitStudyConsent } from "@/hooks/useStudyConsent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SignatureCanvas, SignatureCanvasRef } from "./SignatureCanvas";
import { toast } from "sonner";
import { FileText, Shield, CheckCircle2, AlertCircle } from "lucide-react";
import { useRIIMembership } from "@/hooks/useRIIMembership";

const CONSENT_SECTION_IDS = [
  "purpose",
  "procedures",
  "risks",
  "benefits",
  "privacy",
  "withdrawal",
] as const;

interface InformedConsentFormProps {
  studyId?: string;
  studyName?: string;
  onConsentGranted?: () => void;
  onCancel?: () => void;
}

export function InformedConsentForm({
  studyId,
  studyName,
  onConsentGranted,
  onCancel,
}: InformedConsentFormProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { refetch } = useConsents();
  const { umbrellaStudyId, hasCompletedQuestionnaire } = useRIIMembership();
  const signatureRef = useRef<SignatureCanvasRef>(null);

  const effectiveStudyId = studyId ?? umbrellaStudyId ?? undefined;

  const { data: specialProvisions, isLoading: loadingStudyConsent } = useStudySpecialProvisions(effectiveStudyId);
  const submitConsentMutation = useSubmitStudyConsent();

  const requiredSectionIds = useMemo((): string[] => {
    const base: string[] = [...CONSENT_SECTION_IDS];
    if (specialProvisions && specialProvisions.trim()) base.push("special_provisions");
    return base;
  }, [specialProvisions]);

  const [checkedSections, setCheckedSections] = useState<Set<string>>(new Set());
  const [hasSignature, setHasSignature] = useState(false);
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [wearablesConsent, setWearablesConsent] = useState(false);

  const allSectionsChecked = requiredSectionIds.every((s) =>
    checkedSections.has(s)
  );

  const canSubmit =
    allSectionsChecked &&
    hasSignature &&
    dataProcessingConsent &&
    hasCompletedQuestionnaire &&
    Boolean(user) &&
    Boolean(effectiveStudyId) &&
    !loadingStudyConsent;

  const handleSectionCheck = (sectionId: string, checked: boolean) => {
    setCheckedSections((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(sectionId);
      } else {
        next.delete(sectionId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!user || !canSubmit || !effectiveStudyId) return;

    try {
      const signatureData = signatureRef.current?.getSignatureData();

      // Per-study informed consent (required for enrolling in non-umbrella studies).
      await submitConsentMutation.mutateAsync({
        studyId: effectiveStudyId,
        consentType: "informed_consent",
        signatureData: signatureData ?? null,
      });

      // Data processing consent (required).
      await submitConsentMutation.mutateAsync({
        studyId: effectiveStudyId,
        consentType: "data_processing",
        signatureData: signatureData ?? null,
      });

      // Optional wearables consent.
      if (wearablesConsent) {
        await submitConsentMutation.mutateAsync({
          studyId: effectiveStudyId,
          consentType: "wearables",
          signatureData: null,
        });
      }

      await refetch();

      toast.success(t("consent.messages.success"), {
        description: t("consent.messages.successDesc"),
      });

      onConsentGranted?.();
    } catch {
      toast.error(t("consent.messages.error"), {
        description: t("consent.messages.errorDesc"),
      });
    }
  };

  const isSubmitting = submitConsentMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            <div>
              <CardTitle>{t("consent.title")}</CardTitle>
              <CardDescription>
                {studyName
                  ? t("consent.forStudy", { studyName })
                  : t("consent.defaultStudy")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="mb-6">
            <Shield className="h-4 w-4" />
            <AlertDescription>
              {t("consent.readCarefully")}
            </AlertDescription>
          </Alert>

          {!hasCompletedQuestionnaire && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("consent.prereqQuestionnaire")}{" "}
                <Button asChild variant="link" className="p-0 h-auto">
                  <Link to="/study-registration">
                    {t("consent.goToQuestionnaire")}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-6">
              {CONSENT_SECTION_IDS.map((sectionId) => (
                <div
                  key={sectionId}
                  className="p-4 border border-border rounded-lg space-y-3"
                >
                  <h3 className="font-semibold text-foreground">
                    {t(`consent.sections.${sectionId}.title`)}
                  </h3>
                  <Separator />
                  <p className="text-sm">
                    {t(`consent.sections.${sectionId}.content`)}
                  </p>
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id={`check-${sectionId}`}
                      checked={checkedSections.has(sectionId)}
                      onCheckedChange={(checked) =>
                        handleSectionCheck(sectionId, checked as boolean)
                      }
                    />
                    <label
                      htmlFor={`check-${sectionId}`}
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      {t("consent.understandAndAgree")}
                    </label>
                  </div>
                </div>
              ))}

              {specialProvisions && specialProvisions.trim() && (
                <div className="p-4 border border-border rounded-lg space-y-3">
                  <h3 className="font-semibold text-foreground">
                    {t("consent.specialProvisionsTitle")}
                  </h3>
                  <Separator />
                  <p className="text-sm whitespace-pre-wrap">
                    {specialProvisions}
                  </p>
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="check-special-provisions"
                      checked={checkedSections.has("special_provisions")}
                      onCheckedChange={(checked) =>
                        handleSectionCheck("special_provisions", checked as boolean)
                      }
                    />
                    <label
                      htmlFor="check-special-provisions"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      {t("consent.understandAndAgree")}
                    </label>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("consent.additionalConsents")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="data-processing"
              checked={dataProcessingConsent}
              onCheckedChange={(checked) =>
                setDataProcessingConsent(checked as boolean)
              }
            />
            <div className="space-y-1">
              <label
                htmlFor="data-processing"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                {t("consent.dataProcessing.label")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("consent.dataProcessing.description")}
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="wearables"
              checked={wearablesConsent}
              onCheckedChange={(checked) =>
                setWearablesConsent(checked as boolean)
              }
            />
            <div className="space-y-1">
              <label
                htmlFor="wearables"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                {t("consent.wearables.label")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("consent.wearables.description")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("consent.signature.title")}
          </CardTitle>
          <CardDescription>
            {t("consent.signature.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureCanvas
            ref={signatureRef}
            onSignatureChange={setHasSignature}
          />

          {!allSectionsChecked && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("consent.validation.confirmAllSections")}
              </AlertDescription>
            </Alert>
          )}

          {allSectionsChecked && !dataProcessingConsent && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("consent.validation.dataProcessingRequired")}
              </AlertDescription>
            </Alert>
          )}

          {allSectionsChecked && dataProcessingConsent && !hasCompletedQuestionnaire && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("consent.validation.questionnaireRequired")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          {t("consent.buttons.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            t("consent.buttons.saving")
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t("consent.buttons.confirm")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

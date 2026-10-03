import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileSignature, CheckCircle2, Info, PenLine } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SignatureCanvas, type SignatureCanvasRef } from "@/components/consent/SignatureCanvas";
import {
  useMyPendingConsents,
  useSubmitStudyConsentAcceptance,
  type PendingConsent,
} from "@/hooks/useDynamicOnboarding";

/**
 * One outstanding consent, with its own signature pad when the template
 * requires a signature. Kept as its own component so each pending consent owns
 * an independent canvas ref and signature state.
 */
function PendingConsentCard({ consent }: { consent: PendingConsent }) {
  const { t } = useTranslation();
  const signatureRef = useRef<SignatureCanvasRef>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [signed, setSigned] = useState(false);

  const submitMutation = useSubmitStudyConsentAcceptance();

  // A signature-required template cannot be submitted without one — the server
  // enforces this too (submit_study_consent_acceptance rejects a blank signature).
  const needsSignature = consent.requires_signature;
  const canSubmit = !submitMutation.isPending && (!needsSignature || hasSignature);

  const handleSubmit = async () => {
    const signatureData = needsSignature
      ? (signatureRef.current?.getSignatureData() ?? undefined)
      : undefined;

    if (needsSignature && !signatureData) {
      toast.error(t("studyConsents.toast.signatureRequired"));
      return;
    }

    try {
      await submitMutation.mutateAsync({
        consentTemplateId: consent.consent_template_id,
        granted: true,
        signatureData,
        studyId: consent.study_id,
      });
      setSigned(true);
      toast.success(t("studyConsents.toast.success"), {
        description: t("studyConsents.toast.successDesc", { title: consent.title }),
      });
    } catch {
      toast.error(t("studyConsents.toast.error"), {
        description: t("studyConsents.toast.errorDesc"),
      });
    }
  };

  if (signed) {
    return (
      <Card className="border-2 border-primary/40">
        <CardContent className="flex items-center gap-3 pt-6">
          <CheckCircle2 className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium">{consent.title}</p>
            <p className="text-sm text-muted-foreground">{t("studyConsents.signedJustNow")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">{consent.title}</CardTitle>
            <CardDescription>
              {consent.study_name} · {t("studyConsents.version", { version: consent.version })}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            {consent.is_required && (
              <Badge variant="secondary">{t("studyConsents.required")}</Badge>
            )}
            {needsSignature && (
              <Badge variant="outline" className="gap-1">
                <PenLine className="w-3 h-3" />
                {t("studyConsents.signatureNeeded")}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {consent.content ? (
          <ScrollArea className="h-56 rounded-md border p-4">
            <div className="text-sm whitespace-pre-wrap">{consent.content}</div>
          </ScrollArea>
        ) : (
          <Alert>
            <Info className="w-4 h-4" />
            <AlertDescription>{t("studyConsents.noContent")}</AlertDescription>
          </Alert>
        )}

        {needsSignature && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("studyConsents.signHere")}</p>
            <SignatureCanvas ref={signatureRef} onSignatureChange={setHasSignature} />
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            <FileSignature className="w-4 h-4 mr-2" />
            {submitMutation.isPending ? t("studyConsents.submitting") : t("studyConsents.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Lists the member's outstanding study/charter consents and lets them sign each one.
 * Signature-required templates render a signature pad; the PNG data URL is sent as
 * p_signature_data to submit_study_consent_acceptance.
 */
export function StudyConsentSigning() {
  const { t, i18n } = useTranslation();
  const { data: pending = [], isLoading } = useMyPendingConsents(i18n.language);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5" />
            {t("studyConsents.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">{t("studyConsents.loading")}</div>
        </CardContent>
      </Card>
    );
  }

  if (pending.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5" />
            {t("studyConsents.title")}
          </CardTitle>
          <CardDescription>{t("studyConsents.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription>{t("studyConsents.noneOutstanding")}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pending.map((consent) => (
        <PendingConsentCard key={consent.id} consent={consent} />
      ))}
    </div>
  );
}

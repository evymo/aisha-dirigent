import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useCombinedStudyConsents,
  validateRequiredConsents,
  type ValidatedStudyConsent,
} from "@/hooks/useCombinedStudyConsents";

interface DynamicConsentCheckboxesProps {
  studyId: string;
  acceptedConsents: Record<string, boolean>;
  onConsentChange: (consentKey: string, accepted: boolean) => void;
  showValidation?: boolean;
}

/**
 * Component that renders dynamic consent checkboxes based on study configuration
 * Combines consents from umbrella and child studies
 */
export function DynamicConsentCheckboxes({
  studyId,
  acceptedConsents,
  onConsentChange,
  showValidation = false,
}: DynamicConsentCheckboxesProps) {
  const { t } = useTranslation();
  const { data: consents, isLoading, error } = useCombinedStudyConsents(studyId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t("errors.loadingConsents")}
        </AlertDescription>
      </Alert>
    );
  }

  if (!consents || consents.length === 0) {
    return null;
  }

  const allRequiredAccepted = validateRequiredConsents(consents, acceptedConsents);
  const showRequiredWarning = showValidation && !allRequiredAccepted;

  return (
    <div className="space-y-4">
      {showRequiredWarning && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <div>
            <AlertTitle>{t("onboarding.consent_required_title")}</AlertTitle>
            <AlertDescription>{t("onboarding.consent_required_notice")}</AlertDescription>
          </div>
        </Alert>
      )}

      <div className="space-y-3">
        {consents.map((consent) => (
          <ConsentCheckbox
            key={consent.id}
            consent={consent}
            checked={acceptedConsents[consent.consentKey] ?? false}
            onCheckedChange={(checked) => onConsentChange(consent.consentKey, checked === true)}
            showError={showValidation && consent.isRequired && !acceptedConsents[consent.consentKey]}
          />
        ))}
      </div>
    </div>
  );
}

interface ConsentCheckboxProps {
  consent: ValidatedStudyConsent;
  checked: boolean;
  onCheckedChange: (checked: boolean | "indeterminate") => void;
  showError?: boolean;
}

function ConsentCheckbox({
  consent,
  checked,
  onCheckedChange,
  showError = false,
}: ConsentCheckboxProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        showError
          ? "border-destructive bg-destructive/5"
          : checked
          ? "border-primary/30 bg-primary/5"
          : "border-border"
      }`}
    >
      <Checkbox
        id={`consent-${consent.consentKey}`}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
      <div className="flex-1 space-y-1">
        <Label
          htmlFor={`consent-${consent.consentKey}`}
          className="text-sm font-medium leading-none cursor-pointer"
        >
          {consent.checkboxLabel}
          {consent.isRequired && (
            <span className="text-destructive ml-1">*</span>
          )}
        </Label>
        
        {consent.description && (
          <p className="text-xs text-muted-foreground">
            {consent.description}
          </p>
        )}
        
        {consent.documentUrl && (
          <a
            href={consent.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {t("documents.viewDocument")}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default DynamicConsentCheckboxes;

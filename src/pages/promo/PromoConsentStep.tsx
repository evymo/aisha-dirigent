import { useTranslation } from "react-i18next";
import {
  FileText,
  CheckCircle,
  Shield,
  Heart,
  User,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface PromoConsentStepProps {
  agreedDataProcessing: boolean;
  agreedDataSharing: boolean;
  agreedTerms: boolean;
  documentsCount: number;
  onAgreedDataProcessingChange: (value: boolean) => void;
  onAgreedDataSharingChange: (value: boolean) => void;
  onAgreedTermsChange: (value: boolean) => void;
}

export function PromoConsentStep({
  agreedDataProcessing,
  agreedDataSharing,
  agreedTerms,
  documentsCount,
  onAgreedDataProcessingChange,
  onAgreedDataSharingChange,
  onAgreedTermsChange,
}: PromoConsentStepProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t("promo.steps.consent")}
        </CardTitle>
        <CardDescription>
          {t("promo.consent.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollArea className="h-[250px] rounded border p-4">
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4" />
                {t("invitations.consent_terms_title")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t("invitations.consent_terms_desc")}
              </p>
            </div>
            <Separator />
            <div>
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <Heart className="h-4 w-4" />
                {t("invitations.consent_data_processing_title")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t("invitations.consent_data_processing_desc")}
              </p>
            </div>
            <Separator />
            <div>
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <User className="h-4 w-4" />
                {t("invitations.consent_data_sharing_title")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t("invitations.consent_data_sharing_desc")}
              </p>
            </div>
          </div>
        </ScrollArea>

        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="terms"
              checked={agreedTerms}
              onCheckedChange={(c) => onAgreedTermsChange(c as boolean)}
            />
            <Label htmlFor="terms" className="text-sm leading-relaxed cursor-pointer">
              {t("invitations.agree_terms")}
            </Label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="dataProcessing"
              checked={agreedDataProcessing}
              onCheckedChange={(c) => onAgreedDataProcessingChange(c as boolean)}
            />
            <Label htmlFor="dataProcessing" className="text-sm leading-relaxed cursor-pointer">
              {t("invitations.agree_data_processing")}
            </Label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="dataSharing"
              checked={agreedDataSharing}
              onCheckedChange={(c) => onAgreedDataSharingChange(c as boolean)}
            />
            <Label htmlFor="dataSharing" className="text-sm leading-relaxed cursor-pointer">
              {t("invitations.agree_data_sharing")}
            </Label>
          </div>
        </div>

        {documentsCount > 0 && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>{t("promo.summary.documents")}</AlertTitle>
            <AlertDescription>
              {t("promo.summary.documentsCount", { count: documentsCount })}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

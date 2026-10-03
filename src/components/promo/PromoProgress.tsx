import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PROMO_STEPS, type InvitationData } from "./types";

interface PromoProgressProps {
  currentStep: number;
  inviteData: InvitationData;
  onLanguageChanged?: (langCode: string) => void;
}

export function PromoProgress({ currentStep, inviteData, onLanguageChanged }: PromoProgressProps) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
      <div className="container max-w-lg mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{t("promo.title")}</h1>
            {inviteData.partner_name && (
              <p className="text-sm text-muted-foreground">
                {t("promo.invitedBy", { name: inviteData.partner_name })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onLanguageChanged && (
              <LanguageSwitcher onLanguageChanged={onLanguageChanged} />
            )}
            <Badge variant="outline">
              {currentStep}/{PROMO_STEPS.length}
            </Badge>
          </div>
        </div>

        <Progress
          value={(currentStep / PROMO_STEPS.length) * 100}
          className="mt-3 h-1.5"
        />
      </div>
    </div>
  );
}

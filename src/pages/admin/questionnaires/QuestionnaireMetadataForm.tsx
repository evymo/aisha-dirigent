import { useTranslation } from "react-i18next";
import {
  QUESTIONNAIRE_TYPES,
} from "@/hooks";
import {
  type SupportedLanguage,
  type QuestionnaireFormData,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
} from "@/components/admin/questionnaires";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuestionnaireMetadataFormProps {
  /** Current form data for metadata fields */
  formData: QuestionnaireFormData;
  /** Currently active language tab for multi-locale editing */
  activeLang: SupportedLanguage;
  /** Callback to update form data */
  onFormDataChange: (updater: (prev: QuestionnaireFormData) => QuestionnaireFormData) => void;
  /** Callback to change active language tab */
  onActiveLangChange: (lang: SupportedLanguage) => void;
}

/**
 * Metadata section of the questionnaire form.
 *
 * Handles base locale, language tab switching, name, code,
 * questionnaire type, rewards, description, and active toggle.
 */
export function QuestionnaireMetadataForm({
  formData,
  activeLang,
  onFormDataChange,
  onActiveLangChange,
}: QuestionnaireMetadataFormProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Base locale & language switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Label>
            {t("admin.questionnaires.form.baseLocale")}
          </Label>
          <Select
            value={formData.base_locale}
            onValueChange={(value) =>
              onFormDataChange((prev) => ({
                ...prev,
                base_locale: value as SupportedLanguage,
              }))
            }
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {LOCALE_LABELS[lang]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("admin.questionnaires.form.language")}</Label>
          <Tabs
            value={activeLang}
            onValueChange={(v) =>
              onActiveLangChange(v as SupportedLanguage)
            }
          >
            <TabsList className="h-8">
              {SUPPORTED_LOCALES.map((lang) => (
                <TabsTrigger
                  key={lang}
                  value={lang}
                  className="text-xs px-3"
                >
                  {LOCALE_LABELS[lang]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Name + Code */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            {t("admin.questionnaires.form.name")} (
            {LOCALE_LABELS[activeLang]}) *
          </Label>
          <Input
            id="name"
            value={formData.name[activeLang]}
            onChange={(e) =>
              onFormDataChange((prev) => ({
                ...prev,
                name: { ...prev.name, [activeLang]: e.target.value },
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">
            {t("admin.questionnaires.form.code")} *
          </Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) =>
              onFormDataChange((prev) => ({
                ...prev,
                code: e.target.value,
              }))
            }
            required
            placeholder={t(
              "admin.questionnaires.form.codePlaceholder"
            )}
          />
        </div>
      </div>

      {/* Type + rewards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="questionnaire_type">
            {t("admin.questionnaires.form.type")}
          </Label>
          <Select
            value={formData.questionnaire_type}
            onValueChange={(value) =>
              onFormDataChange((prev) => ({
                ...prev,
                questionnaire_type: value,
              }))
            }
          >
            <SelectTrigger id="questionnaire_type">
              <SelectValue
                placeholder={t(
                  "admin.questionnaires.form.typePlaceholder"
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {QUESTIONNAIRE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(
                    `admin.questionnaires.questionnaireTypes.${type}`
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="points_reward">
            {t("admin.questionnaires.form.pointsReward")}
          </Label>
          <Input
            id="points_reward"
            type="number"
            min={0}
            value={formData.points_reward}
            onChange={(e) =>
              onFormDataChange((prev) => ({
                ...prev,
                points_reward: Number(e.target.value),
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token_reward">
            {t("admin.questionnaires.form.tokenReward")}
          </Label>
          <Input
            id="token_reward"
            type="number"
            min={0}
            value={formData.token_reward}
            onChange={(e) =>
              onFormDataChange((prev) => ({
                ...prev,
                token_reward: Number(e.target.value),
              }))
            }
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">
          {t("admin.questionnaires.form.description")} (
          {LOCALE_LABELS[activeLang]})
        </Label>
        <Textarea
          id="description"
          value={formData.description[activeLang]}
          onChange={(e) =>
            onFormDataChange((prev) => ({
              ...prev,
              description: {
                ...prev.description,
                [activeLang]: e.target.value,
              },
            }))
          }
          rows={2}
        />
      </div>

      {/* Active switch */}
      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) =>
            onFormDataChange((prev) => ({ ...prev, is_active: checked }))
          }
        />
        <Label htmlFor="is_active">
          {t("admin.questionnaires.form.active")}
        </Label>
      </div>
    </>
  );
}

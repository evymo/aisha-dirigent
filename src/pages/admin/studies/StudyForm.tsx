import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  LOCALE_LABELS,
} from "@/hooks/useDynamicTranslations";
import type { StudyType } from "@/hooks";
import type { StudyFormData } from "./adminStudiesTypes";

interface StudyFormProps {
  formData: StudyFormData;
  setFormData: (data: StudyFormData) => void;
  activeLang: SupportedLocale;
  onActiveLangChange: (lang: SupportedLocale) => void;
}

export function StudyForm({ formData, setFormData, activeLang, onActiveLangChange }: StudyFormProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t("admin.studies.form.code")} *</Label>
        <Input
          value={formData.code}
          onChange={(e) => setFormData({ ...formData, code: e.target.value })}
          placeholder={t("admin.studies.form.codePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.type")} *</Label>
        <Select
          value={formData.study_type}
          onValueChange={(value: StudyType) => setFormData({ ...formData, study_type: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="observational">{t("admin.studies.types.observational")}</SelectItem>
            <SelectItem value="operational_trial">{t("admin.studies.types.operational_trial")}</SelectItem>
            <SelectItem value="community">{t("admin.studies.types.community")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Language tabs for translatable fields */}
      <div className="col-span-2 space-y-4">
        <Tabs value={activeLang} onValueChange={(v) => onActiveLangChange(v as SupportedLocale)}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
            {SUPPORTED_LOCALES.map((locale) => (
              <TabsTrigger key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </TabsTrigger>
            ))}
          </TabsList>
          {SUPPORTED_LOCALES.map((locale) => (
            <TabsContent key={locale} value={locale} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("admin.studies.form.name")} ({LOCALE_LABELS[locale]}) *</Label>
                <Input
                  value={formData.name[locale] || ""}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      name: { ...formData.name, [locale]: e.target.value },
                    });
                  }}
                  placeholder={t("admin.studies.form.namePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studies.form.description")} ({LOCALE_LABELS[locale]})</Label>
                <Textarea
                  value={formData.description[locale] || ""}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      description: { ...formData.description, [locale]: e.target.value },
                    });
                  }}
                  rows={3}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="space-y-2">
        <Label>{t("admin.studies.form.targetCondition")}</Label>
        <Input
          value={formData.target_condition}
          onChange={(e) => setFormData({ ...formData, target_condition: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("admin.studies.form.protocolUrl")}</Label>
        <Input
          value={formData.protocol_url}
          onChange={(e) => setFormData({ ...formData, protocol_url: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("admin.studies.form.isActive")}</Label>
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("admin.studies.form.isUmbrella")}</Label>
          <Switch
            checked={formData.is_umbrella}
            onCheckedChange={(checked) => setFormData({ ...formData, is_umbrella: checked })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("admin.studies.form.startsAt")}</Label>
        <Input
          type="datetime-local"
          value={formData.starts_at}
          onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("admin.studies.form.endsAt")}</Label>
        <Input
          type="datetime-local"
          value={formData.ends_at}
          onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
        />
      </div>

      <div className="col-span-2 space-y-2">
        <Label>{t("admin.studies.form.products")}</Label>
        <Textarea
          value={formData.products}
          onChange={(e) => setFormData({ ...formData, products: e.target.value })}
          rows={2}
        />
        <p className="text-xs text-muted-foreground">{t("admin.studies.form.productsHelp")}</p>
      </div>

      <div className="space-y-2">
        <Label>{t("admin.studies.form.durationWeeks")}</Label>
        <Input
          type="number"
          value={formData.duration_weeks ?? ""}
          onChange={(e) => setFormData({ ...formData, duration_weeks: e.target.value ? parseInt(e.target.value) : null })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.minParticipants")}</Label>
        <Input
          type="number"
          value={formData.min_participants}
          onChange={(e) => setFormData({ ...formData, min_participants: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.maxParticipants")}</Label>
        <Input
          type="number"
          value={formData.max_participants ?? ""}
          onChange={(e) => setFormData({ ...formData, max_participants: e.target.value ? parseInt(e.target.value) : null })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.fundingGoal")}</Label>
        <Input
          type="number"
          value={formData.funding_goal}
          onChange={(e) => setFormData({ ...formData, funding_goal: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.fundingDeadline")}</Label>
        <Input
          type="date"
          value={formData.funding_deadline}
          onChange={(e) => setFormData({ ...formData, funding_deadline: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("admin.studies.form.consentVersion")}</Label>
        <Input
          value={formData.informed_consent_version}
          onChange={(e) => setFormData({ ...formData, informed_consent_version: e.target.value })}
        />
      </div>
      <div className="col-span-2 space-y-2">
        <Label>{t("admin.studies.form.consentProvisions")}</Label>
        <Textarea
          value={formData.informed_consent_special_provisions}
          onChange={(e) => setFormData({ ...formData, informed_consent_special_provisions: e.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}

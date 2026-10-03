import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import {
  useAdminNotificationCampaigns,
  useNotificationCampaignSchedulesAdmin,
  useNotificationCampaignRunsAdmin,
  useNotificationCampaignDeliveriesAdmin,
  type NotificationCampaignInput,
} from "@/hooks/useAdminNotificationCampaigns";
import {
  useTranslationsByKey,
  useUpsertTranslations,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type TranslationInput,
} from "@/hooks/useDynamicTranslations";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import { useStudiesDropdownAdmin } from "@/hooks/useAdminConsultants";
import {
  type AudienceType,
  type CampaignFormData,
  FREQUENCY_OPTIONS,
  createEmptyLocalized,
  ensureLocales,
  safeParseJson,
} from "./notifications/notificationTypes";
import { CampaignScheduleCard } from "./notifications/CampaignScheduleCard";
import { CampaignHistoryCards } from "./notifications/CampaignHistoryCards";

export default function AdminNotifications() {
  const { t } = useTranslation();
  const { data: supportedLanguages = [] } = useSupportedLanguages();
  const { data: studies = [] } = useStudiesDropdownAdmin();
  const upsertTranslations = useUpsertTranslations();
  const {
    campaigns,
    isLoading,
    upsertCampaign,
    deleteCampaign,
    enqueueSend,
  } = useAdminNotificationCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;
  const { data: schedules = [] } = useNotificationCampaignSchedulesAdmin(selectedCampaignId);
  const { data: runs = [], isLoading: runsLoading } = useNotificationCampaignRunsAdmin(selectedCampaignId);
  const { data: deliveries = [], isLoading: deliveriesLoading } =
    useNotificationCampaignDeliveriesAdmin(selectedCampaignId, 200);

  const activeLocales = useMemo(() => {
    const active = supportedLanguages
      .filter((lang) => lang.is_active)
      .map((lang) => lang.code)
      .filter((code): code is SupportedLocale =>
        (SUPPORTED_LOCALES as readonly string[]).includes(code)
      );
    return active.length > 0 ? active : [...SUPPORTED_LOCALES];
  }, [supportedLanguages]);

  const defaultLocale = useMemo<SupportedLocale>(() => {
    const preferred = supportedLanguages.find((lang) => lang.is_default);
    if (preferred && (SUPPORTED_LOCALES as readonly string[]).includes(preferred.code)) {
      return preferred.code as SupportedLocale;
    }
    return "en";
  }, [supportedLanguages]);

  const emptyForm = useMemo<CampaignFormData>(() => ({
    name: "",
    description: "",
    base_locale: defaultLocale,
    link: "",
    data_json: "",
    audience_type: "all",
    study_id: "",
    questionnaire_frequencies: [],
    user_ids: "",
    send_push: true,
    send_inapp: true,
    is_active: true,
    title: createEmptyLocalized(activeLocales),
    body: createEmptyLocalized(activeLocales),
  }), [activeLocales, defaultLocale]);

  const [formData, setFormData] = useState<CampaignFormData>(emptyForm);
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>(defaultLocale);
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>(
    activeLocales.find((locale) => locale !== defaultLocale) ?? defaultLocale
  );

  const { data: titleTranslations = [] } = useTranslationsByKey(
    selectedCampaign?.title_key ?? "",
    "notifications"
  );
  const { data: bodyTranslations = [] } = useTranslationsByKey(
    selectedCampaign?.body_key ?? "",
    "notifications"
  );

  useEffect(() => {
    setFormData(emptyForm);
    setSourceLocale(defaultLocale);
    setTargetLocale(activeLocales.find((locale) => locale !== defaultLocale) ?? defaultLocale);
  }, [emptyForm, defaultLocale, activeLocales]);

  useEffect(() => {
    if (!selectedCampaign) {
      setFormData(emptyForm);
      return;
    }

    const filter = (selectedCampaign.audience_filter ?? {}) as Record<string, unknown>;
    const frequencies = Array.isArray(filter.frequencies)
      ? filter.frequencies.filter((f): f is string => typeof f === "string")
      : [];
    const userIds = Array.isArray(filter.user_ids)
      ? filter.user_ids.filter((id): id is string => typeof id === "string").join("\n")
      : "";

    setFormData({
      name: selectedCampaign.name,
      description: selectedCampaign.description ?? "",
      base_locale: (selectedCampaign.base_locale as SupportedLocale) ?? defaultLocale,
      link: selectedCampaign.link ?? "",
      data_json: selectedCampaign.data ? JSON.stringify(selectedCampaign.data, null, 2) : "",
      audience_type: (selectedCampaign.audience_type as AudienceType) ?? "all",
      study_id: typeof filter.study_id === "string" ? filter.study_id : "",
      questionnaire_frequencies: frequencies,
      user_ids: userIds,
      send_push: selectedCampaign.send_push,
      send_inapp: selectedCampaign.send_inapp,
      is_active: selectedCampaign.is_active,
      title: ensureLocales(
        titleTranslations.reduce<Partial<Record<SupportedLocale, string>>>((acc, item) => {
          acc[item.locale as SupportedLocale] = item.value;
          return acc;
        }, createEmptyLocalized(activeLocales)),
        activeLocales
      ),
      body: ensureLocales(
        bodyTranslations.reduce<Partial<Record<SupportedLocale, string>>>((acc, item) => {
          acc[item.locale as SupportedLocale] = item.value;
          return acc;
        }, createEmptyLocalized(activeLocales)),
        activeLocales
      ),
    });

    setSourceLocale(
      (selectedCampaign.base_locale as SupportedLocale) ?? defaultLocale
    );
    setTargetLocale(
      activeLocales.find((locale) => locale !== selectedCampaign.base_locale) ?? defaultLocale
    );
  }, [
    selectedCampaign,
    titleTranslations,
    bodyTranslations,
    activeLocales,
    defaultLocale,
    emptyForm,
  ]);

  const handleNewCampaign = () => {
    setSelectedCampaignId(null);
    setFormData(emptyForm);
  };

  const updateLocalized = (field: "title" | "body", locale: SupportedLocale, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [locale]: value,
      },
    }));
  };

  const handleFrequencyToggle = (frequency: string) => {
    setFormData((prev) => {
      const has = prev.questionnaire_frequencies.includes(frequency);
      const next = has
        ? prev.questionnaire_frequencies.filter((f) => f !== frequency)
        : [...prev.questionnaire_frequencies, frequency];
      return { ...prev, questionnaire_frequencies: next };
    });
  };

  const buildAudienceFilter = (): Record<string, unknown> | null => {
    if (formData.audience_type === "study") {
      return formData.study_id ? { study_id: formData.study_id } : null;
    }
    if (formData.audience_type === "questionnaire_due") {
      return formData.questionnaire_frequencies.length > 0
        ? { frequencies: formData.questionnaire_frequencies }
        : null;
    }
    if (formData.audience_type === "user_list") {
      const ids = formData.user_ids
        .split(/\s+/)
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return ids.length > 0 ? { user_ids: ids } : null;
    }
    return null;
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t("admin.notifications.errors.missingName"));
      return;
    }

    const audienceFilter = buildAudienceFilter();
    if (formData.audience_type !== "all" && !audienceFilter) {
      toast.error(t("admin.notifications.errors.missingAudience"));
      return;
    }

    const parsedData = safeParseJson(formData.data_json);
    if (formData.data_json.trim() && parsedData === null) {
      toast.error(t("admin.notifications.errors.invalidJson"));
      return;
    }

    const payload: NotificationCampaignInput = {
      id: selectedCampaign?.id ?? null,
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      base_locale: formData.base_locale,
      link: formData.link.trim() || null,
      data: parsedData,
      audience_type: formData.audience_type,
      audience_filter: audienceFilter,
      send_push: formData.send_push,
      send_inapp: formData.send_inapp,
      is_active: formData.is_active,
    };

    try {
      const campaign = await upsertCampaign.mutateAsync(payload);

      const translationInputs: TranslationInput[] = [];
      const locales = activeLocales.length > 0 ? activeLocales : [...SUPPORTED_LOCALES];
      const pushTranslation = (key: string, locale: SupportedLocale, value?: string) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        translationInputs.push({
          key,
          locale,
          value: trimmed,
          namespace: "notifications",
        });
      };

      locales.forEach((locale) => {
        pushTranslation(campaign.title_key, locale, formData.title[locale]);
        pushTranslation(campaign.body_key, locale, formData.body[locale]);
      });

      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      setSelectedCampaignId(campaign.id);
      toast.success(t("admin.notifications.toast.saved"));
    } catch {
      toast.error(t("admin.notifications.errors.saveFailed"));
    }
  };

  const handleDelete = async () => {
    if (!selectedCampaign) return;
    try {
      await deleteCampaign.mutateAsync(selectedCampaign.id);
      setSelectedCampaignId(null);
      setFormData(emptyForm);
      toast.success(t("admin.notifications.toast.deleted"));
    } catch {
      toast.error(t("admin.notifications.errors.deleteFailed"));
    }
  };

  const handleSendNow = async () => {
    if (!selectedCampaign) return;
    try {
      await enqueueSend.mutateAsync(selectedCampaign.id);
      toast.success(t("admin.notifications.toast.sendQueued"));
    } catch {
      toast.error(t("admin.notifications.errors.sendFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.notifications.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.notifications.subtitle")}
          </p>
        </div>
        <Button onClick={handleNewCampaign}>
          <Plus className="mr-2 h-4 w-4" />
          {t("admin.notifications.actions.new")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.notifications.listTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && (
              <div className="text-sm text-muted-foreground">
                {t("admin.notifications.loading")}
              </div>
            )}
            {!isLoading && campaigns.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {t("admin.notifications.empty")}
              </div>
            )}
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                onClick={() => setSelectedCampaignId(campaign.id)}
                className={`w-full text-left border rounded-md p-3 transition-colors ${
                  selectedCampaignId === campaign.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{campaign.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {campaign.is_active
                      ? t("admin.notifications.status.active")
                      : t("admin.notifications.status.inactive")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("admin.notifications.listSchedules", { count: campaign.schedule_count ?? 0 })}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.notifications.editorTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="campaign-name">{t("admin.notifications.fields.name")}</Label>
                  <Input
                    id="campaign-name"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="campaign-base-locale">{t("admin.notifications.fields.baseLocale")}</Label>
                  <Select
                    value={formData.base_locale}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, base_locale: value as SupportedLocale }))
                    }
                  >
                    <SelectTrigger id="campaign-base-locale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeLocales.map((locale) => (
                        <SelectItem key={locale} value={locale}>
                          {locale.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaign-description">{t("admin.notifications.fields.description")}</Label>
                <Textarea
                  id="campaign-description"
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <LocalizedFieldEditor
                label={t("admin.notifications.fields.title")}
                fieldId="campaign-title"
                value={formData.title}
                onChange={(locale, value) => updateLocalized("title", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                locales={activeLocales}
              />

              <LocalizedFieldEditor
                label={t("admin.notifications.fields.body")}
                fieldId="campaign-body"
                value={formData.body}
                onChange={(locale, value) => updateLocalized("body", locale, value)}
                primaryLocale={sourceLocale}
                targetLocale={targetLocale}
                onSourceLocaleChange={setSourceLocale}
                onTargetLocaleChange={setTargetLocale}
                locales={activeLocales}
                multiline
                rows={4}
              />

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="campaign-link">{t("admin.notifications.fields.link")}</Label>
                  <Input
                    id="campaign-link"
                    value={formData.link}
                    onChange={(e) => setFormData((prev) => ({ ...prev, link: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="campaign-data">{t("admin.notifications.fields.dataPayload")}</Label>
                  <Textarea
                    id="campaign-data"
                    rows={2}
                    placeholder={t("admin.notifications.fields.dataPayloadPlaceholder")}
                    value={formData.data_json}
                    onChange={(e) => setFormData((prev) => ({ ...prev, data_json: e.target.value }))}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("admin.notifications.fields.audienceType")}</Label>
                  <Select
                    value={formData.audience_type}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, audience_type: value as AudienceType }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("admin.notifications.audience.all")}</SelectItem>
                      <SelectItem value="study">{t("admin.notifications.audience.study")}</SelectItem>
                      <SelectItem value="questionnaire_due">{t("admin.notifications.audience.questionnaire")}</SelectItem>
                      <SelectItem value="user_list">{t("admin.notifications.audience.userList")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.audience_type === "study" && (
                  <div className="space-y-2">
                    <Label>{t("admin.notifications.fields.study")}</Label>
                    <Select
                      value={formData.study_id}
                      onValueChange={(value) => setFormData((prev) => ({ ...prev, study_id: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {studies.map((study) => (
                          <SelectItem key={study.id} value={study.id}>
                            {study.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {formData.audience_type === "questionnaire_due" && (
                  <div className="space-y-2">
                    <Label>{t("admin.notifications.fields.frequencies")}</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FREQUENCY_OPTIONS.map((frequency) => (
                        <label key={frequency} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={formData.questionnaire_frequencies.includes(frequency)}
                            onCheckedChange={() => handleFrequencyToggle(frequency)}
                          />
                          {t(`admin.notifications.frequencies.${frequency}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {formData.audience_type === "user_list" && (
                  <div className="space-y-2">
                    <Label htmlFor="campaign-user-ids">{t("admin.notifications.fields.userIds")}</Label>
                    <Textarea
                      id="campaign-user-ids"
                      rows={3}
                      placeholder={t("admin.notifications.fields.userIdsPlaceholder")}
                      value={formData.user_ids}
                      onChange={(e) => setFormData((prev) => ({ ...prev, user_ids: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("admin.notifications.fields.userIdsHelp")}
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label>{t("admin.notifications.fields.sendPush")}</Label>
                  <Switch
                    checked={formData.send_push}
                    onCheckedChange={(value) => setFormData((prev) => ({ ...prev, send_push: value }))}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label>{t("admin.notifications.fields.sendInApp")}</Label>
                  <Switch
                    checked={formData.send_inapp}
                    onCheckedChange={(value) => setFormData((prev) => ({ ...prev, send_inapp: value }))}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label>{t("admin.notifications.fields.active")}</Label>
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(value) => setFormData((prev) => ({ ...prev, is_active: value }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSave} disabled={upsertCampaign.isPending}>
                  {t("admin.notifications.actions.save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSendNow}
                  disabled={!selectedCampaign}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {t("admin.notifications.actions.sendNow")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={!selectedCampaign}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("admin.notifications.actions.delete")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <CampaignScheduleCard
            campaignId={selectedCampaignId}
            schedules={schedules}
          />

          <CampaignHistoryCards
            runs={runs}
            runsLoading={runsLoading}
            deliveries={deliveries}
            deliveriesLoading={deliveriesLoading}
          />
        </div>
      </div>
    </div>
  );
}

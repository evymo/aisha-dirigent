import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageUp, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  DEFAULT_EMAIL_BRANDING,
  getEmailBrandingLogoUrl,
  useEmailBrandingConfig,
  useEmailBrandingUpload,
  useUpdateEmailBranding,
  type EmailBrandingConfig,
  type LogoUploadResult,
} from "@/hooks/useEmailBranding";

/**
 * Admin settings section for email branding and logo management.
 */
export function EmailBrandingSettings() {
  const { t } = useTranslation();
  const { data: branding, isLoading } = useEmailBrandingConfig();
  const updateMutation = useUpdateEmailBranding();
  const { uploadLogo } = useEmailBrandingUpload();

  const [formState, setFormState] = useState<EmailBrandingConfig>(DEFAULT_EMAIL_BRANDING);
  const [logoUrl, setLogoUrl] = useState<string>(() =>
    `${getEmailBrandingLogoUrl(DEFAULT_EMAIL_BRANDING.logo_path)}?v=${Date.now()}`
  );
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!branding) return;
    setFormState(branding);
    setLogoUrl(`${getEmailBrandingLogoUrl(branding.logo_path)}?v=${Date.now()}`);
  }, [branding]);

  const canSave = useMemo(() => {
    return Boolean(formState.brand_name.trim() && formState.support_email.trim());
  }, [formState.brand_name, formState.support_email]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(formState);
      toast.success(t("admin.settings.settingsSaved"), {
        description: t("admin.settings.emailBranding.savedDesc"),
      });
    } catch {
      toast.error(t("admin.settings.settingsError"), {
        description: t("admin.settings.emailBranding.saveError"),
      });
    }
  };

  const handleLogoUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const result: LogoUploadResult = await uploadLogo(file);
      // Update logo_path in formState (always branding/logo.png with fixed path upload)
      setFormState((prev) => ({ ...prev, logo_path: result.storagePath }));
      // Show cache-busted URL so the browser doesn't serve stale cached image
      setLogoUrl(result.publicUrl);
      toast.success(t("admin.settings.emailBranding.logoUploadSuccess"), {
        description: t("admin.settings.emailBranding.logoUploadSuccessDesc"),
      });
    } catch {
      toast.error(t("admin.settings.emailBranding.logoUploadError"), {
        description: t("admin.settings.emailBranding.logoUploadErrorDesc"),
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.settings.emailBranding.title")}</CardTitle>
        <CardDescription>{t("admin.settings.emailBranding.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-[160px_1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-24 w-24 overflow-hidden rounded-full border bg-muted">
              {logoUrl ? (
                <img src={logoUrl} alt={t("admin.settings.emailBranding.logoAlt")} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  {t("admin.settings.emailBranding.logoPlaceholder")}
                </div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={isUploading || isLoading} asChild>
              <label className="cursor-pointer">
                <ImageUp className="mr-2 h-4 w-4" />
                {isUploading ? t("admin.settings.emailBranding.logoUploading") : t("admin.settings.emailBranding.logoUpload")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleLogoUpload(file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </Button>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-brand-name">{t("admin.settings.emailBranding.brandNameLabel")}</Label>
              <Input
                id="email-brand-name"
                value={formState.brand_name}
                onChange={(event) => setFormState((prev) => ({ ...prev, brand_name: event.target.value }))}
                placeholder={t("admin.settings.emailBranding.brandNamePlaceholder")}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-support-email">{t("admin.settings.emailBranding.supportEmailLabel")}</Label>
              <Input
                id="email-support-email"
                type="email"
                value={formState.support_email}
                onChange={(event) => setFormState((prev) => ({ ...prev, support_email: event.target.value }))}
                placeholder={t("admin.settings.emailBranding.supportEmailPlaceholder")}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        <Alert>
          <AlertDescription>{t("admin.settings.emailBranding.logoHint")}</AlertDescription>
        </Alert>

        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={!canSave || updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

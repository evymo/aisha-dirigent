/**
 * Admin settings component for unified branding profile management.
 * Supports color palette, typography, assets, operator identity, email and login theme.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { z } from "zod";
import { useBrandingProfile, useUpdateBrandingProfile } from "@/hooks/useBrandingProfile";
import { ALLOWED_ASSET_TYPES, MAX_ASSET_BYTES, usePageAssetUpload } from "@/hooks/usePageAssetUpload";
import { hslNaHex, svgNaPng } from "@/lib/media/slozeniIkony";
import { safeError } from "@/lib/security/safeLogger";
import { SlozeniIkonyDialog, VSTUPNI_TYPY_IKONY } from "./SlozeniIkonyDialog";
import {
  DEFAULT_BRANDING_PROFILE,
  fontFaceSchema,
  type BrandingProfileFormData,
} from "@/lib/schemas/brandingProfileSchemas";

/** HSL color fields for the color editor tab */
const LIGHT_COLOR_FIELDS = [
  "color_primary",
  "color_secondary",
  "color_accent",
  "color_background",
  "color_foreground",
  "color_muted",
  "color_surface",
  "color_destructive",
] as const;

const DARK_COLOR_FIELDS = [
  "dark_color_primary",
  "dark_color_background",
  "dark_color_foreground",
  "dark_color_surface",
  "dark_color_muted",
] as const;

/** i18n label map for color fields */
const COLOR_LABELS: Record<string, string> = {
  color_primary: "admin.settings.brandingProfile.colorPrimary",
  color_secondary: "admin.settings.brandingProfile.colorSecondary",
  color_accent: "admin.settings.brandingProfile.colorAccent",
  color_background: "admin.settings.brandingProfile.colorBackground",
  color_foreground: "admin.settings.brandingProfile.colorForeground",
  color_muted: "admin.settings.brandingProfile.colorMuted",
  color_surface: "admin.settings.brandingProfile.colorSurface",
  color_destructive: "admin.settings.brandingProfile.colorDestructive",
  dark_color_primary: "admin.settings.brandingProfile.colorPrimary",
  dark_color_background: "admin.settings.brandingProfile.colorBackground",
  dark_color_foreground: "admin.settings.brandingProfile.colorForeground",
  dark_color_surface: "admin.settings.brandingProfile.colorSurface",
  dark_color_muted: "admin.settings.brandingProfile.colorMuted",
};

/**
 * BrandingProfileSettings — admin-level branding editor.
 */
export function BrandingProfileSettings() {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useBrandingProfile(null);
  const updateMutation = useUpdateBrandingProfile();

  const [form, setForm] = useState<BrandingProfileFormData>(DEFAULT_BRANDING_PROFILE);
  // font_faces is a structured jsonb array edited as JSON text; kept in parent
  // state (not the editor) so the controlled textarea never fights re-sync.
  const [fontFacesText, setFontFacesText] = useState("");
  // Nahrávání log a ikony (2026-10-01): tlačítko u polí bylo natvrdo vypnuté,
  // šlo jen vložit adresu. Nahrává se TOU cestou, kterou mají obrázky stránek
  // (usePageAssetUpload) — žádné druhé úložiště. SVG se převede na PNG v
  // prohlížeči (úložiště SVG záměrně nebere), favicon se skládá v dialogu.
  const { uploadAsset } = usePageAssetUpload();
  const [ikonaOtevrena, setIkonaOtevrena] = useState(false);
  const [nahravaSe, setNahravaSe] = useState<string | null>(null);
  const vyberSouboru = useRef<Record<string, HTMLInputElement | null>>({});
  const [fontFacesError, setFontFacesError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      color_accent: profile.color_accent,
      color_background: profile.color_background,
      color_destructive: profile.color_destructive,
      color_foreground: profile.color_foreground,
      color_muted: profile.color_muted,
      color_primary: profile.color_primary,
      color_secondary: profile.color_secondary,
      color_surface: profile.color_surface,
      dark_color_background: profile.dark_color_background ?? undefined,
      dark_color_foreground: profile.dark_color_foreground ?? undefined,
      dark_color_muted: profile.dark_color_muted ?? undefined,
      dark_color_primary: profile.dark_color_primary ?? undefined,
      dark_color_surface: profile.dark_color_surface ?? undefined,
      email_footer_text: profile.email_footer_text ?? undefined,
      email_header_bg: profile.email_header_bg ?? undefined,
      favicon_path: profile.favicon_path ?? undefined,
      font_family_body: profile.font_family_body,
      font_family_brand: profile.font_family_brand,
      font_family_code: profile.font_family_code,
      login_accent_color: profile.login_accent_color ?? undefined,
      login_background_color: profile.login_background_color ?? undefined,
      login_card_bg: profile.login_card_bg ?? undefined,
      login_logo_path: profile.login_logo_path ?? undefined,
      logo_dark_path: profile.logo_dark_path ?? undefined,
      logo_path: profile.logo_path ?? undefined,
      operator_address: profile.operator_address ?? undefined,
      operator_email: profile.operator_email,
      operator_name: profile.operator_name,
      operator_phone: profile.operator_phone ?? undefined,
      operator_url: profile.operator_url ?? undefined,
      partner_id: profile.partner_id ?? null,
      font_faces: profile.font_faces ?? null,
    });
    setFontFacesText(
      profile.font_faces && profile.font_faces.length
        ? JSON.stringify(profile.font_faces, null, 2)
        : "",
    );
    setFontFacesError(null);
  }, [profile]);

  const handleFieldChange = (field: keyof BrandingProfileFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const nahrajLogo = async (field: keyof BrandingProfileFormData, soubor: File) => {
    setNahravaSe(field);
    try {
      const png = await svgNaPng(soubor);
      if (!ALLOWED_ASSET_TYPES.has(png.type) || png.size > MAX_ASSET_BYTES) {
        toast.error(t("admin.settings.brandingProfile.icon.unsupported"));
        return;
      }
      handleFieldChange(field, await uploadAsset(png));
      toast.success(t("admin.settings.brandingProfile.icon.uploaded"));
    } catch (chyba) {
      safeError("BrandingProfileSettings.nahrajLogo", chyba);
      toast.error(t("admin.settings.brandingProfile.icon.uploadError"));
    } finally {
      setNahravaSe(null);
    }
  };

  /**
   * font_faces editor: parse + validate the JSON textarea against the
   * fontFaceSchema. Empty → null (OSS default). Invalid → keep last good value
   * in `form`, surface the error, block nothing else. The actual @font-face is
   * re-sanitised at render time by BrandingThemeProvider.buildFontFaceCss.
   */
  const handleFontFacesChange = (raw: string) => {
    setFontFacesText(raw);
    if (raw.trim() === "") {
      setFontFacesError(null);
      setForm((prev) => ({ ...prev, font_faces: null }));
      return;
    }
    try {
      const parsed = z.array(fontFaceSchema).parse(JSON.parse(raw));
      setFontFacesError(null);
      setForm((prev) => ({ ...prev, font_faces: parsed }));
    } catch (err) {
      setFontFacesError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const handleSave = async (publish: boolean) => {
    try {
      await updateMutation.mutateAsync({ formData: form, publish });
      toast.success(t("admin.settings.settingsSaved"), {
        description: publish
          ? t("admin.settings.brandingProfile.publishedDesc")
          : t("admin.settings.brandingProfile.savedDesc"),
      });
    } catch {
      toast.error(t("admin.settings.settingsError"), {
        description: t("admin.settings.brandingProfile.saveError"),
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.settings.brandingProfile.title")}</CardTitle>
        <CardDescription>{t("admin.settings.brandingProfile.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="colors" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="colors">{t("admin.settings.brandingProfile.tabs.colors")}</TabsTrigger>
            <TabsTrigger value="typography">{t("admin.settings.brandingProfile.tabs.typography")}</TabsTrigger>
            <TabsTrigger value="assets">{t("admin.settings.brandingProfile.tabs.assets")}</TabsTrigger>
            <TabsTrigger value="operator">{t("admin.settings.brandingProfile.tabs.operator")}</TabsTrigger>
            <TabsTrigger value="email">{t("admin.settings.brandingProfile.tabs.email")}</TabsTrigger>
            <TabsTrigger value="login">{t("admin.settings.brandingProfile.tabs.login")}</TabsTrigger>
          </TabsList>

          {/* Colors Tab */}
          <TabsContent value="colors" className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {LIGHT_COLOR_FIELDS.map((field) => (
                <ColorField
                  key={field}
                  field={field}
                  label={t(COLOR_LABELS[field])}
                  value={form[field]}
                  onChange={(v) => handleFieldChange(field, v)}
                />
              ))}
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">{t("admin.settings.brandingProfile.darkMode")}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {t("admin.settings.brandingProfile.darkModeHint")}
              </p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {DARK_COLOR_FIELDS.map((field) => (
                  <ColorField
                    key={field}
                    field={field}
                    label={t(COLOR_LABELS[field])}
                    value={form[field] ?? ""}
                    onChange={(v) => handleFieldChange(field, v)}
                  />
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Typography Tab */}
          <TabsContent value="typography" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.fontBrand")}</Label>
                <Input
                  value={form.font_family_brand}
                  onChange={(e) => handleFieldChange("font_family_brand", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.fontBody")}</Label>
                <Input
                  value={form.font_family_body}
                  onChange={(e) => handleFieldChange("font_family_body", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.fontCode")}</Label>
                <Input
                  value={form.font_family_code}
                  onChange={(e) => handleFieldChange("font_family_code", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.settings.brandingProfile.fontFaces")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.brandingProfile.fontFacesHint")}
              </p>
              <textarea
                className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-xs font-mono"
                value={fontFacesText}
                onChange={(e) => handleFontFacesChange(e.target.value)}
                placeholder={
                  '[{"family":"Avenir","src_url":"https://assets.example.com/avenir.woff2","weight":"400 800"}]'
                }
              />
              {fontFacesError && <p className="text-xs text-destructive">{fontFacesError}</p>}
            </div>
          </TabsContent>

          {/* Assets Tab */}
          <TabsContent value="assets" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {([
                ["logo_path", "admin.settings.brandingProfile.logoPath"],
                ["logo_dark_path", "admin.settings.brandingProfile.logoDarkPath"],
                ["favicon_path", "admin.settings.brandingProfile.faviconPath"],
                ["login_logo_path", "admin.settings.brandingProfile.loginLogoPath"],
              ] as const).map(([field, labelKey]) => (
                <div key={field} className="space-y-2">
                  <Label>{t(labelKey)}</Label>
                  <div className="flex gap-2">
                    {form[field] ? (
                      <img src={form[field]} alt="" className="h-9 w-9 rounded border object-contain bg-muted" />
                    ) : null}
                    <Input
                      value={form[field] ?? ""}
                      onChange={(e) => handleFieldChange(field, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={nahravaSe !== null}
                      title={t(field === "favicon_path" ? "admin.settings.brandingProfile.icon.compose" : "admin.settings.brandingProfile.icon.upload")}
                      aria-label={t(field === "favicon_path" ? "admin.settings.brandingProfile.icon.compose" : "admin.settings.brandingProfile.icon.upload")}
                      onClick={() =>
                        field === "favicon_path" ? setIkonaOtevrena(true) : vyberSouboru.current[field]?.click()
                      }
                    >
                      {nahravaSe === field ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </Button>
                    <input
                      ref={(el) => {
                        vyberSouboru.current[field] = el;
                      }}
                      type="file"
                      accept={VSTUPNI_TYPY_IKONY}
                      className="hidden"
                      onChange={(e) => {
                        const soubor = e.target.files?.[0];
                        e.target.value = "";
                        if (soubor) void nahrajLogo(field, soubor);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <SlozeniIkonyDialog
            open={ikonaOtevrena}
            onOpenChange={setIkonaOtevrena}
            vychoziBarva={hslNaHex(form.color_primary) ?? "#1d4ed8"}
            nahraj={(png) => uploadAsset(png)}
            onHotovo={(adresa) => {
              handleFieldChange("favicon_path", adresa);
              toast.success(t("admin.settings.brandingProfile.icon.uploaded"));
            }}
          />

          {/* Operator Tab */}
          <TabsContent value="operator" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.operatorName")}</Label>
                <Input
                  value={form.operator_name}
                  onChange={(e) => handleFieldChange("operator_name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.operatorEmail")}</Label>
                <Input
                  type="email"
                  value={form.operator_email}
                  onChange={(e) => handleFieldChange("operator_email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.operatorPhone")}</Label>
                <Input
                  value={form.operator_phone ?? ""}
                  onChange={(e) => handleFieldChange("operator_phone", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.operatorUrl")}</Label>
                <Input
                  value={form.operator_url ?? ""}
                  onChange={(e) => handleFieldChange("operator_url", e.target.value)}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t("admin.settings.brandingProfile.operatorAddress")}</Label>
                <Input
                  value={form.operator_address ?? ""}
                  onChange={(e) => handleFieldChange("operator_address", e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          {/* Email Tab */}
          <TabsContent value="email" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.emailHeaderBg")}</Label>
                <Input
                  value={form.email_header_bg ?? ""}
                  onChange={(e) => handleFieldChange("email_header_bg", e.target.value)}
                  placeholder="23 100% 55%"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.emailFooterText")}</Label>
                <Input
                  value={form.email_footer_text ?? ""}
                  onChange={(e) => handleFieldChange("email_footer_text", e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          {/* Login Theme Tab */}
          <TabsContent value="login" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.loginBgColor")}</Label>
                <Input
                  value={form.login_background_color ?? ""}
                  onChange={(e) => handleFieldChange("login_background_color", e.target.value)}
                  placeholder="0 0% 10%"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.loginCardBg")}</Label>
                <Input
                  value={form.login_card_bg ?? ""}
                  onChange={(e) => handleFieldChange("login_card_bg", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.settings.brandingProfile.loginAccent")}</Label>
                <Input
                  value={form.login_accent_color ?? ""}
                  onChange={(e) => handleFieldChange("login_accent_color", e.target.value)}
                  placeholder="23 100% 55%"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="outline"
            disabled={updateMutation.isPending}
            onClick={() => handleSave(false)}
          >
            <Save className="h-4 w-4 mr-2" />
            {t("admin.settings.brandingProfile.saveDraft")}
          </Button>
          <Button
            disabled={updateMutation.isPending}
            onClick={() => handleSave(true)}
          >
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("admin.settings.brandingProfile.publish")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Individual HSL color field with swatch preview */
function ColorField({
  field,
  label,
  onChange,
  value,
}: {
  field: string;
  label: string;
  onChange: (v: string) => void;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 rounded border shrink-0"
          style={{ backgroundColor: value ? `hsl(${value})` : "transparent" }}
        />
        <Input
          className="text-xs font-mono"
          placeholder="H S% L%"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

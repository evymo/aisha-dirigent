import { useTranslation } from "react-i18next";
import { LayoutPanelLeft, Smartphone, Cloud } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useStoryLoopUiPreferences,
  type StoryLoopMobilePanel,
} from "@/hooks/useStoryLoopUiPreferences";

const mobilePanelOptions: StoryLoopMobilePanel[] = ["sidebar", "list", "detail"];

/**
 * StoryLoop workspace personalization settings.
 * Stores non-sensitive UI preferences and optional cross-device sync flag.
 */
export function StoryLoopWorkspaceSettings() {
  const { t } = useTranslation();
  const {
    preferences,
    isLoading,
    isError,
    isUpdating,
    updateSyncEnabled,
    updateStoryLoopSettings,
  } = useStoryLoopUiPreferences();

  const handleSyncToggle = async (enabled: boolean): Promise<void> => {
    try {
      await updateSyncEnabled(enabled);
    } catch {
      toast.error(t("profile.storyloopSettings.errors.saveFailed"));
    }
  };

  const handleDefaultMobilePanelChange = async (panel: StoryLoopMobilePanel): Promise<void> => {
    try {
      await updateStoryLoopSettings({
        mobile_default_panel: panel,
      });
    } catch {
      toast.error(t("profile.storyloopSettings.errors.saveFailed"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutPanelLeft className="h-5 w-5" />
          {t("profile.storyloopSettings.title")}
        </CardTitle>
        <CardDescription>{t("profile.storyloopSettings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError && (
          <p className="text-sm text-destructive">{t("profile.storyloopSettings.errors.loadFailed")}</p>
        )}

        <div className="rounded-md border p-3 flex items-center justify-between gap-4">
          <div>
            <Label className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              {t("profile.storyloopSettings.fields.syncEnabled")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("profile.storyloopSettings.fields.syncEnabledHint")}
            </p>
          </div>
          <Switch
            checked={preferences.sync_enabled}
            disabled={isLoading || isUpdating}
            onCheckedChange={(checked) => {
              void handleSyncToggle(checked);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            {t("profile.storyloopSettings.fields.mobileDefaultPanel")}
          </Label>
          <Select
            value={preferences.storyloop_settings.mobile_default_panel}
            onValueChange={(value) => {
              void handleDefaultMobilePanelChange(value as StoryLoopMobilePanel);
            }}
            disabled={isLoading || isUpdating}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mobilePanelOptions.map((panel) => (
                <SelectItem key={panel} value={panel}>
                  {t(`profile.storyloopSettings.mobilePanel.${panel}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("profile.storyloopSettings.fields.mobileDefaultPanelHint")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}


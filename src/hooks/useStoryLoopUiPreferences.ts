import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import type { Json } from "@/integrations/db/types";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";

export const STORYLOOP_UI_PREFERENCES_QUERY_KEY = "storyloop-ui-preferences";

const storyLoopMobilePanelSchema = z.enum(["sidebar", "list", "detail"]);
const panelLayoutSchema = z
  .array(z.number())
  .length(3)
  .refine((layout) => layout.every((value) => Number.isFinite(value) && value >= 5 && value <= 90));

const storyLoopSettingsSchema = z.object({
  layout_desktop: panelLayoutSchema.optional(),
  layout_tablet: panelLayoutSchema.optional(),
  mobile_default_panel: storyLoopMobilePanelSchema.optional(),
  mobile_last_panel: storyLoopMobilePanelSchema.optional(),
});

const storyLoopUiPreferencesResponseSchema = z.object({
  sync_enabled: z.boolean().optional(),
  storyloop_settings: storyLoopSettingsSchema.nullable().optional(),
});

export type StoryLoopMobilePanel = z.infer<typeof storyLoopMobilePanelSchema>;
export type StoryLoopViewportBucket = "mobile" | "tablet" | "desktop";

export interface StoryLoopSettings {
  layout_desktop?: [number, number, number];
  layout_tablet?: [number, number, number];
  mobile_default_panel: StoryLoopMobilePanel;
  mobile_last_panel: StoryLoopMobilePanel;
}

export interface StoryLoopUiPreferences {
  sync_enabled: boolean;
  storyloop_settings: StoryLoopSettings;
}

export type StoryLoopUiPreferencesPatch = {
  sync_enabled?: boolean;
  storyloop_settings?: Partial<StoryLoopSettings>;
};

const DEFAULT_STORYLOOP_UI_PREFERENCES: StoryLoopUiPreferences = {
  sync_enabled: false,
  storyloop_settings: {
    mobile_default_panel: "list",
    mobile_last_panel: "list",
  },
};

function normalizeLayout(
  value: unknown
): [number, number, number] | undefined {
  const parsed = panelLayoutSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return [parsed.data[0], parsed.data[1], parsed.data[2]];
}

function normalizeResponse(input: unknown): StoryLoopUiPreferences {
  const parsed = storyLoopUiPreferencesResponseSchema.safeParse(input);
  if (!parsed.success) {
    safeError("useStoryLoopUiPreferences.parse", parsed.error);
    return DEFAULT_STORYLOOP_UI_PREFERENCES;
  }

  const settings = parsed.data.storyloop_settings;
  return {
    sync_enabled: parsed.data.sync_enabled ?? DEFAULT_STORYLOOP_UI_PREFERENCES.sync_enabled,
    storyloop_settings: {
      layout_desktop: normalizeLayout(settings?.layout_desktop),
      layout_tablet: normalizeLayout(settings?.layout_tablet),
      mobile_default_panel:
        settings?.mobile_default_panel ??
        DEFAULT_STORYLOOP_UI_PREFERENCES.storyloop_settings.mobile_default_panel,
      mobile_last_panel:
        settings?.mobile_last_panel ??
        DEFAULT_STORYLOOP_UI_PREFERENCES.storyloop_settings.mobile_last_panel,
    },
  };
}

function mergePreferences(
  current: StoryLoopUiPreferences,
  patch: StoryLoopUiPreferencesPatch
): StoryLoopUiPreferences {
  const merged: StoryLoopUiPreferences = {
    sync_enabled: patch.sync_enabled ?? current.sync_enabled,
    storyloop_settings: {
      ...current.storyloop_settings,
      ...(patch.storyloop_settings ?? {}),
    },
  };

  if (patch.storyloop_settings?.layout_desktop) {
    const normalized = normalizeLayout(patch.storyloop_settings.layout_desktop);
    if (normalized) merged.storyloop_settings.layout_desktop = normalized;
  }
  if (patch.storyloop_settings?.layout_tablet) {
    const normalized = normalizeLayout(patch.storyloop_settings.layout_tablet);
    if (normalized) merged.storyloop_settings.layout_tablet = normalized;
  }

  return merged;
}

/**
 * Reads and updates user StoryLoop UI preferences (non-sensitive).
 */
export function useStoryLoopUiPreferences(options?: { enabled?: boolean }) {
  const { user } = useSession();
  const enabled = (options?.enabled ?? true) && Boolean(user?.id);
  const queryClient = useQueryClient();
  const queryKey = [STORYLOOP_UI_PREFERENCES_QUERY_KEY, user?.id] as const;

  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<StoryLoopUiPreferences> => {
      const { data, error } = await aisha.rpc("get_my_storyloop_ui_preferences");
      if (error) {
        safeError("useStoryLoopUiPreferences.fetch", error);
        throw new Error(error.message);
      }
      return normalizeResponse(data);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: StoryLoopUiPreferencesPatch): Promise<StoryLoopUiPreferences> => {
      const current =
        queryClient.getQueryData<StoryLoopUiPreferences>(queryKey) ??
        query.data ??
        DEFAULT_STORYLOOP_UI_PREFERENCES;

      const merged = mergePreferences(current, patch);
      const { data, error } = await aisha.rpc("update_my_storyloop_ui_preferences", {
        p_storyloop_settings: merged.storyloop_settings as unknown as Json,
        p_sync_enabled: merged.sync_enabled,
      });

      if (error) {
        safeError("useStoryLoopUiPreferences.update", error);
        throw new Error(error.message);
      }

      return normalizeResponse(data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  return {
    preferences: query.data ?? DEFAULT_STORYLOOP_UI_PREFERENCES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isUpdating: updateMutation.isPending,
    updatePreferences: updateMutation.mutateAsync,
    updateStoryLoopSettings: (patch: Partial<StoryLoopSettings>) =>
      updateMutation.mutateAsync({ storyloop_settings: patch }),
    updateSyncEnabled: (enabledValue: boolean) =>
      updateMutation.mutateAsync({ sync_enabled: enabledValue }),
    refetch: query.refetch,
  };
}

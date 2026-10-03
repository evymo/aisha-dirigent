/**
 * NaturelProvider — app-wide DialogPolicy context (F0).
 *
 * The whole app consumes ONLY the resolved DialogPolicy (koncept E4/E5: the
 * profile belongs to the user; components never receive it — the two naturel
 * screens are the sole exception, they render the user's own profile to the
 * user). F0 = explicit choices only (Z6 calibration + S19 overrides); no
 * passive signal collection ships until the DPIA + V3 A/B gates pass.
 *
 * Persistence: user_ui_preferences.storyloop_settings under the "naturel" key
 * via get/update_my_storyloop_ui_preferences (owner-scoped, auto-creating).
 * The update RPC merges SHALLOWLY (jsonb ||), so we always write the complete
 * naturel object, never a partial. Offline: writes queue through the offline
 * service and replay after login — never silently dropped (SDK deployment
 * rule 2: "Mobil snapshot-first").
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { useAuth } from "@/hooks/useAuth";
import { enqueueMutation, isNetworkConnected } from "@/services/offline";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { mobileBias, resolvePolicy } from "./policy";
import type { DialogPolicy, NaturelPrefs, NaturelProfile } from "./policy";

import type { Json } from "@/types/database";
import type { ReactNode } from "react";

/** Shape stored under storyloop_settings.naturel — style choice, never inference. */
export interface NaturelSettings {
  profile?: NaturelProfile | null;
  /** User chose "Rovnou pracovat" — legitimate; do not nag again (Z6). */
  skippedAt?: string | null;
}

interface NaturelContextValue {
  /** Mobile-biased policy — always defined (safe default without a profile). */
  policy: DialogPolicy;
  /** The user's own profile — ONLY for the naturel screens (E4/E5). */
  profile: NaturelProfile | null;
  loading: boolean;
  /** True once the user calibrated, overrode, or explicitly skipped. */
  decided: boolean;
  saveProfile: (profile: NaturelProfile) => Promise<void>;
  overridePrefs: (prefs: Partial<NaturelPrefs>) => Promise<void>;
  overrideChoiceAxis: (v: number) => Promise<void>;
  setLocked: (locked: boolean) => Promise<void>;
  /** E7 — "vypnout a smazat": removes the stored style entirely. */
  reset: () => Promise<void>;
  skipCalibration: () => Promise<void>;
}

const NaturelContext = createContext<NaturelContextValue | null>(null);

const QUERY_KEY = ["naturel-settings"];

function parseSettings(data: unknown): NaturelSettings {
  if (!data || typeof data !== "object") return {};
  const settings = (data as { storyloop_settings?: unknown }).storyloop_settings;
  if (!settings || typeof settings !== "object") return {};
  const naturel = (settings as { naturel?: unknown }).naturel;
  if (!naturel || typeof naturel !== "object") return {};
  return naturel as NaturelSettings;
}

export function NaturelProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<NaturelSettings>({
    queryKey: QUERY_KEY,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_storyloop_ui_preferences");
      if (error) {
        safeError("naturel.load", error);
        throw error instanceof Error ? error : new Error(String((error as { message?: string }).message ?? error));
      }
      return parseSettings(data);
    },
  });

  const settings = useMemo<NaturelSettings>(() => query.data ?? {}, [query.data]);
  const profile = settings.profile ?? null;

  const persist = useCallback(
    async (next: NaturelSettings) => {
      // Optimistic local state first — the UI must follow the user's explicit
      // choice immediately (class A always wins), online or not.
      queryClient.setQueryData(QUERY_KEY, next);
      const payload = { naturel: next as unknown as Json };
      if (!(await isNetworkConnected())) {
        await enqueueMutation(`naturel-${Date.now()}`, { settings: payload }, "save_naturel_style");
        safeInfo("naturel.persist.queued");
        return;
      }
      const { error } = await api.rpc("update_my_storyloop_ui_preferences", {
        p_storyloop_settings: payload as Json,
      });
      if (error) {
        // Fail loud in logs, then queue for replay — never silently dropped.
        safeError("naturel.persist", error);
        await enqueueMutation(`naturel-${Date.now()}`, { settings: payload }, "save_naturel_style");
      }
    },
    [queryClient],
  );

  const saveProfile = useCallback(
    async (nextProfile: NaturelProfile) => {
      await persist({ profile: { ...nextProfile, updatedAt: new Date().toISOString() }, skippedAt: null });
    },
    [persist],
  );

  const overridePrefs = useCallback(
    async (prefs: Partial<NaturelPrefs>) => {
      const base: NaturelProfile = profile ?? { source: "override" };
      await saveProfile({ ...base, prefs: { ...base.prefs, ...prefs }, source: "override" });
    },
    [profile, saveProfile],
  );

  const overrideChoiceAxis = useCallback(
    async (v: number) => {
      const base: NaturelProfile = profile ?? { source: "override" };
      await saveProfile({
        ...base,
        axes: { ...base.axes, choice: { v, c: 1 } },
        source: "override",
      });
    },
    [profile, saveProfile],
  );

  const setLocked = useCallback(
    async (locked: boolean) => {
      const base: NaturelProfile = profile ?? { source: "override" };
      await saveProfile({ ...base, override: { ...base.override, locked } });
    },
    [profile, saveProfile],
  );

  const reset = useCallback(async () => {
    await persist({ profile: null, skippedAt: null });
  }, [persist]);

  const skipCalibration = useCallback(async () => {
    await persist({ ...settings, skippedAt: new Date().toISOString() });
  }, [persist, settings]);

  const value = useMemo<NaturelContextValue>(
    () => ({
      policy: mobileBias(resolvePolicy(profile)),
      profile,
      loading: isAuthenticated && query.isLoading,
      decided: Boolean(profile) || Boolean(settings.skippedAt),
      saveProfile,
      overridePrefs,
      overrideChoiceAxis,
      setLocked,
      reset,
      skipCalibration,
    }),
    [profile, isAuthenticated, query.isLoading, settings.skippedAt, saveProfile, overridePrefs, overrideChoiceAxis, setLocked, reset, skipCalibration],
  );

  return <NaturelContext.Provider value={value}>{children}</NaturelContext.Provider>;
}

/** App-wide hook — screens/components consume the policy, never the profile. */
export function useNaturel(): NaturelContextValue {
  const ctx = useContext(NaturelContext);
  if (!ctx) {
    throw new Error("useNaturel must be used within NaturelProvider");
  }
  return ctx;
}

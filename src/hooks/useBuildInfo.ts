import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getBackendInstanceInfo } from "@/integrations/db/backendInstance";

/**
 * Row in the build-info grid.
 *
 * - `href` – when set the value is rendered as a link.
 * - `mono` – when set the value uses monospace font.
 */
export interface BuildInfoRow {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}

export interface BuildInfo {
  /** Whether enough data exists to show the build signature at all. */
  visible: boolean;
  /** Short version identifier displayed inline (e.g. "v1.2.3" or commit SHA). */
  versionIdentifier: string | null;
  /** Formatted deploy stamp for tooltip (YYYY-MM-DD HH:MM UTC). */
  buildTimeTooltip: string | null;
  /** Compact deploy stamp (DDMMHHmm). */
  deployStamp: string | null;
  /** Backend instance ID (masked). */
  backendIdentifier: string | null;
  /** Fully resolved rows ready for rendering in a tooltip/table. */
  rows: BuildInfoRow[];
}

/* ---------- internal helpers ---------- */

const safe = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatBuildTimeTooltip = (raw: string): string | null => {
  const v = raw.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
};

const formatDeployStamp = (raw: string): string | null => {
  const v = raw.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getUTCDate())}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
};

/* ---------- hook ---------- */

/**
 * Extracts and memoises build / environment metadata injected at
 * build-time (via Vite `define`) and from the Supabase backend config.
 *
 * Can be consumed by any component that needs to display environment
 * information – footer, debug panel, status page, etc.
 */
export function useBuildInfo(): BuildInfo {
  const { t } = useTranslation();

  return useMemo(() => {
    /* --- raw globals --- */
    const releaseTag = safe(typeof __RELEASE_TAG__ !== "undefined" ? __RELEASE_TAG__ : "");
    const gitSha = safe(typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "");
    const buildTime = safe(typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "");
    const repoSlug = safe(typeof __REPO_SLUG__ !== "undefined" ? __REPO_SLUG__ : "");
    const githubServerUrl = safe(typeof __GITHUB_SERVER_URL__ !== "undefined" ? __GITHUB_SERVER_URL__ : "") || "https://github.com";
    const githubWorkflow = safe(typeof __GITHUB_WORKFLOW__ !== "undefined" ? __GITHUB_WORKFLOW__ : "");
    const githubRunId = safe(typeof __GITHUB_RUN_ID__ !== "undefined" ? __GITHUB_RUN_ID__ : "");
    const githubRunNumber = safe(typeof __GITHUB_RUN_NUMBER__ !== "undefined" ? __GITHUB_RUN_NUMBER__ : "");
    const githubRefName = safe(typeof __GITHUB_REF_NAME__ !== "undefined" ? __GITHUB_REF_NAME__ : "");

    /* --- derived --- */
    const commitShaShort = gitSha ? gitSha.slice(0, 8) : null;
    const buildTimeTooltip = formatBuildTimeTooltip(buildTime);
    const deployStamp = formatDeployStamp(buildTime);
    const backendInfo = getBackendInstanceInfo();
    const backendIdentifier = backendInfo.maskedId;
    const tag = releaseTag || null;
    const versionIdentifier = tag ? `v${tag}` : commitShaShort;

    const mode = (import.meta.env.MODE as string | undefined) ?? null;
    const siteOrigin = typeof window !== "undefined" ? window.location.origin : null;

    const repoUrl = repoSlug ? `${githubServerUrl}/${repoSlug}` : null;
    const githubRunUrl = repoUrl && githubRunId ? `${repoUrl}/actions/runs/${githubRunId}` : null;

    const backendSourceLabel =
      backendInfo.source === "env"
        ? t("footer.buildSignatureBackendSourceEnv")
        : t("footer.buildSignatureBackendSourceFallback");

    const visible = !!(commitShaShort || deployStamp || tag || backendIdentifier);

    /* --- rows --- */
    const rows: BuildInfoRow[] = [];

    if (buildTimeTooltip || deployStamp) {
      rows.push({ label: t("footer.buildSignatureTooltipDate"), value: buildTimeTooltip ?? (deployStamp as string) });
    }
    if (mode) {
      rows.push({ label: t("footer.buildSignatureTooltipEnvironment"), value: mode, mono: true });
    }
    if (siteOrigin) {
      rows.push({ label: t("footer.buildSignatureTooltipSite"), value: siteOrigin, href: siteOrigin });
    }
    if (versionIdentifier) {
      rows.push({ label: t("footer.buildSignatureTooltipVersion"), value: versionIdentifier, mono: true });
    }
    rows.push({
      label: t("footer.buildSignatureTooltipBackend"),
      value: `${backendIdentifier ?? "sb:unknown"} (${backendSourceLabel})`,
      mono: true,
    });
    if (repoUrl && repoSlug) {
      rows.push({ label: t("footer.buildSignatureTooltipRepo"), value: repoSlug, href: repoUrl });
    }
    if (githubWorkflow) {
      rows.push({ label: t("footer.buildSignatureTooltipWorkflow"), value: githubWorkflow });
    }
    if (githubRefName) {
      rows.push({ label: t("footer.buildSignatureTooltipBranch"), value: githubRefName, mono: true });
    }
    if (githubRunUrl) {
      rows.push({
        label: t("footer.buildSignatureTooltipRun"),
        value: githubRunNumber ? `#${githubRunNumber}` : (githubRunId as string),
        href: githubRunUrl,
      });
    }

    return { visible, versionIdentifier, buildTimeTooltip, deployStamp, backendIdentifier, rows };
  }, [t]);
}

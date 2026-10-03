/**
 * Sentry issues hook — fetches and monitors Sentry issues.
 * Communicates with the sentry-monitor gateway function via the shared API client.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { sentryIssueSchema } from "@/types/schemas";
import type { SentryIssue } from "@/types/schemas";

interface SentryMonitorListResponse {
  issues?: unknown;
}

interface SentryMonitorAnalysisResponse {
  analysis: string;
  suggested_fix: string | null;
  severity: string;
}

function parseIssueArray(data: unknown): SentryIssue[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<SentryIssue[]>((acc, item) => {
    const result = sentryIssueSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

/** Fetch unresolved Sentry issues via edge function */
export function useSentryIssues(enabled = true) {
  return useQuery({
    queryKey: ["sentry-issues"],
    queryFn: async () => {
      const { data, error } = await api.invoke<SentryMonitorListResponse>("sentry-monitor", {
        body: { action: "list_issues" },
      });
      if (error) throw new Error(error.message);
      return parseIssueArray(data?.issues);
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Request AISHA analysis of a specific Sentry issue */
export function useSentryIssueAnalysis(issueId: string | undefined) {
  return useQuery({
    queryKey: ["sentry-issue-analysis", issueId],
    queryFn: async () => {
      const { data, error } = await api.invoke<SentryMonitorAnalysisResponse>("sentry-monitor", {
        body: {
          action: "analyze_issue",
          issue_id: issueId,
        },
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Issue analysis returned no data");
      return data;
    },
    enabled: !!issueId,
    staleTime: 10 * 60 * 1000,
  });
}

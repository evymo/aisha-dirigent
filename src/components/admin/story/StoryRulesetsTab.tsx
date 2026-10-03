/**
 * StoryRulesetsTab — lists the story_rulesets bindings (rich-joined with
 * expert_rules metadata). Read-only in Phase 1; mutation RPC arrives in
 * a follow-up.
 *
 * Each row of story_rulesets becomes a Card; each rule inside the binding
 * is rendered as a Badge with title + category + pinned version.
 */
import { useTranslation } from "react-i18next";
import { BookCheck, History, FileText } from "lucide-react";

import { useStoryRulesets } from "@/hooks/useStoryRulesets";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface StoryRulesetsTabProps {
  storyId: string;
}

export function StoryRulesetsTab({ storyId }: StoryRulesetsTabProps) {
  const { t } = useTranslation();
  const { data: rulesets = [], isLoading, error } = useStoryRulesets({ storyId });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  if (rulesets.length === 0) {
    return (
      <Card data-test="story-rulesets-empty">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t(
            "storyDetail.rulesets.empty",
            "No ruleset bindings yet. AISHA attaches rulesets automatically when she runs against this story.",
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-test="story-rulesets-tab">
      {rulesets.map((rs) => (
        <Card key={rs.ruleset_id} data-test={`ruleset-${rs.ruleset_id}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("storyDetail.rulesets.bindingTitle", "Ruleset binding")}
              <Badge variant="outline" className="text-[10px]">
                {rs.context_profile ?? "repo_plus_rules"}
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-3 text-xs">
              <span className="font-mono">{rs.ruleset_fingerprint.slice(0, 12)}…</span>
              <span>
                <History className="mr-1 inline size-3" aria-hidden="true" />
                {new Date(rs.created_at).toLocaleString()}
              </span>
              <span>
                {t("storyDetail.rulesets.bindingBy", "by")} {rs.created_by}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {rs.rules.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("storyDetail.rulesets.noRules", "No rules in this binding")}
                </span>
              ) : (
                rs.rules.map((rule) => (
                  <Badge
                    key={rule.rule_id}
                    variant={rule.is_default ? "default" : "secondary"}
                    className="font-normal"
                    title={rule.summary ?? undefined}
                  >
                    <FileText className="mr-1 size-3" aria-hidden="true" />
                    {rule.title}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({rule.category}
                      {rule.used_version != null
                        ? ` · v${rule.used_version}`
                        : ""}
                      {rule.used_version != null &&
                      rule.used_version !== rule.current_version
                        ? ` · current v${rule.current_version}`
                        : ""}
                      )
                    </span>
                  </Badge>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

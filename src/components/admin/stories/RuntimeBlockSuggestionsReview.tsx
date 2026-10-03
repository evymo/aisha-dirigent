/**
 * RuntimeBlockSuggestionsReview — show parser's heuristic suggestions
 * for swapping static HTML elements into existing runtime blocks.
 *
 * Default behavior is **no auto-substitution**. Operator inspects each
 * suggestion, sees confidence (yellow < 0.7, green >= 0.9), reads reason,
 * and chooses Accept (substitute) / Reject (keep static) / leave undecided.
 *
 * For `preserve_as_static` items, the UI labels them as "no matching runtime
 * block — flagged as follow-up Aisha-driven dev story" and disables Accept.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RuntimeBlockSuggestion } from "@/lib/schemas/webArtifactSchemas";

interface Props {
  suggestions: RuntimeBlockSuggestion[];
  onDecide?: (decision: { index: number; accept: boolean }) => void;
}

type Decision = "pending" | "accept" | "reject";

function confidenceTone(c: number): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (c >= 0.9) return { label: `${Math.round(c * 100)}%`, variant: "default" };
  if (c >= 0.7) return { label: `${Math.round(c * 100)}%`, variant: "secondary" };
  return { label: `${Math.round(c * 100)}%`, variant: "destructive" };
}

export function RuntimeBlockSuggestionsReview({ suggestions, onDecide }: Props) {
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<Decision[]>(() => suggestions.map(() => "pending"));

  const acceptedCount = useMemo(() => decisions.filter((d) => d === "accept").length, [decisions]);

  if (!suggestions.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("admin.story.suggestions.empty", "No runtime-block suggestions detected.")}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-test="runtime-block-suggestions">
      <div className="text-sm text-muted-foreground">
        {t("admin.story.suggestions.summary", "{{accepted}}/{{total}} accepted", {
          accepted: acceptedCount,
          total: suggestions.length,
        })}
      </div>

      {suggestions.map((s, idx) => {
        const tone = confidenceTone(s.confidence);
        const canAccept = s.kind === "runtime_block" && !!s.suggested_block_type;
        const isPreserve = s.kind === "preserve_as_static";
        return (
          <Card key={idx} data-test={`suggestion-${idx}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {isPreserve ? (
                  <Badge variant="outline">
                    {t("admin.story.suggestions.preserveStatic", "preserve as static")}
                  </Badge>
                ) : (
                  <Badge>{s.suggested_block_type ?? "?"}</Badge>
                )}
                <Badge variant={tone.variant}>{tone.label}</Badge>
                <code className="ml-auto truncate text-xs text-muted-foreground">{s.element_path}</code>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <p className="text-xs text-muted-foreground">{s.reason}</p>
              {isPreserve && s.suggested_followup_story && (
                <p className="text-xs italic text-amber-600">
                  {t("admin.story.suggestions.followup", "Follow-up: {{story}}", {
                    story: s.suggested_followup_story,
                  })}
                </p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {t("admin.story.suggestions.snippet", "Show HTML snippet")}
                </summary>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{s.original_html_snippet}</pre>
              </details>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={decisions[idx] === "accept" ? "default" : "outline"}
                  disabled={!canAccept}
                  onClick={() => {
                    setDecisions((prev) => prev.map((d, i) => (i === idx ? "accept" : d)));
                    onDecide?.({ index: idx, accept: true });
                  }}
                  data-test={`suggestion-${idx}-accept`}
                >
                  {t("admin.story.suggestions.accept", "Accept")}
                </Button>
                <Button
                  size="sm"
                  variant={decisions[idx] === "reject" ? "destructive" : "outline"}
                  onClick={() => {
                    setDecisions((prev) => prev.map((d, i) => (i === idx ? "reject" : d)));
                    onDecide?.({ index: idx, accept: false });
                  }}
                  data-test={`suggestion-${idx}-reject`}
                >
                  {t("admin.story.suggestions.reject", "Reject")}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

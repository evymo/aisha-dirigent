/**
 * AdminWarmupWizard — Step W1 of platform onboarding.
 *
 * First-admin-login flow after a fresh install or cold-start --wipe.
 * Walks the operator through 5 steps that bootstrap the stack-default
 * story's knowledge baseline — which then auto-seeds every subsequent
 * story via the existing per-story-isolation + globals retrieval in
 * compose_context.
 *
 * Steps:
 *   1. welcome       — confirms the stack-default story exists; explains
 *                      the warmup contract (default = platform baseline,
 *                      story = local enrichment)
 *   2. kb_upload     — embeds the existing Phase 8 StoryKnowledgeTab
 *                      scoped to default_story_id. Admin uploads + tags
 *                      initial sources. Step completion gated on
 *                      default_story_kb_count >= MIN_KB_FOR_KB_UPLOAD.
 *   3. rules_setup   — links to AdminContextProfiles for ruleset review.
 *                      Acknowledgement-only step (empty-acceptance valid).
 *   4. test_query    — direct user to chat with the default story open;
 *                      tells them what to verify (citations + graph trail).
 *   5. complete      — stamps the 'complete' marker; surface a "Done"
 *                      card with link back to /admin. Subsequent visits
 *                      to /admin/warmup show the same Done state, no
 *                      redirect loop.
 *
 * Hook-Only data access: usePlatformWarmupState + useMarkWarmupStep.
 * No new admin tooling — every step either explains, embeds existing
 * surface, or links to an existing admin page. Per the directive
 * "vyuzit stavajici moznosti a infrastrukturu".
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Sparkles,
  Upload,
  ScrollText,
  MessageCircle,
  CheckCircle2,
  ArrowRight,
  Loader2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { StoryKnowledgeTab } from "@/components/admin/story/StoryKnowledgeTab";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import {
  useMarkWarmupStep,
  usePlatformWarmupState,
} from "@/hooks/usePlatformWarmupState";
import type { WarmupStep } from "@/schemas/rpcResponseSchemas";
import { safeError } from "@/lib/security/safeLogger";

const STEPS: ReadonlyArray<{ slug: WarmupStep; iconKey: string }> = [
  { slug: "welcome",      iconKey: "welcome" },
  { slug: "kb_upload",    iconKey: "kb_upload" },
  { slug: "rules_setup",  iconKey: "rules_setup" },
  { slug: "test_query",   iconKey: "test_query" },
  { slug: "complete",     iconKey: "complete" },
] as const;

const MIN_KB_FOR_KB_UPLOAD = 1;

function iconForStep(slug: WarmupStep) {
  switch (slug) {
    case "welcome":     return Sparkles;
    case "kb_upload":   return Upload;
    case "rules_setup": return ScrollText;
    case "test_query":  return MessageCircle;
    case "complete":    return CheckCircle2;
  }
}

export default function AdminWarmupWizard() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_panel");
  const { toast } = useToast();

  const { data: state, isLoading } = usePlatformWarmupState();
  const markMutation = useMarkWarmupStep();

  // Compute the active step: first non-completed step, or 'complete'
  // (stable Done state) when the operator finished. Memoized so the
  // step UI doesn't churn on every keystroke in nested forms.
  const activeStep: WarmupStep = useMemo(() => {
    if (!state) return "welcome";
    if (!state.needs_warmup) return "complete";
    const completed = new Set(state.completed_steps);
    for (const step of STEPS) {
      if (!completed.has(step.slug)) return step.slug;
    }
    return "complete";
  }, [state]);

  // Permission gate first — admin/staff only.
  if (!canView) {
    return (
      <>
        <Alert variant="destructive">
          <AlertDescription>{t("common.permissionDenied")}</AlertDescription>
        </Alert>
      </>
    );
  }

  if (isLoading || !state) {
    return (
      <>
        <div className="space-y-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }

  // Wizard transitions are append-only audit rows. Re-stamping a step
  // is allowed but pointless; UI gates that here.
  const handleMarkStep = async (step: WarmupStep, metadata?: Record<string, unknown>) => {
    try {
      await markMutation.mutateAsync({ step, metadata });
      toast({
        title: t("warmup.stepMarked.title"),
        description: t("warmup.stepMarked.description", { step: t(`warmup.steps.${step}.title`) }),
      });
    } catch (err) {
      safeError("AdminWarmupWizard.markStep.failed", err);
      toast({
        title: t("warmup.stepMarkedError"),
        variant: "destructive",
      });
    }
  };

  const completedSet = new Set(state.completed_steps);
  const stepIndex = STEPS.findIndex((s) => s.slug === activeStep);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden />
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("warmup.title")}
            </h1>
            <p className="text-muted-foreground">{t("warmup.subtitle")}</p>
          </div>
          {!state.needs_warmup && (
            <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
              {t("warmup.statusDone")}
            </Badge>
          )}
        </div>

        {/* Stepper rail */}
        <Card>
          <CardContent className="pt-6">
            <ol className="flex flex-wrap gap-3" aria-label={t("warmup.stepperAria")}>
              {STEPS.map((step, idx) => {
                const Icon = iconForStep(step.slug);
                const isDone = completedSet.has(step.slug);
                const isActive = activeStep === step.slug;
                return (
                  <li key={step.slug} className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        "inline-flex h-7 w-7 items-center justify-center rounded-full border " +
                        (isDone
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                          : isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-muted-foreground/30 text-muted-foreground")
                      }
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className={isActive ? "font-medium" : "text-muted-foreground"}>
                      {idx + 1}. {t(`warmup.steps.${step.slug}.title`)}
                    </span>
                    {idx < STEPS.length - 1 && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50 mx-1" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Step content */}
        {activeStep === "welcome" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("warmup.steps.welcome.headline")}</CardTitle>
              <CardDescription>{t("warmup.steps.welcome.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  {state.default_story_id
                    ? t("warmup.steps.welcome.defaultPresent")
                    : t("warmup.steps.welcome.defaultMissing")}
                </AlertDescription>
              </Alert>
              <div className="flex justify-end">
                <Button
                  onClick={() => handleMarkStep("welcome")}
                  disabled={!state.default_story_id || markMutation.isPending}
                >
                  {markMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("warmup.steps.welcome.cta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeStep === "kb_upload" && state.default_story_id && (
          <Card>
            <CardHeader>
              <CardTitle>{t("warmup.steps.kb_upload.headline")}</CardTitle>
              <CardDescription>{t("warmup.steps.kb_upload.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  {t("warmup.steps.kb_upload.requirement", { min: MIN_KB_FOR_KB_UPLOAD })}
                </AlertDescription>
              </Alert>
              <div className="text-xs text-muted-foreground">
                {t("warmup.steps.kb_upload.currentCount", {
                  count: state.default_story_kb_count,
                })}
              </div>
              {/* Reuse the existing Phase 8 surface — no new admin tooling */}
              <StoryKnowledgeTab storyId={state.default_story_id} />
              <div className="flex justify-end">
                <Button
                  onClick={() => handleMarkStep("kb_upload", { kb_count: state.default_story_kb_count })}
                  disabled={
                    state.default_story_kb_count < MIN_KB_FOR_KB_UPLOAD ||
                    markMutation.isPending
                  }
                >
                  {markMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("warmup.steps.kb_upload.cta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeStep === "rules_setup" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("warmup.steps.rules_setup.headline")}</CardTitle>
              <CardDescription>{t("warmup.steps.rules_setup.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>{t("warmup.steps.rules_setup.body")}</AlertDescription>
              </Alert>
              <div className="flex gap-2 items-center text-sm">
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/context-profiles">
                    {t("warmup.steps.rules_setup.openProfiles")}
                  </Link>
                </Button>
                <span className="text-muted-foreground">
                  {t("warmup.steps.rules_setup.acknowledge")}
                </span>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => handleMarkStep("rules_setup")}
                  disabled={markMutation.isPending}
                >
                  {markMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("warmup.steps.rules_setup.cta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeStep === "test_query" && state.default_story_id && (
          <Card>
            <CardHeader>
              <CardTitle>{t("warmup.steps.test_query.headline")}</CardTitle>
              <CardDescription>{t("warmup.steps.test_query.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>{t("warmup.steps.test_query.body")}</AlertDescription>
              </Alert>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                <li>{t("warmup.steps.test_query.checkCitations")}</li>
                <li>{t("warmup.steps.test_query.checkGraph")}</li>
                <li>{t("warmup.steps.test_query.checkRoute")}</li>
              </ol>
              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link to={`/admin/stories/${state.default_story_id}`}>
                    {t("warmup.steps.test_query.openStory")}
                  </Link>
                </Button>
                <Button
                  onClick={() => handleMarkStep("test_query")}
                  disabled={markMutation.isPending}
                >
                  {markMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {t("warmup.steps.test_query.cta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeStep === "complete" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                {t("warmup.steps.complete.headline")}
              </CardTitle>
              <CardDescription>{t("warmup.steps.complete.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>{t("warmup.steps.complete.body")}</AlertDescription>
              </Alert>
              {state.needs_warmup ? (
                <div className="flex justify-end">
                  <Button
                    onClick={() => handleMarkStep("complete", { kb_count: state.default_story_kb_count })}
                    disabled={markMutation.isPending}
                  >
                    {markMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t("warmup.steps.complete.cta")}
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <Button asChild>
                    <Link to="/admin">
                      {t("warmup.steps.complete.backToAdmin")}
                    </Link>
                  </Button>
                </div>
              )}
              {state.last_step_at && (
                <p className="text-xs text-muted-foreground">
                  {t("warmup.steps.complete.lastActivity", { iso: state.last_step_at })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("warmup.progressLabel", {
            current: stepIndex + 1,
            total: STEPS.length,
            count: state.completed_steps.length,
          })}
        </p>
      </div>
    </>
  );
}

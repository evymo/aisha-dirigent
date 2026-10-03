/**
 * AdminStories — entry list.
 *
 * Top of the page: a featured card for the **stack-default story** (singleton),
 * which owns the public default web. Operator iterates on it using the same
 * chat-driven timeline as any other story.
 *
 * Below: list of operator/client stories (existing useAdminStories hook).
 *
 * Hook-Only Data Access (CLAUDE.md). No direct .from() queries.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAdminStories } from "@/hooks/useAdminStories";
import { useStackDefaultStoryId } from "@/hooks/useEnsureStackDefaultStory";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, BookOpen, Package, Users } from "lucide-react";

export default function AdminStories() {
  const { t } = useTranslation();
  const { data: stories, isLoading, error } = useAdminStories();
  const stackStory = useStackDefaultStoryId();

  return (
    <div className="space-y-6 p-6" data-test="admin-stories-list">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          <BookOpen className="mr-2 inline size-6" aria-hidden="true" />
          {t("admin.stories.title", "Stories")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "admin.stories.subtitle",
            "Story is the container for any artifact iteration. Same chat-driven flow for the public default web and for client work.",
          )}
        </p>
      </header>

      {/* Stack-default story — featured card */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          <Package className="mr-1 inline size-4" aria-hidden="true" />
          {t("admin.stories.stackSection", "Your stack")}
        </h2>
        {stackStory.isLoading && <Skeleton className="h-24" />}
        {stackStory.error && (
          <Alert variant="destructive"><AlertDescription>{(stackStory.error as Error).message}</AlertDescription></Alert>
        )}
        {stackStory.data && (
          <Card className="bg-accent/20 border-accent" data-test={`story-${stackStory.data}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{t("admin.stories.stackTitle", "Stack default web")}</span>
                <Badge variant="default">{t("admin.stories.stackBadge", "singleton")}</Badge>
              </CardTitle>
              <CardDescription>
                {t(
                  "admin.stories.stackDescription",
                  "Iterations on the public landing page seeded from domains/default/. Same mechanics as any client story.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button asChild size="sm">
                <Link to={`/partner/storyloop/${stackStory.data}`}>
                  {t("admin.stories.open", "Open in storyloop")} <ArrowRight className="ml-1 inline size-4" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Operator/client stories */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          <Users className="mr-1 inline size-4" aria-hidden="true" />
          {t("admin.stories.partnerSection", "Operator & client stories")}
        </h2>
        {isLoading && <Skeleton className="h-32" />}
        {error && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(stories?.items ?? []).map((story) => {
            const id = (story as { id?: string }).id;
            const title = (story as { title?: string }).title;
            const status = (story as { status?: string }).status;
            const isStackDefault = (story as { is_stack_default?: boolean }).is_stack_default;
            if (!id || isStackDefault) return null; // stack-default rendered above
            return (
              <Card key={id} data-test={`story-${id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="truncate">{title ?? id}</span>
                    {status && <Badge variant="outline">{status}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button asChild size="sm">
                    <Link to={`/partner/storyloop/${id}`}>
                      {t("admin.stories.open", "Open in storyloop")} <ArrowRight className="ml-1 inline size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

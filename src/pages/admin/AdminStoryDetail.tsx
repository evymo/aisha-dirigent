/**
 * AdminStoryDetail — rich per-story workspace.
 *
 * Replaces the AdminStoryTimeline build-fix stub. Renders the story
 * payload (via useStoryDetail) inside a tabbed layout:
 *   - Overview     — title, status (live), priority, branch, last activity
 *   - Knowledge    — placeholder (Phase 5)
 *   - Rulesets     — read-only list of story_rulesets bindings
 *   - Bindings     — placeholder (Phase 5)
 *   - Hippocampus  — placeholder (Phase 6)
 *
 * The same surface serves both the stack-default story
 * (`/admin/stack` redirect → here) and user-created stories.
 *
 * Hook-Only Data Access (CLAUDE.md). No direct .from() queries.
 */
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Package } from "lucide-react";

import { useStoryDetail } from "@/hooks/useStoryDetail";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { StoryOverviewTab } from "@/components/admin/story/StoryOverviewTab";
import { StoryTimelineTab } from "@/components/admin/story/StoryTimelineTab";
import { StoryKnowledgeTab } from "@/components/admin/story/StoryKnowledgeTab";
import { StoryRulesetsTab } from "@/components/admin/story/StoryRulesetsTab";
import { StoryBindingsTab } from "@/components/admin/story/StoryBindingsTab";
import { StoryHippocampusTab } from "@/components/admin/story/StoryHippocampusTab";

export default function AdminStoryDetail() {
  const { t } = useTranslation();
  const { id: storyId } = useParams<{ id: string }>();
  const { data: story, isLoading, error } = useStoryDetail({ storyId });

  if (!storyId) {
    return (
      <div className="p-6" data-test="admin-story-detail-missing-id">
        <Alert variant="destructive">
          <AlertDescription>
            {t("storyDetail.missingId", "Missing story id in URL")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" data-test="admin-story-detail-error">
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="p-6" data-test="admin-story-detail-not-found">
        <Alert>
          <AlertDescription>
            {t("storyDetail.notFound", "Story not found.")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Stack-default story gets a special badge so the operator immediately
  // sees they're configuring the AISHA stack itself, not a partner story.
  const isStackDefault = (story as unknown as { is_stack_default?: boolean })
    .is_stack_default === true || story.partner_id === null;

  return (
    <div className="space-y-4 p-6" data-test="admin-story-detail">
      <header className="space-y-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2"
          data-test="story-detail-back"
        >
          <Link to="/admin/stories">
            <ArrowLeft className="mr-1 size-3" aria-hidden="true" />
            {t("storyDetail.backToList", "All stories")}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {isStackDefault ? (
            <Package className="size-6 text-primary" aria-hidden="true" />
          ) : (
            <BookOpen className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
          <h1 className="text-2xl font-semibold">{story.title}</h1>
          {isStackDefault && (
            <Badge variant="default" data-test="story-stack-badge">
              {t("storyDetail.stackBadge", "Stack default")}
            </Badge>
          )}
        </div>

        {story.study_name && (
          <p className="text-sm text-muted-foreground">
            {t("storyDetail.studyLink", "Linked study")}: {story.study_name}
          </p>
        )}
      </header>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-test="tab-trigger-overview">
            {t("storyDetail.tabs.overview", "Overview")}
          </TabsTrigger>
          <TabsTrigger value="timeline" data-test="tab-trigger-timeline">
            {t("storyDetail.tabs.timeline", "Timeline")}
          </TabsTrigger>
          <TabsTrigger value="knowledge" data-test="tab-trigger-knowledge">
            {t("storyDetail.tabs.knowledge", "Knowledge")}
          </TabsTrigger>
          <TabsTrigger value="rulesets" data-test="tab-trigger-rulesets">
            {t("storyDetail.tabs.rulesets", "Rulesets")}
          </TabsTrigger>
          <TabsTrigger value="bindings" data-test="tab-trigger-bindings">
            {t("storyDetail.tabs.bindings", "Bindings")}
          </TabsTrigger>
          <TabsTrigger value="hippocampus" data-test="tab-trigger-hippocampus">
            {t("storyDetail.tabs.hippocampus", "Hippocampus")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" data-test="tab-content-overview">
          <StoryOverviewTab story={story} />
        </TabsContent>
        <TabsContent value="timeline" data-test="tab-content-timeline">
          <StoryTimelineTab storyId={story.id} />
        </TabsContent>
        <TabsContent value="knowledge" data-test="tab-content-knowledge">
          <StoryKnowledgeTab storyId={story.id} />
        </TabsContent>
        <TabsContent value="rulesets" data-test="tab-content-rulesets">
          <StoryRulesetsTab storyId={story.id} />
        </TabsContent>
        <TabsContent value="bindings" data-test="tab-content-bindings">
          <StoryBindingsTab storyId={story.id} />
        </TabsContent>
        <TabsContent value="hippocampus" data-test="tab-content-hippocampus">
          <StoryHippocampusTab storyId={story.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

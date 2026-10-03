/**
 * DiscussionDetail Component
 *
 * Displays a knowledge base discussion thread inside StoryLoop.
 * Shows topic info header, existing posts as timeline entries,
 * and a composer for adding new posts.
 *
 * Mirrors the StoryDetail UX but for community discussion threads.
 *
 * @module components/storyloop/DiscussionDetail
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import {
  MessageSquare,
  Send,
  Loader2,
  Globe,
  ShieldCheck,
  Lock,
  BookOpen,
  Link2,
  FileText,
  ExternalLink,
  ChevronDown,
  Info,
  Bookmark,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  useDiscussionThreadDetail,
  useDiscussionPosts,
  useCreateDiscussionPost,
} from "@/hooks/useStoryLoopDiscussions";
import { formatDistanceToNow, format } from "date-fns";
import type { Locale } from "date-fns";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { useStoryLoopBookmarks } from "@/hooks/useStoryLoopBookmarks";

interface DiscussionDetailProps {
  topicId: string | null;
  /**
   * When true, removes h-full flex constraints so the component
   * can live inside a standard page layout (not full-bleed).
   */
  standalone?: boolean;
}

/**
 * Single discussion post rendered as a timeline entry.
 */
function DiscussionPostEntry({
  post,
  dateLocale,
  isBookmarked,
  isHighlighted,
  onToggleBookmark,
}: {
  post: {
    id: string;
    author_display_name: string | null;
    body: string;
    created_at: string;
    is_translated: boolean;
    original_locale: string;
  };
  dateLocale: Locale;
  isBookmarked: boolean;
  isHighlighted: boolean;
  onToggleBookmark: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "relative border-l-2 border-l-primary/30 py-3 pl-4 sm:py-3.5 sm:pl-5",
        isHighlighted && "rounded-r-md bg-primary/5 ring-1 ring-primary/30"
      )}
      id={`discussion-post-${post.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="text-[10px]">
            {post.author_display_name?.substring(0, 2).toUpperCase() || "??"}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-foreground text-sm">
          {post.author_display_name || t("common.anonymous")}
        </span>
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(post.created_at), {
            addSuffix: true,
            locale: dateLocale,
          })}
        </span>
        {post.is_translated && (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[10px] gap-0.5"
          >
            <Globe className="h-2.5 w-2.5" />
            {t("knowledge.translated")}
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("ml-auto h-6 w-6", isBookmarked && "text-primary")}
          onClick={onToggleBookmark}
          aria-label={t(isBookmarked ? "storyloop.bookmarks.remove" : "storyloop.bookmarks.add")}
        >
          <Bookmark className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")} />
        </Button>
      </div>

      {/* Body */}
      <div className="text-foreground/90 whitespace-pre-wrap text-sm leading-relaxed">
        {post.body}
      </div>
    </div>
  );
}

/**
 * Main discussion detail component for StoryLoop.
 */
export function DiscussionDetail({ topicId, standalone = false }: DiscussionDetailProps) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [postBody, setPostBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isTopicInfoOpen, setIsTopicInfoOpen] = useState(true);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const { toggleBookmark, isBookmarked } = useStoryLoopBookmarks();
  const targetPostId = searchParams.get("post");

  const dateLocale = getDateFnsLocale(i18n.language);

  // Data hooks
  const { data: topic, isLoading: topicLoading } =
    useDiscussionThreadDetail(topicId);
  const {
    data: postsData,
    isLoading: postsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDiscussionPosts(topicId);
  const createPostMutation = useCreateDiscussionPost();

  // Flatten pages
  const posts = useMemo(
    () => postsData?.pages.flatMap((page) => page.posts) ?? [],
    [postsData]
  );

  useEffect(() => {
    if (!targetPostId || posts.length === 0) return;
    const hasTargetPost = posts.some((post) => post.id === targetPostId);
    if (!hasTargetPost) return;

    const timer = window.setTimeout(() => {
      const element = document.getElementById(`discussion-post-${targetPostId}`);
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightedPostId(targetPostId);
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [posts, targetPostId]);

  useEffect(() => {
    if (!highlightedPostId) return;
    const timer = window.setTimeout(() => {
      setHighlightedPostId(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedPostId]);

  const handleCreatePost = useCallback(async () => {
    if (!topicId || !postBody.trim()) return;

    try {
      await createPostMutation.mutateAsync({
        body: postBody.trim(),
        topic_id: topicId,
      });
      setPostBody("");
      toast.success(t("storyloop.discussions.postAdded"));
    } catch (error) {
      safeError("DiscussionDetail.handleCreatePost", error);
      toast.error(t("storyloop.discussions.postError"));
    }
  }, [topicId, postBody, createPostMutation, t]);

  const handleTogglePostBookmark = useCallback(
    (post: { id: string; body: string }) => {
      if (!topicId || !topic) return;
      toggleBookmark({
        threadType: "discussion",
        threadId: topicId,
        entryId: post.id,
        threadTitle: topic.title,
        entryPreview: post.body,
      });
    },
    [toggleBookmark, topic, topicId]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCreatePost();
      }
    },
    [handleCreatePost]
  );

  // No topic selected
  if (!topicId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">{t("storyloop.discussions.selectThread")}</p>
        </div>
      </div>
    );
  }

  // Loading
  if (topicLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Not found
  if (!topic) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center text-muted-foreground">
          <Info className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">{t("knowledge.topic_not_found")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col h-full">
      {/* Topic Header */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("storyloop.threadModes.discussions")}
            </p>
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-5 w-5 shrink-0 text-primary" />
              <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">
                {topic.title}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {topic.visibility === "members" && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                <Lock className="mr-1 h-3 w-3" />
                {t("knowledge.members_only")}
              </Badge>
            )}
            {topic.verification_status === "verified" && (
              <Badge
                variant="outline"
                className="border-green-200 text-green-700 dark:border-green-800 dark:text-green-400"
              >
                <ShieldCheck className="mr-1 h-3 w-3" />
                {t("knowledge.verified")}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {topic.post_count} {t("knowledge.posts")}
            </Badge>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-6">
          {/* Topic Body (collapsible) */}
          {(topic.summary || topic.body_markdown) && (
            <Collapsible open={isTopicInfoOpen} onOpenChange={setIsTopicInfoOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors">
                  <BookOpen className="h-4 w-4 text-primary" />
                  {t("storyloop.discussions.topicInfo")}
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 transition-transform",
                      isTopicInfoOpen && "rotate-180"
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-lg border border-border bg-card p-4 space-y-3">
                  {topic.summary && (
                    <p className="text-sm text-muted-foreground italic border-l-2 border-primary/20 pl-3">
                      {topic.summary}
                    </p>
                  )}
                  {topic.body_markdown && (
                    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {topic.body_markdown}
                      </div>
                    </div>
                  )}

                  {/* Linked resources */}
                  {topic.links && topic.links.length > 0 && (
                    <div className="pt-3 border-t border-border space-y-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        {t("knowledge.linked_resources")}
                      </h4>
                      {topic.links.map((link) => (
                        <div
                          key={link.id}
                          className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            {link.archive_document_id ? (
                              <FileText className="h-4 w-4 text-primary" />
                            ) : (
                              <ExternalLink className="h-4 w-4 text-blue-500" />
                            )}
                            <span>
                              {link.archive_document_id
                                ? t("knowledge.archive_document_link")
                                : t("knowledge.external_link")}
                            </span>
                            {link.is_verified && (
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[10px]"
                              >
                                <ShieldCheck className="mr-0.5 h-2.5 w-2.5" />
                                {t("knowledge.verified_source")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Posts Timeline */}
          <div>
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
              <MessageSquare className="h-3.5 w-3.5" />
              {t("storyloop.discussions.posts")}
            </h3>

            {postsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : posts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm">{t("knowledge.no_posts")}</p>
                <p className="mt-1 text-xs">
                  {t("storyloop.discussions.beFirstToPost")}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {posts.map((post) => (
                  <DiscussionPostEntry
                    key={post.id}
                    post={post}
                    dateLocale={dateLocale}
                    isBookmarked={isBookmarked("discussion", topicId, post.id)}
                    isHighlighted={highlightedPostId === post.id}
                    onToggleBookmark={() => handleTogglePostBookmark(post)}
                  />
                ))}

                {hasNextPage && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {t("common.loadMore")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Composer */}
      {!topic.is_locked && (
        <div className="border-t border-border bg-card p-3">
          <div className="flex gap-2">
            <Textarea
              value={postBody}
              onChange={(e) => setPostBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("storyloop.discussions.composerPlaceholder")}
              className="min-h-[60px] max-h-[160px] resize-y text-sm"
              rows={2}
            />
            <Button
              onClick={handleCreatePost}
              disabled={createPostMutation.isPending || !postBody.trim()}
              size="icon"
              className="h-auto shrink-0"
            >
              {createPostMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("storyloop.composerHint")}
          </p>
        </div>
      )}
    </div>
  );
}

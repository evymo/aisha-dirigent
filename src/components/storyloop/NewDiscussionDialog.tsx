/**
 * New Discussion Dialog
 *
 * Dialog for creating a new knowledge-base discussion topic.
 * Partners can set title, summary, first post and visibility.
 *
 * @module components/storyloop/NewDiscussionDialog
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { useCreateKnowledgeTopic } from "@/hooks/useKnowledgeBase";
import { toast } from "sonner";

export interface NewDiscussionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (topicId: string) => void;
}

/**
 * Generates a URL-safe slug from a title string.
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Dialog for creating a new knowledge discussion topic from StoryLoop.
 */
export function NewDiscussionDialog({
  open,
  onOpenChange,
  onSuccess,
}: NewDiscussionDialogProps) {
  const { t, i18n } = useTranslation();

  // ── State ──────────────────────────────────────────────────────────
  const [topicTitle, setTopicTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [firstPost, setFirstPost] = useState("");
  const [visibility, setVisibility] = useState<"public" | "members">("members");

  const createTopic = useCreateKnowledgeTopic();

  // ── Handlers ───────────────────────────────────────────────────────
  const resetForm = () => {
    setTopicTitle("");
    setSummary("");
    setFirstPost("");
    setVisibility("members");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedTitle = topicTitle.trim();
    if (!trimmedTitle) return;

    const slug = generateSlug(trimmedTitle);
    const titleKey = `kb.topic.${slug}`;
    const summaryKey = summary.trim() ? `kb.topic.${slug}.summary` : undefined;

    try {
      const topicId = await createTopic.mutateAsync({
        slug,
        title_key: titleKey,
        summary_key: summaryKey ?? null,
        visibility,
        initial_locale: i18n.language,
        initial_title: trimmedTitle,
        initial_summary: summary.trim() || undefined,
        initial_body: firstPost.trim() || undefined,
      });

      toast.success(t("storyloop.newDiscussion.success"), {
        description: t("storyloop.newDiscussion.successDescription"),
      });

      resetForm();
      onOpenChange(false);

      if (topicId && typeof topicId === "string") {
        onSuccess?.(topicId);
      }
    } catch {
      toast.error(t("storyloop.newDiscussion.error"), {
        description: t("storyloop.newDiscussion.errorDescription"),
      });
    }
  };

  const canSubmit = topicTitle.trim().length >= 3 && !createTopic.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5" />
            {t("storyloop.newDiscussion.title")}
          </DialogTitle>
          <DialogDescription>
            {t("storyloop.newDiscussion.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Topic Title ─────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="discussion-title">
              {t("storyloop.newDiscussion.topicTitle")}
            </Label>
            <Input
              id="discussion-title"
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              placeholder={t("storyloop.newDiscussion.topicTitlePlaceholder")}
              maxLength={200}
              autoFocus
            />
          </div>

          {/* ── Summary (optional) ──────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="discussion-summary">
              {t("storyloop.newDiscussion.summary")}
            </Label>
            <Textarea
              id="discussion-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t("storyloop.newDiscussion.summaryPlaceholder")}
              rows={2}
              maxLength={500}
            />
          </div>

          {/* ── First Post ──────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="discussion-body">
              {t("storyloop.newDiscussion.firstPost")}
            </Label>
            <Textarea
              id="discussion-body"
              value={firstPost}
              onChange={(e) => setFirstPost(e.target.value)}
              placeholder={t("storyloop.newDiscussion.firstPostPlaceholder")}
              rows={4}
              maxLength={5000}
            />
          </div>

          {/* ── Visibility ──────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="discussion-visibility">
              {t("storyloop.newDiscussion.visibility")}
            </Label>
            <Select
              value={visibility}
              onValueChange={(v) =>
                setVisibility(v as "public" | "members")
              }
            >
              <SelectTrigger id="discussion-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="members">
                  {t("storyloop.newDiscussion.visibilityMembers")}
                </SelectItem>
                <SelectItem value="public">
                  {t("storyloop.newDiscussion.visibilityPublic")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createTopic.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createTopic.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("storyloop.newDiscussion.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

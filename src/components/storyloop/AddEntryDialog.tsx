/**
 * Add Entry Dialog
 *
 * Dialog for quickly adding an entry (block) to an existing member's story
 * without navigating to the story detail view. Partners select a member,
 * pick the story, choose entry type and optionally add a note.
 *
 * @module components/storyloop/AddEntryDialog
 */

import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FilePlus } from "lucide-react";
import { useStories, useCreateStoryEntry } from "@/hooks/useStoryLoop";
import { useMemberAccessSummaries } from "@/hooks/useMemberAccessSummary";
import { toast } from "sonner";
import type { StoryEntryType } from "@/schemas/storyLoopSchemas";

/** Entry types available for quick-add from the list view. */
const ADDABLE_ENTRY_TYPES: StoryEntryType[] = [
  "note",
  "meeting_request",
  "questionnaire_request",
  "consent_request",
  "lab_order",
  "distribution_adjustment",
  "email",
];

export interface AddEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (entryId: string, storyId: string) => void;
}

/**
 * Dialog for adding a new entry to an existing member story.
 */
export function AddEntryDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddEntryDialogProps) {
  const { t } = useTranslation();

  // ── State ──────────────────────────────────────────────────────────
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [selectedStoryId, setSelectedStoryId] = useState<string>("");
  const [selectedEntryType, setSelectedEntryType] = useState<string>("");
  const [content, setContent] = useState("");

  // ── Data ───────────────────────────────────────────────────────────
  const { data: memberSummaries, isLoading: membersLoading } =
    useMemberAccessSummaries();
  const { data: allStories, isLoading: storiesLoading } = useStories(
    { status: null, limit: 200 },
    { enabled: open },
  );
  const createEntry = useCreateStoryEntry();

  // Members with at least limited access
  const members = useMemo(
    () =>
      (memberSummaries ?? []).filter(
        (m) => m.access_level === "full" || m.access_level === "limited",
      ),
    [memberSummaries],
  );

  // Stories belonging to the selected member (active / inbox / in_progress)
  const memberStories = useMemo(() => {
    if (!selectedMemberId || !allStories) return [];
    return allStories.filter(
      (s) =>
        s.user_id === selectedMemberId &&
        (s.status === "inbox" || s.status === "in_progress" || s.status === "scheduled"),
    );
  }, [allStories, selectedMemberId]);

  // Auto-select first story when member changes
  useEffect(() => {
    if (memberStories.length === 1) {
      setSelectedStoryId(memberStories[0].id);
    } else {
      setSelectedStoryId("");
    }
  }, [memberStories]);

  // ── Handlers ───────────────────────────────────────────────────────
  const resetForm = () => {
    setSelectedMemberId("");
    setSelectedStoryId("");
    setSelectedEntryType("");
    setContent("");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedStoryId || !selectedEntryType) return;

    try {
      const entryId = await createEntry.mutateAsync({
        story_id: selectedStoryId,
        entry_type: selectedEntryType as StoryEntryType,
        content: content.trim() || undefined,
        metadata: {},
        is_internal: false,
      });

      toast.success(t("storyloop.addEntry.success"), {
        description: t("storyloop.addEntry.successDescription"),
      });

      resetForm();
      onOpenChange(false);
      onSuccess?.(entryId, selectedStoryId);
    } catch {
      toast.error(t("storyloop.addEntry.error"), {
        description: t("storyloop.addEntry.errorDescription"),
      });
    }
  };

  const canSubmit =
    Boolean(selectedStoryId) &&
    Boolean(selectedEntryType) &&
    !createEntry.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus className="h-5 w-5" />
            {t("storyloop.addEntry.title")}
          </DialogTitle>
          <DialogDescription>
            {t("storyloop.addEntry.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Select Member ───────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="add-entry-member">
              {t("storyloop.addEntry.selectMember")}
            </Label>
            <Select
              value={selectedMemberId}
              onValueChange={(v) => {
                setSelectedMemberId(v);
                setSelectedStoryId("");
              }}
              disabled={membersLoading}
            >
              <SelectTrigger id="add-entry-member">
                <SelectValue
                  placeholder={
                    membersLoading
                      ? t("common.loading")
                      : t("storyloop.addEntry.selectMember")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.member_id} value={m.member_id}>
                    {m.display_name || m.member_token}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Select Story ────────────────────────────────── */}
          {selectedMemberId && (
            <div className="space-y-2">
              <Label htmlFor="add-entry-story">
                {t("storyloop.addEntry.selectStory")}
              </Label>
              {storiesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : memberStories.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t("storyloop.addEntry.noActiveStories")}
                </p>
              ) : (
                <Select
                  value={selectedStoryId}
                  onValueChange={setSelectedStoryId}
                >
                  <SelectTrigger id="add-entry-story">
                    <SelectValue
                      placeholder={t("storyloop.addEntry.selectStory")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {memberStories.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                        {s.study_name ? ` (${s.study_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* ── Entry Type ──────────────────────────────────── */}
          {selectedStoryId && (
            <div className="space-y-2">
              <Label htmlFor="add-entry-type">
                {t("storyloop.addEntry.selectEntryType")}
              </Label>
              <Select
                value={selectedEntryType}
                onValueChange={setSelectedEntryType}
              >
                <SelectTrigger id="add-entry-type">
                  <SelectValue
                    placeholder={t("storyloop.addEntry.selectEntryType")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {ADDABLE_ENTRY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`storyloop.addEntry.entryTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ── Content (optional note) ─────────────────────── */}
          {selectedEntryType && (
            <div className="space-y-2">
              <Label htmlFor="add-entry-content">
                {t("storyloop.addEntry.content")}
              </Label>
              <Textarea
                id="add-entry-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("storyloop.addEntry.contentPlaceholder")}
                rows={3}
                maxLength={2000}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createEntry.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createEntry.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("storyloop.addEntry.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

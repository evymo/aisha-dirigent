/**
 * New Story Dialog
 *
 * Dialog for creating a new story (case) in StoryLoop.
 * Partners select a user and optionally a study.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, BookOpen } from "lucide-react";
import { useCreateStory } from "@/hooks/useStoryLoop";
import { useMemberAccessSummaries } from "@/hooks/useMemberAccessSummary";
import { useMyRegistrations } from "@/hooks/useStudies";
import { useSession } from "@/hooks/useSession";
import { toast } from "sonner";

export interface NewStoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (storyId: string) => void;
  memberSelfMode?: boolean;
}

/**
 * Dialog for creating a new StoryLoop case.
 */
export function NewStoryDialog({
  open,
  onOpenChange,
  onSuccess,
  memberSelfMode = false,
}: NewStoryDialogProps) {
  const { t } = useTranslation();
  const { user } = useSession();

  // State
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");
  const [title, setTitle] = useState("");
  const isMemberSelfFlow = memberSelfMode && Boolean(user?.id);

  // Data - useMemberAccessSummaries returns users with access_level and display_name
  const { data: memberSummaries, isLoading: usersLoading } = useMemberAccessSummaries();
  const { registrations, loading: registrationsLoading } = useMyRegistrations();
  const createStory = useCreateStory();

  // Filter to users with consent (full access)
  const users = useMemo(
    () =>
      (memberSummaries ?? []).filter(
        (m) => m.access_level === "full" || m.access_level === "limited"
      ),
    [memberSummaries]
  );
  const memberActiveStudies = useMemo(() => {
    if (!isMemberSelfFlow) return [];

    const byStudyId = new Map<string, { study_id: string; study_name: string; study_code: string }>();
    registrations
      .filter((registration) => registration.status === "active" || registration.status === "enrolled")
      .forEach((registration) => {
        if (!byStudyId.has(registration.study_id)) {
          byStudyId.set(registration.study_id, {
            study_id: registration.study_id,
            study_name: registration.study_name,
            study_code: registration.study_code,
          });
        }
      });

    return Array.from(byStudyId.values());
  }, [registrations, isMemberSelfFlow]);

  useEffect(() => {
    if (isMemberSelfFlow && memberActiveStudies.length === 1) {
      setSelectedStudyId(memberActiveStudies[0].study_id);
    }
  }, [isMemberSelfFlow, memberActiveStudies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isMemberSelfFlow && !user?.id) {
      toast.error(t("storyloop.newStory.error"), {
        description: t("common.signInRequired"),
      });
      return;
    }

    if (!isMemberSelfFlow && !selectedUserId) {
      toast.error(t("storyloop.newStory.error"), {
        description: t("storyloop.newStory.selectUser"),
      });
      return;
    }

    if (isMemberSelfFlow && !selectedStudyId) {
      toast.error(t("storyloop.newStory.error"), {
        description: t("storyloop.newStory.selectStudy"),
      });
      return;
    }

    try {
      const storyId = await createStory.mutateAsync({
        user_id: isMemberSelfFlow ? user!.id : selectedUserId,
        ...(isMemberSelfFlow ? { study_id: selectedStudyId } : {}),
        title: title.trim() || undefined,
      });

      toast.success(t("storyloop.newStory.success"), {
        description: t("storyloop.newStory.successDescription"),
      });

      // Reset form
      setSelectedUserId("");
      setSelectedStudyId("");
      setTitle("");

      // Close dialog and notify parent
      onOpenChange(false);
      if (storyId && onSuccess) {
        onSuccess(storyId);
      }
    } catch {
      toast.error(t("storyloop.newStory.error"), {
        description: t("storyloop.newStory.errorDescription"),
      });
    }
  };

  const handleClose = () => {
    // Reset form on close
    setSelectedUserId("");
    setSelectedStudyId("");
    setTitle("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {t("storyloop.newStory.title")}
          </DialogTitle>
          <DialogDescription>
            {isMemberSelfFlow
              ? t("storyloop.newStory.memberDescription")
              : t("storyloop.newStory.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isMemberSelfFlow && (
            <div className="space-y-2">
              <Label htmlFor="user">{t("storyloop.newStory.user")}</Label>
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                disabled={usersLoading}
              >
                <SelectTrigger id="user">
                  <SelectValue
                    placeholder={
                      usersLoading
                        ? t("common.loading")
                        : t("storyloop.newStory.selectUser")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.member_id} value={user.member_id}>
                      {user.display_name || user.member_token}
                    </SelectItem>
                  ))}
                  {!usersLoading && users.length === 0 && (
                    <SelectItem value="no-users" disabled>
                      {t("storyloop.newStory.noUsers")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {isMemberSelfFlow && (
            <div className="space-y-2">
              <Label htmlFor="study">{t("storyloop.newStory.study")}</Label>
              <Select
                value={selectedStudyId}
                onValueChange={setSelectedStudyId}
                disabled={registrationsLoading}
              >
                <SelectTrigger id="study">
                  <SelectValue
                    placeholder={
                      registrationsLoading
                        ? t("common.loading")
                        : t("storyloop.newStory.selectStudy")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {memberActiveStudies.map((study) => (
                    <SelectItem key={study.study_id} value={study.study_id}>
                      {study.study_name || study.study_code}
                    </SelectItem>
                  ))}
                  {!registrationsLoading && memberActiveStudies.length === 0 && (
                    <SelectItem value="no-studies" disabled>
                      {t("storyloop.newStory.noEligibleStudies")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Title (optional) */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("storyloop.newStory.storyTitle")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("storyloop.newStory.titlePlaceholder")}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              {t("storyloop.newStory.titleHint")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createStory.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                createStory.isPending ||
                (isMemberSelfFlow ? !selectedStudyId : !selectedUserId)
              }
            >
              {createStory.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("storyloop.newStory.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

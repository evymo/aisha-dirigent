/**
 * StoryKnowledgeTab — Phase 8 functional KB surface.
 *
 * Lists knowledge_items scoped to the story (admin/staff sees all, story
 * participants see their own). Admin can create / edit / archive items
 * inline with a slide-down form (title + body + item_type + category +
 * tags + visibility).
 *
 * Tags are rendered as chips; the editor accepts comma-separated input
 * and trims/dedupes on save. Each mutation writes audit_journal via the
 * audited RPC; UI shows pending state + error banner.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  Plus,
  Tag,
  ShieldCheck,
  ShieldAlert,
  Pencil,
  Trash2,
  Loader2,
  X,
  Save,
  Upload,
  FileText,
} from "lucide-react";

import {
  useStoryKnowledgeItems,
  useUpsertStoryKnowledgeItem,
  useDeleteStoryKnowledgeItem,
  type StoryKnowledgeItem,
} from "@/hooks/useStoryKnowledgeItems";
import {
  useStoryKnowledgeList,
  useStoryKnowledgeUpload,
} from "@/hooks/useStoryKnowledge";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { safeError } from "@/lib/security/safeLogger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface StoryKnowledgeTabProps {
  storyId: string;
}

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  title: string;
  itemType: string;
  category: string;
  tagsText: string;
  bodyMarkdown: string;
  visibility: string;
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  title: "",
  itemType: "engineering_doc",
  category: "",
  tagsText: "",
  bodyMarkdown: "",
  visibility: "public",
};

const ITEM_TYPES = [
  "engineering_doc",
  "domain_doc",
  "playbook",
  "case_study",
  "expert_rule",
  "personality_trait",
  "core_value",
] as const;

function parseTags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length <= 64),
    ),
  );
}

export function StoryKnowledgeTab({ storyId }: StoryKnowledgeTabProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage =
    hasPermission("manage_knowledge") || hasPermission("admin");

  const { data: items = [], isLoading, error } = useStoryKnowledgeItems({
    storyId,
  });
  const upsert = useUpsertStoryKnowledgeItem();
  const remove = useDeleteStoryKnowledgeItem();
  const { data: ragnarokFiles = [] } = useStoryKnowledgeList(storyId);
  const upload = useStoryKnowledgeUpload(storyId);
  const [uploadPending, setUploadPending] = useState(false);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    setUploadPending(true);
    try {
      await upload.mutateAsync({ file });
      e.target.value = ""; // reset input so same file can be re-selected
    } catch (err) {
      safeError("StoryKnowledgeTab.handleFileSelect", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadPending(false);
    }
  }

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      ),
    [items],
  );

  function openCreate() {
    setEditor({ ...EMPTY_EDITOR });
    setErrorMessage(null);
  }

  function openEdit(item: StoryKnowledgeItem) {
    setEditor({
      mode: "edit",
      id: item.id,
      title: item.title,
      itemType: item.item_type,
      category: item.category ?? "",
      tagsText: item.ai_context_tags.join(", "),
      bodyMarkdown: "", // body fetched on save (kept empty in list view)
      visibility: item.visibility,
    });
    setErrorMessage(null);
  }

  async function handleSave() {
    if (!editor) return;
    setErrorMessage(null);
    setPendingId(editor.id ?? "__new__");
    try {
      await upsert.mutateAsync({
        storyId,
        id: editor.id ?? null,
        title: editor.title.trim(),
        bodyMarkdown: editor.bodyMarkdown.trim() || undefined,
        itemType: editor.itemType,
        category: editor.category.trim() || null,
        tags: parseTags(editor.tagsText),
        visibility: editor.visibility,
      });
      setEditor(null);
    } catch (err) {
      safeError("StoryKnowledgeTab.handleSave", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  async function handleArchive(item: StoryKnowledgeItem) {
    setErrorMessage(null);
    setPendingId(item.id);
    try {
      await remove.mutateAsync({ id: item.id });
    } catch (err) {
      safeError("StoryKnowledgeTab.handleArchive", err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3" data-test="story-knowledge-tab">
      {errorMessage && (
        <Alert variant="destructive" data-test="knowledge-mutation-error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {canManage && (
        <Card data-test="knowledge-file-upload">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Upload className="size-4 text-muted-foreground" aria-hidden="true" />
              {t(
                "storyDetail.knowledge.fileUploadTitle",
                "Upload file to Ragnarok KB",
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "storyDetail.knowledge.fileUploadHint",
                "Documents are processed by Ragnarok into chunks + embeddings scoped to this story.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="file"
              accept=".pdf,.txt,.md,.docx,.html"
              onChange={handleFileSelect}
              disabled={uploadPending}
              data-test="knowledge-file-input"
            />
            {uploadPending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                {t("storyDetail.knowledge.uploading", "Uploading…")}
              </div>
            )}
            {ragnarokFiles.length > 0 && (
              <ul
                className="space-y-0.5 text-[11px] text-muted-foreground"
                data-test="knowledge-ragnarok-files"
              >
                {ragnarokFiles.slice(0, 10).map((f) => (
                  <li key={f.kb_id} className="flex items-center gap-1">
                    <FileText className="size-2.5" aria-hidden="true" />
                    {f.filename ?? f.kb_id}
                    {f.size_bytes && (
                      <span>· {Math.round(f.size_bytes / 1024)} KB</span>
                    )}
                  </li>
                ))}
                {ragnarokFiles.length > 10 && (
                  <li>+ {ragnarokFiles.length - 10} more</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && !editor && (
        <Button
          variant="outline"
          size="sm"
          onClick={openCreate}
          data-test="knowledge-create-button"
        >
          <Plus className="mr-1 size-3" aria-hidden="true" />
          {t("storyDetail.knowledge.create", "Add knowledge item")}
        </Button>
      )}

      {editor && canManage && (
        <Card className="border-primary/40" data-test="knowledge-editor">
          <CardHeader>
            <CardTitle className="text-base">
              {editor.mode === "create"
                ? t("storyDetail.knowledge.editorTitleCreate", "New knowledge item")
                : t("storyDetail.knowledge.editorTitleEdit", "Edit knowledge item")}
            </CardTitle>
            <CardDescription>
              {t(
                "storyDetail.knowledge.editorHint",
                "All fields are audited. Body is markdown; tags are stored as ai_context_tags[] for retrieval boost.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="kb-title">
                {t("storyDetail.knowledge.title", "Title")}
              </Label>
              <Input
                id="kb-title"
                value={editor.title}
                onChange={(e) =>
                  setEditor({ ...editor, title: e.target.value })
                }
                placeholder={t(
                  "storyDetail.knowledge.titlePlaceholder",
                  "Short descriptive title",
                )}
                data-test="knowledge-editor-title"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="kb-type">
                  {t("storyDetail.knowledge.itemType", "Type")}
                </Label>
                <select
                  id="kb-type"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editor.itemType}
                  onChange={(e) =>
                    setEditor({ ...editor, itemType: e.target.value })
                  }
                  data-test="knowledge-editor-type"
                >
                  {ITEM_TYPES.map((typ) => (
                    <option key={typ} value={typ}>
                      {typ}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="kb-category">
                  {t("storyDetail.knowledge.category", "Category")}
                </Label>
                <Input
                  id="kb-category"
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value })
                  }
                  placeholder={t(
                    "storyDetail.knowledge.categoryPlaceholder",
                    "e.g. ux, security, deploy",
                  )}
                  data-test="knowledge-editor-category"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="kb-tags">
                {t("storyDetail.knowledge.tags", "Tags (comma separated)")}
              </Label>
              <Input
                id="kb-tags"
                value={editor.tagsText}
                onChange={(e) =>
                  setEditor({ ...editor, tagsText: e.target.value })
                }
                placeholder="frontend, react, typescript"
                data-test="knowledge-editor-tags"
              />
              <div
                className="mt-1.5 flex flex-wrap gap-1"
                data-test="knowledge-editor-tag-preview"
              >
                {parseTags(editor.tagsText).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    <Tag className="mr-0.5 size-2.5" aria-hidden="true" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="kb-body">
                {t("storyDetail.knowledge.body", "Body (markdown)")}
              </Label>
              <Textarea
                id="kb-body"
                value={editor.bodyMarkdown}
                onChange={(e) =>
                  setEditor({ ...editor, bodyMarkdown: e.target.value })
                }
                placeholder={
                  editor.mode === "create"
                    ? t(
                        "storyDetail.knowledge.bodyPlaceholderCreate",
                        "## Heading\n\nFull markdown body that AISHA can retrieve from.",
                      )
                    : t(
                        "storyDetail.knowledge.bodyPlaceholderEdit",
                        "Leave empty to keep existing body; type new content to replace.",
                      )
                }
                rows={editor.mode === "create" ? 10 : 6}
                data-test="knowledge-editor-body"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={pendingId === (editor.id ?? "__new__")}
                data-test="knowledge-editor-save"
              >
                {pendingId === (editor.id ?? "__new__") ? (
                  <Loader2
                    className="mr-1 size-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Save className="mr-1 size-3" aria-hidden="true" />
                )}
                {t("storyDetail.knowledge.save", "Save")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setEditor(null)}
                data-test="knowledge-editor-cancel"
              >
                <X className="mr-1 size-3" aria-hidden="true" />
                {t("storyDetail.knowledge.cancel", "Cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {sortedItems.length === 0 ? (
        <Card data-test="story-knowledge-empty">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t(
              "storyDetail.knowledge.empty",
              "No knowledge items yet. Add one to give AISHA story-specific context to retrieve from.",
            )}
          </CardContent>
        </Card>
      ) : (
        sortedItems.map((item) => (
          <Card
            key={item.id}
            data-test={`knowledge-item-${item.id}`}
            data-quarantine={item.quarantine_status}
            className={cn(
              item.quarantine_status === "quarantined" &&
                "border-destructive/40 bg-destructive/5",
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Database
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {item.title}
                <Badge variant="outline" className="text-[10px] font-normal">
                  {item.item_type}
                </Badge>
                {item.category && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal capitalize"
                  >
                    {item.category}
                  </Badge>
                )}
                {item.is_verified ? (
                  <Badge
                    variant="default"
                    className="text-[10px] font-normal"
                    title={t(
                      "storyDetail.knowledge.verifiedTooltip",
                      "Reviewed and verified",
                    )}
                  >
                    <ShieldCheck className="mr-0.5 size-2.5" aria-hidden="true" />
                    {t("storyDetail.knowledge.verified", "verified")}
                  </Badge>
                ) : item.quarantine_status === "quarantined" ? (
                  <Badge
                    variant="destructive"
                    className="text-[10px] font-normal"
                    title={t(
                      "storyDetail.knowledge.quarantinedTooltip",
                      "Excluded from retrieval until human review",
                    )}
                  >
                    <ShieldAlert
                      className="mr-0.5 size-2.5"
                      aria-hidden="true"
                    />
                    {t("storyDetail.knowledge.quarantined", "quarantined")}
                  </Badge>
                ) : null}
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  v{item.version} ·{" "}
                  {new Date(item.updated_at).toLocaleDateString()}
                </span>
              </CardTitle>
              {item.summary && (
                <CardDescription className="text-xs">
                  {item.summary}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5">
              <div
                className="flex flex-wrap gap-1"
                data-test={`knowledge-tags-${item.id}`}
              >
                {item.ai_context_tags.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("storyDetail.knowledge.noTags", "No tags")}
                  </span>
                ) : (
                  item.ai_context_tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      <Tag className="mr-0.5 size-2.5" aria-hidden="true" />
                      {tag}
                    </Badge>
                  ))
                )}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-1 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => openEdit(item)}
                    disabled={pendingId === item.id}
                    data-test={`knowledge-edit-${item.id}`}
                  >
                    <Pencil className="size-3" aria-hidden="true" />
                    <span className="ml-1">
                      {t("storyDetail.knowledge.edit", "Edit")}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleArchive(item)}
                    disabled={pendingId === item.id}
                    data-test={`knowledge-archive-${item.id}`}
                  >
                    {pendingId === item.id ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3" aria-hidden="true" />
                    )}
                    <span className="ml-1">
                      {t("storyDetail.knowledge.archive", "Archive")}
                    </span>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

/**
 * DiscussionThreadBlock — Runtime block for the discussion under a content node.
 *
 * Renders the threaded discussion (user posts) under a public node (a news
 * article or a web page) and a composer to add one. Backed by the polymorphic
 * story_entries primitive via the useDiscussion hooks; post types come from the
 * template-driven entry-type registry (get_entry_types).
 *
 * Editor placeholder:
 *   `<div data-runtime-block="discussion-thread" data-block-config='{"nodeType":"news_article","nodeId":"…"}'></div>`
 *
 * @module
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Loader2, CornerDownRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { useDiscussionEntries, useEntryTypes, usePostDiscussion } from "@/hooks/useDiscussion";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

export default function DiscussionThreadBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const subjectType = typeof config.nodeType === "string" ? config.nodeType : "";
  const subjectId = typeof config.nodeId === "string" ? config.nodeId : "";
  const limit = typeof config.limit === "number" ? config.limit : 100;

  const { entries, isLoading, error } = useDiscussionEntries(subjectType, subjectId, limit);
  const { types } = useEntryTypes(subjectType);
  const post = usePostDiscussion(subjectType, subjectId);

  // Resolve each entry-type's template-driven name_key (DB-backed translations,
  // namespace 'discussion') to a localized label; fall back to the raw entry_type.
  const typeLabels = useDynamicTranslationsMap(
    types.map((ty) => ty.name_key).filter(Boolean),
    "discussion",
    "en",
  );

  const [content, setContent] = useState("");
  const [entryType, setEntryType] = useState("comment");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  // Not configured in the editor yet — show a hint instead of erroring.
  if (!subjectType || !subjectId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MessagesSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>{t("discussion.unconfigured", "Set this block's node type + id to attach a discussion.")}</p>
      </div>
    );
  }

  const submit = () => {
    if (!content.trim()) return;
    post.mutate(
      { content, entryType, parentId: replyTo },
      {
        onSuccess: () => {
          setContent("");
          setReplyTo(null);
          toast({ title: t("discussion.posted", "Posted") });
        },
        onError: (e) => toast({ title: getUserFacingDataErrorMessage(e), variant: "destructive" }),
      },
    );
  };

  const topLevel = entries.filter((e) => !e.parent_id);
  const repliesOf = (id: string) => entries.filter((e) => e.parent_id === id);
  const typeLabel = (key: string) => {
    const ty = types.find((t) => t.entry_type === key);
    return (ty?.name_key && typeLabels[ty.name_key]) || ty?.entry_type || key;
  };

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="max-w-3xl mx-auto">
        <h3 className="flex items-center gap-2 text-xl font-semibold mb-6">
          <MessagesSquare className="h-5 w-5 text-primary" />
          {t("discussion.title", "Discussion")}
          <span className="text-sm font-normal text-muted-foreground">({entries.length})</span>
        </h3>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-muted-foreground py-6">{t("discussion.signIn", "Sign in to view and join the discussion.")}</p>
        ) : (
          <div className="space-y-4">
            {topLevel.map((e) => (
              <Card key={e.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span className="rounded bg-muted px-1.5 py-0.5">{typeLabel(e.entry_type)}</span>
                    <span>{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{e.content}</p>
                  <button
                    type="button"
                    onClick={() => setReplyTo(replyTo === e.id ? null : e.id)}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    {t("discussion.reply", "Reply")}
                  </button>
                  {repliesOf(e.id).map((r) => (
                    <div key={r.id} className="mt-3 ml-5 border-l pl-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <CornerDownRight className="h-3 w-3" />
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{r.content}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className="mt-6 rounded-lg border p-4">
          {replyTo && (
            <p className="mb-2 text-xs text-muted-foreground">
              {t("discussion.replyingTo", "Replying to a post")} ·{" "}
              <button type="button" className="underline" onClick={() => setReplyTo(null)}>
                {t("discussion.cancel", "cancel")}
              </button>
            </p>
          )}
          <Textarea
            value={content}
            onChange={(ev) => setContent(ev.target.value)}
            placeholder={t("discussion.placeholder", "Share your thoughts…")}
            rows={3}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <select
              value={entryType}
              onChange={(ev) => setEntryType(ev.target.value)}
              className="rounded border bg-background px-2 py-1 text-sm"
              aria-label={t("discussion.type", "Type")}
            >
              {(types.length ? types : [{ entry_type: "comment" }]).map((ty) => (
                <option key={ty.entry_type} value={ty.entry_type}>
                  {typeLabel(ty.entry_type)}
                </option>
              ))}
            </select>
            <Button onClick={submit} disabled={post.isPending || !content.trim()}>
              {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("discussion.submit", "Post")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

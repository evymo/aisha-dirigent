import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    createKnowledgeTopicSchema,
    updateKnowledgeTopicSchema,
    type CreateKnowledgeTopicParams,
    type UpdateKnowledgeTopicParams
} from "@/lib/schemas/knowledgeBaseSchemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useCreateKnowledgeTopic, useUpdateKnowledgeTopic } from "@/hooks/useKnowledgeBase";
import { safeError } from "@/lib/security/safeLogger";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";

interface KnowledgeTopicFormProps {
    mode: "create" | "edit";
    initialData?: {
        id: string;
        slug: string;
        title_key: string;
        summary_key?: string;
        visibility: "public" | "members" | "archived";
        // Current version data
        locale: string;
        title: string;
        summary: string;
        body: string;
    } | null;
    onSuccess?: () => void;
    onCancel?: () => void;
}

export function KnowledgeTopicForm({ mode, initialData, onSuccess, onCancel }: KnowledgeTopicFormProps) {
    const { t, i18n } = useTranslation();
    const createMutation = useCreateKnowledgeTopic();
    const updateMutation = useUpdateKnowledgeTopic();
    const [submitting, setSubmitting] = useState(false);

    // Form definition depends on mode... slightly complex because schemas differ
    // We'll use a combined approach or separate forms. For simplicity, we'll map to a common internal state
    // but validate against specific schemas on submit.

    // Actually, React Hook Form creates strictly typed forms. 
    // Let's use two separate handlers but shared UI if possible.
    // Or just use the Update schema which is superset-ish (but creates needs initial_* fields).

    // Let's blindly use `any` for the form control to share UI, but validate properly.
    // OR construct a bespoke schema for the form that maps to the RPC params.

    interface KnowledgeTopicFormValues {
        slug: string;
        title_key: string;
        summary_key: string;
        visibility: "public" | "members" | "archived";
        locale: string;
        title: string;
        summary: string;
        body: string;
        commit_message: string;
    }

    const form = useForm<KnowledgeTopicFormValues>({
        defaultValues: mode === "edit" && initialData ? {
            slug: initialData.slug,
            title_key: initialData.title_key,
            summary_key: initialData.summary_key || "",
            visibility: initialData.visibility,
            locale: initialData.locale, // current locale
            title: initialData.title,
            summary: initialData.summary,
            body: initialData.body,
            commit_message: "Updated via Admin UI"
        } : {
            slug: "",
            title_key: "",
            summary_key: "",
            visibility: "members" as const,
            locale: getTranslationLocale(i18n.language),
            title: "", // Maps to p_initial_title or p_title
            summary: "",
            body: "",
            commit_message: "Initial version"
        }
    });

    const onSubmit = async (values: KnowledgeTopicFormValues) => {
        setSubmitting(true);
        try {
            if (mode === "create") {
                const params: CreateKnowledgeTopicParams = {
                    slug: values.slug,
                    title_key: values.title_key,
                    summary_key: values.summary_key || null,
                    visibility: values.visibility,
                    initial_locale: values.locale,
                    initial_title: values.title,
                    initial_summary: values.summary,
                    initial_body: values.body
                };
                await createMutation.mutateAsync(params);
            } else if (mode === "edit" && initialData) {
                const params: UpdateKnowledgeTopicParams = {
                    topic_id: initialData.id,
                    slug: values.slug,
                    title_key: values.title_key,
                    summary_key: values.summary_key || undefined,
                    visibility: values.visibility,
                    locale: values.locale,
                    title: values.title,
                    summary: values.summary,
                    body: values.body,
                    commit_message: values.commit_message || "Updated via Admin UI"
                };
                await updateMutation.mutateAsync(params);
            }
            if (onSuccess) onSuccess();
        } catch (error) {
            safeError("KnowledgeTopicForm.submit", error);
            form.setError("root", { message: "Failed to save topic" });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="slug"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Slug</FormLabel>
                                <FormControl>
                                    <Input placeholder="my-topic-slug" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="visibility"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Visibility</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select visibility" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="public">Public</SelectItem>
                                        <SelectItem value="members">Members Only</SelectItem>
                                        <SelectItem value="archived">Archived</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="title_key"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Title Key (i18n)</FormLabel>
                                <FormControl>
                                    <Input placeholder="knowledge.topics.my_topic" {...field} />
                                </FormControl>
                                <FormDescription>Fallback title used if translation missing.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="summary_key"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Summary Key (i18n)</FormLabel>
                                <FormControl>
                                    <Input placeholder="knowledge.topics.my_topic_desc" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="border-t pt-4 mt-4">
                    <h3 className="text-lg font-medium mb-4">Content Version ({form.watch('locale')})</h3>

                    <FormField
                        control={form.control}
                        name="locale"
                        render={({ field }) => (
                            <FormItem className="mb-4">
                                <FormLabel>Language</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select language" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="en">English (en)</SelectItem>
                                        <SelectItem value="cs">Czech (cs)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                            <FormItem className="mb-4">
                                <FormLabel>Localized Title</FormLabel>
                                <FormControl>
                                    <Input placeholder="My Topic Title" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="summary"
                        render={({ field }) => (
                            <FormItem className="mb-4">
                                <FormLabel>Localized Summary</FormLabel>
                                <FormControl>
                                    <Textarea placeholder="Brief description..." {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="body"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Content (Markdown)</FormLabel>
                                <FormControl>
                                    <Textarea
                                        placeholder="# Topic Content..."
                                        className="font-mono min-h-[300px]"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {mode === 'edit' && (
                        <FormField
                            control={form.control}
                            name="commit_message"
                            render={({ field }) => (
                                <FormItem className="mt-4">
                                    <FormLabel>Commit Message (Audit)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="What did you change?" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </div>

                <div className="flex justify-end space-x-2 pt-4">
                    {onCancel && (
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                    )}
                    <Button type="submit" disabled={submitting}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {mode === "create" ? "Create Topic" : "Save Changes"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}

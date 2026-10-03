/**
 * ContributeRule — partner form to create or edit an expert rule.
 *
 * @module pages/partner/ContributeRule
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import { useExpertiseAreas } from "@/hooks/useGuild";
import {
  useCreateExpertRule,
  useUpdateExpertRule,
  usePublishExpertRule,
  useExpertRuleDetail,
} from "@/hooks/useExpertRules";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import {
  ArrowLeft,
  Save,
  Send,
  Bot,
  Tag,
  X,
  BookOpen,
  FileText,
} from "lucide-react";

const CATEGORIES = [
  "coding_standard",
  "architecture_pattern",
  "testing_strategy",
  "devops_pipeline",
  "ux_guideline",
  "api_design",
  "data_modeling",
  "security_practice",
  "performance_optimization",
  "documentation_standard",
  "project_management",
  "ai_prompt_engineering",
  "domain_knowledge",
  "integration_pattern",
  "other",
] as const;

const VISIBILITY_OPTIONS = ["guild", "public", "members"] as const;

const ruleFormSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().min(3).max(200).regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers & hyphens"),
  summary: z.string().max(500).optional(),
  body_markdown: z.string().min(10, "Content must be at least 10 characters"),
  category: z.enum(CATEGORIES),
  expertise_area_slug: z.string().optional().or(z.literal("")),
  visibility: z.enum(VISIBILITY_OPTIONS),
  ai_instructions: z.string().max(5000).optional(),
  ai_context_tags_input: z.string().optional(),
});

type RuleFormData = z.infer<typeof ruleFormSchema>;

export default function ContributeRule() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ruleSlug } = useParams<{ ruleSlug: string }>();
  const { user, isLoading: authLoading } = useSession();

  const isEditing = Boolean(ruleSlug);
  const { data: existingRule, isLoading: ruleLoading } = useExpertRuleDetail(
    isEditing ? ruleSlug : undefined
  );

  const { data: expertiseAreas } = useExpertiseAreas();
  const createMutation = useCreateExpertRule();
  const updateMutation = useUpdateExpertRule();
  const publishMutation = usePublishExpertRule();

  const [contextTags, setContextTags] = useState<string[]>([]);

  const form = useForm<RuleFormData>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      title: "",
      slug: "",
      summary: "",
      body_markdown: "",
      category: "other",
      expertise_area_slug: "",
      visibility: "guild",
      ai_instructions: "",
      ai_context_tags_input: "",
    },
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (existingRule && isEditing) {
      form.reset({
        title: existingRule.title,
        slug: existingRule.slug,
        summary: existingRule.summary ?? "",
        body_markdown: existingRule.body_markdown ?? "",
        category: existingRule.category as RuleFormData["category"],
        expertise_area_slug: existingRule.expertise_area_slug ?? "",
        visibility: (existingRule.visibility ?? "guild") as RuleFormData["visibility"],
        ai_instructions: existingRule.ai_instructions ?? "",
        ai_context_tags_input: "",
      });
      setContextTags(existingRule.ai_context_tags ?? []);
    }
  }, [existingRule, isEditing, form]);

  /* Auto-generate slug from title */
  const watchTitle = form.watch("title");
  useEffect(() => {
    if (!isEditing) {
      const slug = watchTitle
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .slice(0, 200);
      form.setValue("slug", slug, { shouldValidate: true });
    }
  }, [watchTitle, isEditing, form]);

  /* Tag management */
  const addTag = () => {
    const input = form.getValues("ai_context_tags_input")?.trim();
    if (input && !contextTags.includes(input)) {
      setContextTags((prev) => [...prev, input]);
      form.setValue("ai_context_tags_input", "");
    }
  };

  const removeTag = (tag: string) => {
    setContextTags((prev) => prev.filter((t) => t !== tag));
  };

  const onSubmit = async (data: RuleFormData) => {
    try {
      const params = {
        p_title: data.title,
        p_slug: data.slug,
        p_summary: data.summary || undefined,
        p_body_markdown: data.body_markdown,
        p_category: data.category,
        p_expertise_area_slug: data.expertise_area_slug || undefined,
        p_visibility: data.visibility,
        p_ai_instructions: data.ai_instructions || undefined,
        p_ai_context_tags: contextTags.length > 0 ? contextTags : undefined,
      };

      if (isEditing && existingRule) {
        await updateMutation.mutateAsync({
          p_rule_id: existingRule.id,
          ...params,
        });
        toast.success(t("guild.contribute.updateSuccess"));
      } else {
        await createMutation.mutateAsync(params);
        toast.success(t("guild.contribute.createSuccess"));
      }

      navigate("/partner/rules");
    } catch (error) {
      safeError("Error saving rule", error);
      toast.error(t("guild.contribute.saveError"));
    }
  };

  const handlePublish = async () => {
    if (!existingRule) return;
    try {
      await publishMutation.mutateAsync(existingRule.id);
      toast.success(t("guild.contribute.publishSuccess"));
      navigate(`/rules/${existingRule.slug}`);
    } catch (error) {
      safeError("Error publishing rule", error);
      toast.error(t("guild.contribute.publishError"));
    }
  };

  if (authLoading || (isEditing && ruleLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          {/* Title row */}
          <div className="flex items-center gap-4 mb-8">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/partner/rules">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {isEditing
                  ? t("guild.contribute.editTitle")
                  : t("guild.contribute.createTitle")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("guild.contribute.subtitle")}
              </p>
            </div>
            {isEditing && existingRule?.status === "draft" && (
              <Button
                onClick={handlePublish}
                disabled={publishMutation.isPending}
                variant="default"
              >
                <Send className="h-4 w-4 mr-2" />
                {t("guild.contribute.publish")}
              </Button>
            )}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    {t("guild.contribute.basicInfo")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contribute.titleLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("guild.contribute.titlePlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contribute.slugLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("guild.contribute.slugPlaceholder")}
                            {...field}
                            disabled={isEditing}
                          />
                        </FormControl>
                        <FormDescription>{t("guild.contribute.slugHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="summary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contribute.summaryLabel")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder={t("guild.contribute.summaryPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("guild.contribute.categoryLabel")}</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {CATEGORIES.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {t(`guild.category.${cat}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="expertise_area_slug"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("guild.contribute.expertiseLabel")}</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value || undefined}
                            value={field.value || undefined}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t("guild.contribute.selectExpertise")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(expertiseAreas ?? []).map((area) => (
                                <SelectItem key={area.id} value={area.slug}>
                                  {area.icon} {t(area.name_key)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="visibility"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contribute.visibilityLabel")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {VISIBILITY_OPTIONS.map((v) => (
                              <SelectItem key={v} value={v}>
                                {t(`guild.visibility.${v}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Content */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {t("guild.contribute.contentTitle")}
                  </CardTitle>
                  <CardDescription>{t("guild.contribute.contentDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="body_markdown"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            rows={16}
                            className="font-mono text-sm"
                            placeholder={t("guild.contribute.bodyPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{t("guild.contribute.markdownHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* AI config */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    {t("guild.contribute.aiTitle")}
                  </CardTitle>
                  <CardDescription>{t("guild.contribute.aiDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="ai_instructions"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contribute.aiInstructionsLabel")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={6}
                            className="font-mono text-sm"
                            placeholder={t("guild.contribute.aiInstructionsPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("guild.contribute.aiInstructionsHint")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Context tags */}
                  <div>
                    <FormField
                      control={form.control}
                      name="ai_context_tags_input"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Tag className="h-4 w-4" />
                            {t("guild.contribute.contextTagsLabel")}
                          </FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                placeholder={t("guild.contribute.addTagPlaceholder")}
                                {...field}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addTag();
                                  }
                                }}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={addTag}
                            >
                              {t("common.add")}
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {contextTags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {contextTags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="font-mono text-xs cursor-pointer"
                            onClick={() => removeTag(tag)}
                          >
                            {tag}
                            <X className="h-3 w-3 ml-1" />
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Submit */}
              <div className="flex items-center justify-end gap-3">
                <Button type="button" variant="outline" asChild>
                  <Link to="/partner/rules">{t("common.cancel")}</Link>
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isEditing ? t("common.save") : t("guild.contribute.create")}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </main>

      <Footer />
    </div>
  );
}

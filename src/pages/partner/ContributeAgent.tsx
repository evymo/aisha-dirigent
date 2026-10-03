/**
 * ContributeAgent — partner form to author or edit a declarative run-as-story
 * agent, then submit it for AISHA compliance review.
 *
 * The partner-publish counterpart of ContributeRule. On save it assembles the
 * agent manifest ({ id, version, kind:'agent', name, description, capabilities,
 * agent_spec, lifecycle }) and calls submit_plugin (declarative → no artifact);
 * a submitted agent can then be sent for review via publish_agent. Editing
 * preserves agent_spec keys the form does not surface (knowledge_items,
 * model_overrides, …). i18n under guild.contributeAgent.*.
 *
 * @module pages/partner/ContributeAgent
 */

import { useEffect, useState, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import { useMyAgent, useSubmitAgent, usePublishAgent } from "@/hooks/usePartnerAgents";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { ArrowLeft, Save, Send, Bot, Sparkles, Wrench, BookOpen, Tag, X } from "lucide-react";

/** The default capability for a declarative marketplace agent. */
const DEFAULT_CAPABILITY = "agent.run_as_story";
/** Declarative agents run hot (no code artifact to cold-load). */
const LOAD_STRATEGY = "hot";

const agentFormSchema = z.object({
  name: z.string().min(3).max(200),
  slug: z.string().min(3).max(200).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers & hyphens only"),
  description: z.string().max(1000).optional(),
  version: z.string().min(1).max(40).regex(/^[0-9A-Za-z.+-]+$/, "letters, numbers, . + - only"),
  purpose: z.string().max(2000).optional(),
  system_prompt: z.string().max(20000).optional(),
  default_model: z.string().max(120).optional(),
  max_loops: z.string().regex(/^\d*$/, "digits only").max(6).optional(),
});

type AgentFormData = z.infer<typeof agentFormSchema>;

/** Reusable chip editor for the three string-array spec fields. */
function TagInput({
  icon,
  label,
  placeholder,
  addLabel,
  tags,
  onAdd,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  placeholder: string;
  addLabel: string;
  tags: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const commit = () => {
    const v = value.trim();
    if (v) {
      onAdd(v);
      setValue("");
    }
  };
  return (
    <div>
      <FormLabel className="flex items-center gap-2 mb-2">
        {icon}
        {label}
      </FormLabel>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={commit}>
          {addLabel}
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="font-mono text-xs cursor-pointer"
              onClick={() => onRemove(tag)}
            >
              {tag}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContributeAgent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const { user, isLoading: authLoading } = useSession();

  const isEditing = Boolean(agentSlug);
  const { data: existingAgent, isLoading: agentLoading } = useMyAgent(isEditing ? agentSlug : undefined);

  const submitMutation = useSubmitAgent();
  const publishMutation = usePublishAgent();

  const [capabilities, setCapabilities] = useState<string[]>([DEFAULT_CAPABILITY]);
  const [ruleSlugs, setRuleSlugs] = useState<string[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);

  const form = useForm<AgentFormData>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      version: "1.0.0",
      purpose: "",
      system_prompt: "",
      default_model: "",
      max_loops: "",
    },
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (existingAgent && isEditing) {
      const spec = existingAgent.agent_spec ?? {};
      form.reset({
        name: existingAgent.name ?? "",
        slug: existingAgent.slug,
        description: existingAgent.description ?? "",
        version: spec.version ?? "1.0.0",
        purpose: spec.purpose ?? "",
        system_prompt: spec.system_prompt ?? "",
        default_model: spec.default_model ?? "",
        max_loops: spec.max_loops != null ? String(spec.max_loops) : "",
      });
      setCapabilities(existingAgent.capabilities.length ? existingAgent.capabilities : [DEFAULT_CAPABILITY]);
      setRuleSlugs(spec.rule_slugs ?? []);
      setAllowedTools(spec.allowed_tools ?? []);
    }
  }, [existingAgent, isEditing, form]);

  /* Auto-generate slug from name (create mode only) */
  const watchName = form.watch("name");
  useEffect(() => {
    if (!isEditing) {
      const slug = watchName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .slice(0, 200);
      form.setValue("slug", slug, { shouldValidate: true });
    }
  }, [watchName, isEditing, form]);

  const addUnique = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((prev) => (prev.includes(value) ? prev : [...prev, value]));
  const removeFrom = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((prev) => prev.filter((v) => v !== value));

  const onSubmit = async (data: AgentFormData) => {
    try {
      // Preserve agent_spec keys the form does not surface, then override the
      // managed ones with the form's values (undefined → dropped from the json).
      const agent_spec: Record<string, unknown> = {
        ...(existingAgent?.agent_spec ?? {}),
        version: data.version,
        purpose: data.purpose?.trim() || undefined,
        system_prompt: data.system_prompt?.trim() || undefined,
        default_model: data.default_model?.trim() || undefined,
        rule_slugs: ruleSlugs.length ? ruleSlugs : undefined,
        allowed_tools: allowedTools.length ? allowedTools : undefined,
        max_loops: data.max_loops?.trim() ? Number(data.max_loops) : undefined,
      };

      const manifest = {
        id: data.slug,
        version: data.version,
        kind: "agent",
        name: data.name,
        description: data.description?.trim() || null,
        capabilities: capabilities.length ? capabilities : [DEFAULT_CAPABILITY],
        lifecycle: { load_strategy: LOAD_STRATEGY },
        agent_spec,
      };

      await submitMutation.mutateAsync({ manifest });
      toast.success(t("guild.contributeAgent.saveSuccess"));
      navigate("/partner/agents");
    } catch (error) {
      safeError("Error saving agent", error);
      toast.error(t("guild.contributeAgent.saveError"));
    }
  };

  const handlePublish = async () => {
    if (!existingAgent) return;
    try {
      await publishMutation.mutateAsync(existingAgent.id);
      toast.success(t("guild.contributeAgent.publishSuccess"));
      navigate("/partner/agents");
    } catch (error) {
      safeError("Error publishing agent", error);
      toast.error(t("guild.contributeAgent.publishError"));
    }
  };

  if (authLoading || (isEditing && agentLoading)) {
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
              <Link to="/partner/agents">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {isEditing
                  ? t("guild.contributeAgent.editTitle")
                  : t("guild.contributeAgent.createTitle")}
              </h1>
              <p className="text-muted-foreground mt-1">{t("guild.contributeAgent.subtitle")}</p>
            </div>
            {isEditing && existingAgent?.status === "submitted" && (
              <Button onClick={handlePublish} disabled={publishMutation.isPending} variant="default">
                <Send className="h-4 w-4 mr-2" />
                {t("guild.contributeAgent.publish")}
              </Button>
            )}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Identity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    {t("guild.contributeAgent.identityTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contributeAgent.nameLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("guild.contributeAgent.namePlaceholder")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="slug"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>{t("guild.contributeAgent.slugLabel")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("guild.contributeAgent.slugPlaceholder")}
                              {...field}
                              disabled={isEditing}
                            />
                          </FormControl>
                          <FormDescription>{t("guild.contributeAgent.slugHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="version"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("guild.contributeAgent.versionLabel")}</FormLabel>
                          <FormControl>
                            <Input className="font-mono" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contributeAgent.descriptionLabel")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder={t("guild.contributeAgent.descriptionPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{t("guild.contributeAgent.descriptionHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <TagInput
                    icon={<Sparkles className="h-4 w-4" />}
                    label={t("guild.contributeAgent.capabilitiesLabel")}
                    placeholder={t("guild.contributeAgent.capabilitiesPlaceholder")}
                    addLabel={t("common.add")}
                    tags={capabilities}
                    onAdd={addUnique(setCapabilities)}
                    onRemove={removeFrom(setCapabilities)}
                  />
                </CardContent>
              </Card>

              {/* Behaviour */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    {t("guild.contributeAgent.behaviourTitle")}
                  </CardTitle>
                  <CardDescription>{t("guild.contributeAgent.behaviourDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="purpose"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contributeAgent.purposeLabel")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            placeholder={t("guild.contributeAgent.purposePlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="system_prompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("guild.contributeAgent.systemPromptLabel")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={10}
                            className="font-mono text-sm"
                            placeholder={t("guild.contributeAgent.systemPromptPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{t("guild.contributeAgent.systemPromptHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <TagInput
                    icon={<Tag className="h-4 w-4" />}
                    label={t("guild.contributeAgent.ruleSlugsLabel")}
                    placeholder={t("guild.contributeAgent.ruleSlugsPlaceholder")}
                    addLabel={t("common.add")}
                    tags={ruleSlugs}
                    onAdd={addUnique(setRuleSlugs)}
                    onRemove={removeFrom(setRuleSlugs)}
                  />
                </CardContent>
              </Card>

              {/* Runtime / governance */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5" />
                    {t("guild.contributeAgent.runtimeTitle")}
                  </CardTitle>
                  <CardDescription>{t("guild.contributeAgent.runtimeDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="default_model"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("guild.contributeAgent.defaultModelLabel")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("guild.contributeAgent.defaultModelPlaceholder")}
                              className="font-mono text-sm"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>{t("guild.contributeAgent.defaultModelHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="max_loops"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("guild.contributeAgent.maxLoopsLabel")}</FormLabel>
                          <FormControl>
                            <Input inputMode="numeric" {...field} />
                          </FormControl>
                          <FormDescription>{t("guild.contributeAgent.maxLoopsHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <TagInput
                    icon={<Wrench className="h-4 w-4" />}
                    label={t("guild.contributeAgent.allowedToolsLabel")}
                    placeholder={t("guild.contributeAgent.allowedToolsPlaceholder")}
                    addLabel={t("common.add")}
                    tags={allowedTools}
                    onAdd={addUnique(setAllowedTools)}
                    onRemove={removeFrom(setAllowedTools)}
                  />
                </CardContent>
              </Card>

              {/* Submit */}
              <div className="flex items-center justify-end gap-3">
                <Button type="button" variant="outline" asChild>
                  <Link to="/partner/agents">{t("common.cancel")}</Link>
                </Button>
                <Button type="submit" disabled={submitMutation.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  {isEditing ? t("common.save") : t("guild.contributeAgent.create")}
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

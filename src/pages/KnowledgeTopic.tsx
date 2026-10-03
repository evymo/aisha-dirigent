import { useParams, Link } from "react-router-dom";
import { getDateFnsLocale, getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    ArrowLeft,
    Calendar,
    Globe,
    Loader2,
    ShieldCheck,
    Lock,
    MessageSquare,
    Send,
    Link2,
    FileText,
    ExternalLink,
    Info,
    Package,
    ShoppingBag,
} from "lucide-react";
import { useState } from "react";
import { useKnowledgeTopic, useKnowledgeTopicPosts, useCreateKnowledgePost } from "@/hooks/useKnowledgeBase";
import { formatDistanceToNow } from "date-fns";
import { safeError } from "@/lib/security/safeLogger";

export default function KnowledgeTopic() {
    const { slug } = useParams<{ slug: string }>();
    const { t, i18n } = useTranslation();
    const [postBody, setPostBody] = useState("");

    const locale = getTranslationLocale(i18n.language);

    // Data Fetching
    const { data: topic, isLoading: topicLoading, error: topicError } = useKnowledgeTopic(slug || "", locale);
    const {
        data: postsData,
        isLoading: postsLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useKnowledgeTopicPosts(topic?.id ?? "", locale);
    const createPostMutation = useCreateKnowledgePost();

    // Flatten infinite query pages into a single array
    const posts = postsData?.pages.flatMap((page) => page.posts) ?? [];

    const handleCreatePost = async () => {
        if (!topic || !postBody.trim()) return;

        try {
            await createPostMutation.mutateAsync({
                body: postBody,
                topic_id: topic.id,
            });
            setPostBody("");
        } catch (error) {
            safeError("KnowledgeTopic.handleCreatePost", error);
        }
    };

    const currentLocale = getDateFnsLocale(i18n.language);

    if (topicLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <div className="flex items-center justify-center py-32">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <Footer />
            </div>
        );
    }

    if (topicError || !topic) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <div className="container mx-auto px-4 py-32 text-center">
                    <Info className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <h1 className="font-serif text-2xl font-bold mb-2">{t('knowledge.topic_not_found')}</h1>
                    <p className="text-muted-foreground mb-6">{t('knowledge.topic_not_found_desc')}</p>
                    <Button asChild>
                        <Link to="/knowledge">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            {t('knowledge.back_to_index')}
                        </Link>
                    </Button>
                </div>
                <Footer />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            {/* Breadcrumb */}
            <div className="border-b border-border bg-card">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Link to="/knowledge" className="hover:text-foreground transition-colors">
                            {t('knowledge.breadcrumb_root')}
                        </Link>
                        <span>/</span>
                        <span className="text-foreground truncate max-w-[300px]">{topic.title}</span>
                    </nav>
                </div>
            </div>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                    {/* Left Column: Content */}
                    <div className="lg:col-span-2 space-y-8">

                        {/* Header */}
                        <div>
                            <div className="flex flex-wrap items-center gap-3 mb-4">
                                {topic.visibility === 'members' && (
                                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                        <Lock className="h-3 w-3 mr-1" />
                                        {t('knowledge.members_only')}
                                    </Badge>
                                )}
                                {topic.verification_status === 'verified' && (
                                    <Badge variant="outline" className="border-green-200 text-green-700 dark:border-green-800 dark:text-green-400">
                                        <ShieldCheck className="h-3 w-3 mr-1" />
                                        {t('knowledge.verified')}
                                    </Badge>
                                )}
                                <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                                    <Globe className="h-3 w-3 mr-1" />
                                    {topic.source_locale.toUpperCase()}
                                </Badge>
                            </div>

                            <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-6">
                                {topic.title}
                            </h1>

                            {topic.summary && (
                                <p className="text-xl text-muted-foreground leading-relaxed mb-8 border-l-4 border-primary/20 pl-4 italic">
                                    {topic.summary}
                                </p>
                            )}

                            {/* Body Content */}
                            <div className="prose prose-neutral dark:prose-invert max-w-none">
                                <div className="whitespace-pre-wrap leading-relaxed text-foreground/90">
                                    {topic.body_markdown || t('knowledge.no_content')}
                                </div>
                            </div>
                        </div>

                        {/* Linked Documents & Resources */}
                        {topic.links && topic.links.length > 0 && (
                            <div className="pt-8 border-t border-border">
                                <h2 className="font-serif text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Link2 className="h-5 w-5" />
                                    {t('knowledge.linked_resources')}
                                </h2>
                                <div className="grid gap-3">
                                    {topic.links.map((link) => (
                                        <div key={link.id} className="group bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                {link.product_id ? (
                                                    <ShoppingBag className="h-5 w-5 text-emerald-600" />
                                                ) : link.production_batch_id ? (
                                                    <Package className="h-5 w-5 text-violet-600" />
                                                ) : link.archive_document_id ? (
                                                    <FileText className="h-5 w-5 text-primary" />
                                                ) : (
                                                    <ExternalLink className="h-5 w-5 text-blue-500" />
                                                )}
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-foreground">
                                                        {link.product_id
                                                            ? t('knowledge.product_link')
                                                            : link.production_batch_id
                                                                ? t('knowledge.batch_link')
                                                                : link.archive_document_id
                                                                    ? t('knowledge.archive_document_link')
                                                                    : t('knowledge.external_link')}
                                                    </span>
                                                    {link.is_verified && (
                                                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                                                            <ShieldCheck className="h-3 w-3" />
                                                            {t('knowledge.verified_source')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {link.product_id ? (
                                                <Button variant="ghost" size="sm" asChild>
                                                    <Link to={`/shop`}>
                                                        {t('knowledge.transparency.viewProduct')}
                                                    </Link>
                                                </Button>
                                            ) : link.production_batch_id ? (
                                                <Badge variant="outline" className="border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-400 gap-1">
                                                    <Package className="h-3 w-3" />
                                                    {t('knowledge.batch_link')}
                                                </Badge>
                                            ) : link.archive_document_id ? (
                                                <Button variant="ghost" size="sm" asChild>
                                                    <Link to={`/archive/${link.archive_document_id}`}>
                                                        {t('common.view')}
                                                    </Link>
                                                </Button>
                                            ) : link.external_url ? (
                                                <Button variant="ghost" size="sm" asChild>
                                                    <a href={link.external_url} target="_blank" rel="noopener noreferrer">
                                                        {t('common.open')}
                                                        <ExternalLink className="h-3 w-3 ml-1" />
                                                    </a>
                                                </Button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Discussion Section */}
                        <div className="pt-12 mt-12 border-t border-border">
                            <div className="flex items-center justify-between mb-8">
                                <h2 className="font-serif text-2xl font-bold text-foreground flex items-center gap-2">
                                    <MessageSquare className="h-6 w-6" />
                                    {t('knowledge.discussion')}
                                </h2>
                                <Badge variant="secondary">{topic.post_count} {t('knowledge.posts_count')}</Badge>
                            </div>

                            {/* Post Composer */}
                            <div className="bg-card border border-border rounded-xl p-6 mb-8 shadow-sm">
                                <Textarea
                                    placeholder={t('knowledge.post_placeholder')}
                                    className="min-h-[100px] mb-4 resize-y"
                                    value={postBody}
                                    onChange={(e) => setPostBody(e.target.value)}
                                />
                                <div className="flex justify-between items-center">
                                    <p className="text-xs text-muted-foreground">
                                        {t('knowledge.post_guidelines')}
                                    </p>
                                    <Button
                                        onClick={handleCreatePost}
                                        disabled={createPostMutation.isPending || !postBody.trim()}
                                    >
                                        {createPostMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                        <Send className="h-4 w-4 mr-2" />
                                        {t('knowledge.post_submit')}
                                    </Button>
                                </div>
                            </div>

                            {/* Post List */}
                            <div className="space-y-6">
                                {postsLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : posts.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p>{t('knowledge.no_posts')}</p>
                                    </div>
                                ) : (
                                    posts.map((post) => (
                                        <div key={post.id} className="bg-card/50 border border-border/50 rounded-xl p-6">
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarFallback>{post.author_display_name?.substring(0, 2).toUpperCase() || "??"}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <div className="font-medium text-sm text-foreground">
                                                            {post.author_display_name || t('common.anonymous')}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                                                            <span>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: currentLocale })}</span>
                                                            {post.is_translated && (
                                                                <Badge variant="outline" className="h-4 px-1 text-[10px] gap-0.5">
                                                                    <Globe className="h-2.5 w-2.5" />
                                                                    {t('knowledge.translated')}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-foreground/90 whitespace-pre-wrap text-sm leading-relaxed">
                                                {post.body}
                                            </div>
                                        </div>
                                    ))
                                )}
                                {hasNextPage && (
                                    <div className="flex justify-center pt-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fetchNextPage()}
                                            disabled={isFetchingNextPage}
                                        >
                                            {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                            {t('common.loadMore')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Sidebar (Optional for MVP - minimal content for now) */}
                    <div className="space-y-6">
                        <div className="bg-muted/30 border border-border rounded-xl p-6">
                            <h3 className="font-semibold text-foreground mb-4">{t('knowledge.about_this_topic')}</h3>
                            <dl className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">{t('common.created')}</dt>
                                    <dd>{new Date(topic.created_at).toLocaleDateString()}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">{t('common.updated')}</dt>
                                    <dd>{new Date(topic.updated_at).toLocaleDateString()}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-muted-foreground">{t('common.status')}</dt>
                                    <dd className="capitalize">{topic.verification_status}</dd>
                                </div>
                            </dl>
                        </div>

                        <Button variant="outline" className="w-full" asChild>
                            <Link to="/knowledge">
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                {t('knowledge.back_to_index')}
                            </Link>
                        </Button>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}

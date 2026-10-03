import { Link, useSearchParams } from "react-router-dom";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Search,
    Filter,
    BookOpen,
    MessageSquare,
    ShieldCheck,
    Lock,
    Globe,
    Loader2,
    X,
    Eye
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useKnowledgeTopics } from "@/hooks/useKnowledgeBase";
import { cn } from "@/lib/utils";

// Visibility filter values accepted by useKnowledgeTopics.
type KnowledgeVisibility = "public" | "members" | "archived";

const isKnownVisibility = (value: string): value is KnowledgeVisibility =>
    value === "public" || value === "members" || value === "archived";

export default function Knowledge() {
    const { t, i18n } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();

    // State
    const [searchQuery, setSearchQuery] = useState("");
    const [visibility, setVisibility] = useState<KnowledgeVisibility | null>(null);

    // URL Sync Refs
    const hasProcessedUrlParamsRef = useRef(false);
    const lastProcessedUrlSignatureRef = useRef<string | null>(null);

    const locale = getTranslationLocale(i18n.language);

    // Data Fetching
    const { data: topics = [], isLoading: loading } = useKnowledgeTopics({
        locale,
        search: searchQuery || undefined,
        visibility: visibility || undefined,
    });

    // 1. Initialize state from URL on mount
    useEffect(() => {
        const urlSignature = searchParams.toString();
        if (lastProcessedUrlSignatureRef.current === urlSignature) return;

        const queryFromUrl = searchParams.get("q");
        const visibilityFromUrl = searchParams.get("visibility");

        const nextSearchQuery = queryFromUrl ?? "";
        const nextVisibility = visibilityFromUrl && isKnownVisibility(visibilityFromUrl)
            ? visibilityFromUrl
            : null;

        setSearchQuery((prev) => (prev === nextSearchQuery ? prev : nextSearchQuery));
        setVisibility((prev) => (prev === nextVisibility ? prev : nextVisibility));

        lastProcessedUrlSignatureRef.current = urlSignature;
        hasProcessedUrlParamsRef.current = true;
    }, [searchParams]);

    // 2. Sync state changes to URL
    useEffect(() => {
        if (!hasProcessedUrlParamsRef.current) return;

        const nextParams = new URLSearchParams(searchParams);

        if (searchQuery) nextParams.set("q", searchQuery);
        else nextParams.delete("q");

        if (visibility) nextParams.set("visibility", visibility);
        else nextParams.delete("visibility");

        const nextSignature = nextParams.toString();
        if (nextSignature === searchParams.toString()) return;

        lastProcessedUrlSignatureRef.current = nextSignature;
        setSearchParams(nextParams, { replace: true });
    }, [searchQuery, visibility, searchParams, setSearchParams]);

    const clearAllFilters = () => {
        setSearchQuery("");
        setVisibility(null);
    };

    const hasActiveFilters = Boolean(searchQuery || visibility);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Header />

            {/* Hero Section */}
            <section className="pt-32 pb-16 bg-card border-b border-border">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-3xl">
                        <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
                            {t('knowledge.sectionLabel')}
                        </span>
                        <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
                            {t('knowledge.title')}
                        </h1>
                        <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                            {t('knowledge.subtitle')}
                        </p>
                    </div>
                </div>
            </section>

            {/* Filters & Search */}
            <section className="py-4 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col sm:flex-row gap-4">

                        {/* Search */}
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t('knowledge.search_placeholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>

                        {/* Visibility Filter (Optional - maybe only for members/admins?) */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Filter className="h-4 w-4" />
                                <span className="text-sm hidden sm:inline">{t('common.filter')}</span>
                            </div>

                            <Select
                                value={visibility || "all"}
                                onValueChange={(v) => setVisibility(v !== "all" && isKnownVisibility(v) ? v : null)}
                            >
                                <SelectTrigger className="w-[160px]">
                                    <SelectValue placeholder={t('knowledge.all_visibilities')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('knowledge.all_visibilities')}</SelectItem>
                                    <SelectItem value="public">{t('knowledge.visibility.public')}</SelectItem>
                                    <SelectItem value="members">{t('knowledge.visibility.members')}</SelectItem>
                                </SelectContent>
                            </Select>

                            {hasActiveFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearAllFilters}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-4 w-4 mr-1" />
                                    {t('common.clearAll')}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* Content Grid */}
            <section className="py-16 flex-1">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : topics.length === 0 ? (
                        <div className="text-center py-16">
                            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="font-serif text-xl font-semibold mb-2">{t('knowledge.no_topics')}</h3>
                            <p className="text-muted-foreground mb-4">{t('knowledge.adjust_filters')}</p>
                            {hasActiveFilters && (
                                <Button variant="outline" onClick={clearAllFilters}>
                                    {t('common.clearAll')}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {topics.map((topic) => (
                                <Link
                                    key={topic.id}
                                    to={`/knowledge/${topic.slug}`}
                                    className="group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg hover:border-primary/40 transition-all duration-300 flex flex-col h-full"
                                >
                                    <div className="p-6 flex flex-col h-full">
                                        {/* Header Badges */}
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex gap-2">
                                                {topic.visibility === 'members' && (
                                                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30">
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
                                            </div>
                                            <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                                                <Globe className="h-3 w-3 mr-1" />
                                                {topic.source_locale.toUpperCase()}
                                            </Badge>
                                        </div>

                                        {/* Title & Summary */}
                                        <h3 className="font-serif text-xl font-bold text-foreground mb-3 group-hover:text-primary transition-colors">
                                            {topic.title}
                                        </h3>

                                        {topic.summary && (
                                            <p className="text-muted-foreground text-sm line-clamp-3 mb-6 flex-1">
                                                {topic.summary}
                                            </p>
                                        )}

                                        {/* Footer Stats */}
                                        <div className="pt-4 mt-auto border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1">
                                                <MessageSquare className="h-3 w-3" />
                                                <span>{topic.post_count} {t('knowledge.posts')}</span>
                                            </div>

                                            <div className="flex items-center gap-1 text-primary font-medium group-hover:underline">
                                                <Eye className="h-3 w-3" />
                                                {t('common.view')}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            <Footer />
        </div>
    );
}

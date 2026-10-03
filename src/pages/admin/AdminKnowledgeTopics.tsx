import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useKnowledgeTopics } from "@/hooks/useKnowledgeBase";
import { Loader2, Plus, MoreHorizontal, AlertCircle, Search, Edit, Trash2, Eye } from "lucide-react";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { KnowledgeTopicForm } from "@/components/admin/knowledge/KnowledgeTopicForm";
import { useDeleteKnowledgeTopic } from "@/hooks/useKnowledgeBase";
import { safeError } from "@/lib/security/safeLogger";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { useKnowledgeTopic } from "@/hooks/useKnowledgeBase";

import { KnowledgeTopic } from "@/lib/schemas/knowledgeBaseSchemas";

export default function AdminKnowledgeTopics() {
    const { t, i18n } = useTranslation();
    const [search, setSearch] = useState("");
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingTopic, setEditingTopic] = useState<KnowledgeTopic | null>(null);
    const [deletingTopic, setDeletingTopic] = useState<KnowledgeTopic | null>(null);

    const { data: topics, isLoading, error, refetch } = useKnowledgeTopics({
        locale: getTranslationLocale(i18n.language),
        search: search || undefined,
        limit: 20,
    });
    // ... (rest of component is fine, just updated state types)

    const deleteMutation = useDeleteKnowledgeTopic();

    const handleDelete = async () => {
        if (!deletingTopic) return;
        try {
            await deleteMutation.mutateAsync({ topic_id: deletingTopic.id });
            setDeletingTopic(null);
            refetch();
        } catch (error) {
            safeError("AdminKnowledgeTopics.delete", error);
        }
    };

    return (
        <>
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-serif font-bold text-foreground">{t("adminKnowledge.title")}</h1>
                        <p className="text-muted-foreground mt-1">{t("adminKnowledge.subtitle")}</p>
                    </div>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="mr-2 h-4 w-4" />
                                {t("adminKnowledge.newTopic")}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>{t("adminKnowledge.createTitle")}</DialogTitle>
                                <DialogDescription>
                                    {t("adminKnowledge.createDescription")}
                                </DialogDescription>
                            </DialogHeader>
                            <KnowledgeTopicForm
                                mode="create"
                                onSuccess={() => { setIsCreateOpen(false); refetch(); }}
                                onCancel={() => setIsCreateOpen(false)}
                            />
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="relative w-full max-w-sm mb-4">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t("adminKnowledge.searchPlaceholder")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                    />
                </div>

                {isLoading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : error ? (
                    <div className="p-8 text-center text-destructive">
                        <AlertCircle className="mx-auto h-8 w-8 mb-2" />
                        {t("adminKnowledge.loadError")}
                    </div>
                ) : (
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("adminKnowledge.columnTitle")}</TableHead>
                                    <TableHead>{t("adminKnowledge.columnSlug")}</TableHead>
                                    <TableHead>{t("adminKnowledge.columnVisibility")}</TableHead>
                                    <TableHead>{t("adminKnowledge.columnUpdated")}</TableHead>
                                    <TableHead className="text-right">{t("adminKnowledge.columnActions")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topics?.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                            {t("adminKnowledge.noTopics")}
                                        </TableCell>
                                    </TableRow>
                                )}
                                {topics?.map((topic) => (
                                    <TableRow key={topic.id}>
                                        <TableCell className="font-medium">{topic.title}</TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{topic.slug}</TableCell>
                                        <TableCell>
                                            <Badge variant={topic.visibility === 'public' ? 'default' : topic.visibility === 'members' ? 'secondary' : 'outline'}>
                                                {topic.visibility}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {new Date(topic.updated_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">{t("adminKnowledge.openMenu")}</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuLabel>{t("adminKnowledge.actions")}</DropdownMenuLabel>
                                                    <DropdownMenuItem asChild>
                                                        <Link to={`/knowledge/${topic.slug}`} target="_blank">
                                                            <Eye className="mr-2 h-4 w-4" /> {t("adminKnowledge.viewLive")}
                                                        </Link>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => setEditingTopic(topic)}>
                                                        <Edit className="mr-2 h-4 w-4" /> {t("adminKnowledge.edit")}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => setDeletingTopic(topic)}
                                                        className="text-destructive focus:text-destructive"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" /> {t("adminKnowledge.delete")}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Edit Dialog */}
                <Dialog open={!!editingTopic} onOpenChange={(open) => !open && setEditingTopic(null)}>
                    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>{t("adminKnowledge.editTitle")}</DialogTitle>
                        </DialogHeader>
                        {editingTopic && (
                            <EditWrapper
                                topic={editingTopic}
                                onSuccess={() => { setEditingTopic(null); refetch(); }}
                                onCancel={() => setEditingTopic(null)}
                            />
                        )}
                    </DialogContent>
                </Dialog>

                {/* Delete Alert */}
                <AlertDialog open={!!deletingTopic} onOpenChange={(open) => !open && setDeletingTopic(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t("adminKnowledge.deleteConfirmTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {t("adminKnowledge.deleteConfirmDescription", { name: deletingTopic?.title })}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t("adminKnowledge.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                {t("adminKnowledge.archiveTopic")}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </>
    );
}

function EditWrapper({ topic, onSuccess, onCancel }: { topic: KnowledgeTopic, onSuccess: () => void, onCancel: () => void }) {
    const { t, i18n } = useTranslation();
    const { data: detail, isLoading } = useKnowledgeTopic(topic.slug, getTranslationLocale(i18n.language));

    if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    if (!detail) return <div className="text-destructive">{t("adminKnowledge.loadDetailError")}</div>;

    const initialData = {
        id: detail.id,
        slug: detail.slug,
        title_key: "", // Can't recover easily 
        summary_key: "",
        visibility: detail.visibility as 'public' | 'members' | 'archived', // cast safely
        locale: getTranslationLocale(i18n.language),
        title: detail.title,
        summary: detail.summary || "",
        body: detail.body_markdown || "",
    };

    return <KnowledgeTopicForm mode="edit" initialData={initialData} onSuccess={onSuccess} onCancel={onCancel} />;
}

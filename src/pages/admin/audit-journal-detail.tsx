import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    AlertCircle, AlertTriangle, Activity, Bell, Bug, Building, Calendar,
    CheckCircle2, Coins, Database, FileText, HelpCircle, Info, Link2,
    Loader2, MessageCircle, Shield, ShieldOff, ShoppingCart, Users
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { aisha } from "@/integrations/db/client";
import { AuditJournalEntry, JournalArea, JournalSeverity } from "@/hooks/useAuditJournal";

// Helper to type the metadata safely
export interface AuditMetadata {
    summary?: string;
    blockchain_hash?: string;
    blockchain_tx_hash?: string;
    blockchain_status?: string;
    details?: Record<string, unknown>;
    old_values?: Record<string, unknown>;
    new_values?: Record<string, unknown>;
    tags?: string[];
    [key: string]: unknown;
}

const AREA_ICONS: Partial<Record<JournalArea, React.ReactNode>> = {
    admin: <Shield className="h-4 w-4" />,
    appointments: <Calendar className="h-4 w-4" />,
    auth: <Shield className="h-4 w-4" />,
    blockchain: <Link2 className="h-4 w-4" />,
    chat: <MessageCircle className="h-4 w-4" />,
    operational_data: <Activity className="h-4 w-4" />,
    consents: <Shield className="h-4 w-4" />,
    content: <FileText className="h-4 w-4" />,
    documents: <FileText className="h-4 w-4" />,
    registrations: <FileText className="h-4 w-4" />,
    integration: <Link2 className="h-4 w-4" />,
    logistics: <ShoppingCart className="h-4 w-4" />,
    members: <Users className="h-4 w-4" />,
    memberships: <Users className="h-4 w-4" />,
    notifications: <Bell className="h-4 w-4" />,
    orders: <ShoppingCart className="h-4 w-4" />,
    partner_matching: <Users className="h-4 w-4" />,
    partners: <Building className="h-4 w-4" />,
    production: <Activity className="h-4 w-4" />,
    products: <Database className="h-4 w-4" />,
    profile: <Users className="h-4 w-4" />,
    research: <FileText className="h-4 w-4" />,
    studies: <FileText className="h-4 w-4" />,
    subscriptions: <Coins className="h-4 w-4" />,
    system: <Database className="h-4 w-4" />,
    tokens: <Coins className="h-4 w-4" />,
    users: <Users className="h-4 w-4" />,
};

/**
 * Chain-of-custody verification state for an entry's integrity hash.
 * Recomputed server-side by fn_verify_audit_journal_entry from the STORED row
 * columns — a bare hash string proves nothing; only verified/broken/
 * unverifiable_legacy is honest information.
 */
type ChainVerificationState = "verified" | "broken" | "unverifiable_legacy" | "no_hash";

function ChainVerificationBadge({ entryId }: { entryId: string }) {
    const { t } = useTranslation();
    const { data, isLoading, isError } = useQuery({
        queryKey: ["audit-journal-verify", entryId] as const,
        queryFn: async () => {
            const { data, error } = await aisha.rpc("fn_verify_audit_journal_entry", {
                p_entry_id: entryId,
            });
            if (error) throw error;
            return data as { state?: ChainVerificationState };
        },
        staleTime: 60_000,
    });

    if (isLoading) {
        return (
            <Badge className="bg-muted text-muted-foreground">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {t("admin.auditJournal.detail.chainChecking")}
            </Badge>
        );
    }
    if (isError || !data?.state) {
        return (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {t("admin.auditJournal.detail.chainError")}
            </Badge>
        );
    }
    switch (data.state) {
        case "verified":
            return (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {t("admin.auditJournal.detail.chainVerified")}
                </Badge>
            );
        case "broken":
            return (
                <Badge className="bg-red-600 text-white">
                    <ShieldOff className="h-3 w-3 mr-1" />
                    {t("admin.auditJournal.detail.chainBroken")}
                </Badge>
            );
        case "unverifiable_legacy":
            return (
                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    <HelpCircle className="h-3 w-3 mr-1" />
                    {t("admin.auditJournal.detail.chainLegacy")}
                </Badge>
            );
        default:
            return (
                <Badge className="bg-muted text-muted-foreground">
                    {t("admin.auditJournal.detail.chainNoHash")}
                </Badge>
            );
    }
}

const SEVERITY_CONFIG: Record<JournalSeverity, { color: string; icon: React.ReactNode }> = {
    debug: { color: "bg-muted text-muted-foreground", icon: <Bug className="h-3 w-3" /> },
    info: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <Info className="h-3 w-3" /> },
    notice: { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <Bell className="h-3 w-3" /> },
    warning: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: <AlertTriangle className="h-3 w-3" /> },
    error: { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="h-3 w-3" /> },
    critical: { color: "bg-red-600 text-white", icon: <AlertCircle className="h-3 w-3" /> },
};

export function JournalEntryDetail({ entry }: { entry: AuditJournalEntry }) {
    const { t } = useTranslation();
    // Use 'details' field which contains metadata - types.ts defines this
    const metadata: AuditMetadata = typeof entry.details === 'object' && entry.details !== null
        ? (entry.details as AuditMetadata)
        : {};

    const areaIcon = AREA_ICONS[entry.area as JournalArea] ?? <Database className="h-4 w-4" />;
    const severityConfig = SEVERITY_CONFIG[entry.severity as JournalSeverity] ?? SEVERITY_CONFIG.info;
    // Use action_type as defined in types.ts
    const actionType = entry.action_type;

    return (
        <ScrollArea className="h-[500px]">
            <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.time")}</p>
                        <p>{format(new Date(entry.created_at), "dd.MM.yyyy HH:mm:ss")}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.area")}</p>
                        <div className="flex items-center gap-2">
                            {areaIcon}
                            <span>{t(`admin.auditJournal.areas.${entry.area}`)}</span>
                        </div>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.user")}</p>
                        <p>{entry.user_email || t("admin.auditJournal.detail.system")}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.role")}</p>
                        <p>-</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.action")}</p>
                        <p>
                            {t(`admin.auditJournal.actions.${actionType}`)}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.severity")}</p>
                        <Badge className={severityConfig.color}>
                            {t(`admin.auditJournal.severities.${entry.severity}`)}
                        </Badge>
                    </div>
                    <div className="col-span-2">
                        <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.entity")}</p>
                        <p>{entry.entity_type} {entry.entity_id ? `(${entry.entity_id.slice(0, 8)}...)` : ''}</p>
                    </div>
                </div>

                {metadata.summary && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.summary")}</p>
                        <p className="text-sm">{metadata.summary}</p>
                    </div>
                )}

                {(entry.blockchain_hash || metadata.blockchain_hash) && (
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-muted-foreground">{t("admin.auditJournal.detail.blockchainHash")}</p>
                            <ChainVerificationBadge entryId={entry.id} />
                        </div>
                        <code className="text-xs bg-muted p-2 rounded block break-all">{entry.blockchain_hash ?? metadata.blockchain_hash}</code>
                    </div>
                )}

                {metadata.blockchain_tx_hash && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.blockchainTx")}</p>
                        <code className="text-xs bg-muted p-2 rounded block break-all">{metadata.blockchain_tx_hash}</code>
                    </div>
                )}

                {metadata.details && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.details")}</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(metadata.details, null, 2)}
                        </pre>
                    </div>
                )}

                {metadata.old_values && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.oldValues")}</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(metadata.old_values, null, 2)}
                        </pre>
                    </div>
                )}

                {metadata.new_values && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.newValues")}</p>
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(metadata.new_values, null, 2)}
                        </pre>
                    </div>
                )}

                {metadata.tags && metadata.tags.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">{t("admin.auditJournal.detail.tags")}</p>
                        <div className="flex flex-wrap gap-1">
                            {metadata.tags.map((tag) => (
                                <Badge key={tag} variant="outline">{tag}</Badge>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}

import { ColumnDef, Row } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { MoreHorizontal, Users, Copy, Mail } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Invitation } from "@/hooks/useInvitations";

// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const ActionsCell = ({ row, copyLink, sendEmail }: { row: Row<Invitation>; copyLink: (code: string) => void; sendEmail: (invite: Invitation) => void }) => {
    const { t } = useTranslation();
    const invite = row.original;

    return (
        <div className="flex items-center gap-2">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyLink(invite.code)}>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("common.copyLink")}</TooltipContent>
                </Tooltip>
            </TooltipProvider>

            {invite.email && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => sendEmail(invite)}>
                                <Mail className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("invitations.send_email")}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">{t("common.openMenu")}</span>
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t("common.actions")}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => navigator.clipboard.writeText(invite.id)}>
                        {t("common.copyId")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => copyLink(invite.code)}>
                        {t("common.copyLink")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

const UsageCell = ({ row }: { row: Row<Invitation> }) => {
    const invite = row.original;
    const isUsed = invite.used_count > 0;

    return (
        <Badge variant={isUsed ? "default" : "secondary"}>
            {invite.used_count} / {invite.max_uses ?? "∞"}
        </Badge>
    );
};

const ClaimsCell = ({ row }: { row: Row<Invitation> }) => {
    const { t } = useTranslation();
    const invite = row.original;

    if (!invite.claims || invite.claims.length === 0) {
        return <span className="text-muted-foreground text-sm">—</span>;
    }

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 h-8">
                    <Users className="h-4 w-4" />
                    <span>{invite.claims.length}</span>
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t("invitations.claims_for")} {invite.code}
                    </DialogTitle>
                    <DialogDescription>{t("invitations.claimed_by")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                    {invite.claims.map((claim, idx) => (
                        <div key={idx} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                            <div>
                                <p className="font-medium">{claim.user_name || t("invitations.unnamed_user")}</p>
                                <p className="text-sm text-muted-foreground">{claim.user_id.slice(0, 8)}</p>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {new Date(claim.claimed_at).toLocaleDateString("cs-CZ")}
                            </p>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
};

const StatusCell = ({ row, onToggle }: { row: Row<Invitation>; onToggle: (id: string, active: boolean) => void }) => {
    const invite = row.original;
    return (
        <Switch
            checked={invite.is_active}
            onCheckedChange={(checked) => onToggle(invite.id, checked)}
        />
    );
};

// ============================================
// COLUMN DEFINITIONS
// ============================================

export const useInvitationColumns = (
    copyLink: (code: string) => void,
    sendEmail: (invite: Invitation) => void,
    toggleInvitation: (id: string, active: boolean) => void
): ColumnDef<Invitation>[] => {

    const { t } = useTranslation();

    return [
        {
            accessorKey: "code",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.code")} />
            ),
            cell: ({ row }) => <span className="font-mono font-bold">{row.getValue("code")}</span>,
            enableSorting: true,
            enableHiding: false,
        },
        {
            accessorKey: "study.name", // Accessing nested property for sorting might require custom accessorFn
            id: "study_name",
            accessorFn: (row) => row.study?.name || t("common.none"),
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.study")} />
            ),
            cell: ({ row }) => {
                const studyName = row.original.study?.name;
                return studyName ? (
                    <Badge variant="outline">{studyName}</Badge>
                ) : (
                    <span className="text-muted-foreground text-sm">{t("common.none")}</span>
                );
            },
        },
        {
            accessorKey: "role",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.role")} />
            ),
            cell: ({ row }) => {
                const role = row.getValue("role") as string | null;
                return role ? t(`admin.roles.roleTypes.${role}`) : t("common.none");
            },
        },
        {
            id: "usage",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.usage")} />
            ),
            cell: ({ row }) => <UsageCell row={row} />,
        },
        {
            id: "claims",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.claimed_by")} />
            ),
            cell: ({ row }) => <ClaimsCell row={row} />,
        },
        {
            accessorKey: "is_active",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("invitations.status")} />
            ),
            cell: ({ row }) => <StatusCell row={row} onToggle={toggleInvitation} />,
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <ActionsCell
                    row={row}
                    copyLink={copyLink}
                    sendEmail={sendEmail}
                />
            ),
        },
    ];
};

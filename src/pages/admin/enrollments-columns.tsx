import { ColumnDef, Row } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Eye, User, FileText } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { RegistrationWithDetails } from "@/hooks/useAdminData";
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";


// ============================================
// CUSTOM CELL RENDERERS
// ============================================

const ParticipantCell = ({ row }: { row: Row<RegistrationWithDetails> }) => {
    const { t } = useTranslation();
    const registration = row.original;

    return (
        <div>
            <p className="font-medium">
                {registration.profile?.display_name || t("admin.registrations.unnamed")}
            </p>
            <p className="text-sm text-muted-foreground">
                {registration.profile?.email}
            </p>
            {registration.profile?.primary_diagnosis && (
                <Badge variant="outline" className="mt-1 text-xs">
                    {registration.profile.primary_diagnosis}
                </Badge>
            )}
        </div>
    );
};

const StudyCell = ({ row }: { row: Row<RegistrationWithDetails> }) => {
    const { t } = useTranslation();
    const registration = row.original;

    return (
        <div>
            <p className="font-medium">{registration.study?.name || t("admin.registrations.unknown")}</p>
            <p className="text-sm text-muted-foreground">{registration.study?.code}</p>
        </div>
    );
};

const StatusCell = ({ row }: { row: Row<RegistrationWithDetails> }) => {
    const { t } = useTranslation();
    const registration = row.original;

    return (
        <Badge
            variant={
                registration.status === "active" || registration.status === "enrolled"
                    ? "default"
                    : registration.status === "completed"
                        ? "secondary"
                        : registration.status === "withdrawn"
                            ? "destructive"
                            : "outline"
            }
        >
            {t(`admin.registrations.statuses.${registration.status}`)}
        </Badge>
    );
};

const ActionsCell = ({
    row,
    onStatusChange,
    onApprove,
    onReject,
    updatingId
}: {
    row: Row<RegistrationWithDetails>;
    onStatusChange: (id: string, status: RegistrationWithDetails["status"]) => Promise<void>;
    onApprove: (id: string) => Promise<void>;
    onReject: (id: string) => Promise<void>;
    updatingId: string | null;
}) => {
    const { t } = useTranslation();
    const registration = row.original;
    const isUpdating = updatingId === registration.id;

    // Status options local definition to avoid circular dependency or prop drilling large objects
    const statusOptions: RegistrationWithDetails["status"][] = [
        "screening",
        "enrolled",
        "active",
        "completed",
        "withdrawn",
    ];

    return (
        <div className="flex items-center gap-2">
            {/* View profile dialog */}
            <Dialog>
                <DialogTrigger asChild>
                    <Button
                        size="sm"
                        variant="ghost"
                    >
                        <Eye className="w-4 h-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <User className="w-5 h-5" />
                            {t("admin.registrations.participantProfile")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("admin.registrations.profileDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.name")}</p>
                                <p className="font-medium">{registration.profile?.display_name || "-"}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.email")}</p>
                                <p className="font-medium">{registration.profile?.email || "-"}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.phone")}</p>
                                <p className="font-medium">{registration.profile?.phone || "-"}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.dateOfBirth")}</p>
                                <p className="font-medium">
                                    {registration.profile?.date_of_birth
                                        ? format(new Date(registration.profile.date_of_birth), "dd.MM.yyyy")
                                        : "-"}
                                </p>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.diagnosis")}</p>
                            <p className="font-medium">{registration.profile?.primary_diagnosis || "-"}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.medications")}</p>
                            <p className="font-medium">{registration.profile?.current_medications || "-"}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t("admin.registrations.profile.medicalHistory")}</p>
                            <p className="font-medium text-sm">{registration.profile?.medical_history || "-"}</p>
                        </div>
                        <div className="border-t pt-4">
                            <p className="text-sm text-muted-foreground mb-2">{t("admin.registrations.profile.study")}</p>
                            <div className="flex items-center gap-2">
                                <Badge>{registration.study?.code}</Badge>
                                <span className="font-medium">{registration.study?.name}</span>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* View questionnaire responses */}
            <Button
                size="sm"
                variant="ghost"
                asChild
                title={t("admin.registrationDetail.questionnaireResponses")}
            >
                <Link to={`/admin/registrations/${registration.id}`}>
                    <FileText className="w-4 h-4" />
                </Link>
            </Button>

            {/* Approval buttons for screening status */}
            {registration.status === "screening" && (
                <>
                    <Button
                        size="sm"
                        variant="default"
                        onClick={() => onApprove(registration.id)}
                        disabled={isUpdating}
                    >
                        <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onReject(registration.id)}
                        disabled={isUpdating}
                    >
                        <XCircle className="w-4 h-4" />
                    </Button>
                </>
            )}

            {/* Status dropdown for non-screening */}
            {registration.status !== "screening" && (
                <Select
                    value={registration.status}
                    onValueChange={(value) =>
                        onStatusChange(registration.id, value as RegistrationWithDetails["status"])
                    }
                    disabled={isUpdating}
                >
                    <SelectTrigger className="w-28 h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                                {t(`admin.registrations.statuses.${status}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </div>
    );
};

// ============================================
// COLUMN DEFINITIONS
// ============================================

export const useRegistrationColumns = (
    onStatusChange: (id: string, status: RegistrationWithDetails["status"]) => Promise<void>,
    onApprove: (id: string) => Promise<void>,
    onReject: (id: string) => Promise<void>,
    updatingId: string | null
): ColumnDef<RegistrationWithDetails>[] => {
     
    const { t } = useTranslation();

    return [
        {
            accessorKey: "profile.display_name", // For sorting by name
            id: "participant",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.registrations.table.participant")} />
            ),
            cell: ({ row }) => <ParticipantCell row={row} />,
            enableSorting: true,
        },
        {
            accessorKey: "study.name", // For sorting by study name
            id: "study",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.registrations.table.study")} />
            ),
            cell: ({ row }) => <StudyCell row={row} />,
            enableSorting: true,
        },
        {
            accessorKey: "status",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.registrations.table.status")} />
            ),
            cell: ({ row }) => <StatusCell row={row} />,
            filterFn: (row, id, value) => {
                return value.includes(row.getValue(id));
            },
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.registrations.table.applied")} />
            ),
            cell: ({ row }) => (
                <span className="text-muted-foreground text-sm">
                    {format(new Date(row.getValue("created_at")), "dd.MM.yyyy")}
                </span>
            ),
        },
        {
            id: "actions",
            header: t("admin.registrations.table.actions"),
            cell: ({ row }) => (
                <ActionsCell
                    row={row}
                    onStatusChange={onStatusChange}
                    onApprove={onApprove}
                    onReject={onReject}
                    updatingId={updatingId}
                />
            ),
        },
    ];
};

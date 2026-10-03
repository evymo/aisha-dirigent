import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TFunction } from "i18next";
import { format } from "date-fns";
import { TestQuestion } from "@/hooks/useTestQuestions";
import { TestResultRow } from "@/lib/schemas/adminSchemas";

export const getQuestionColumns = (
    t: TFunction,
    _isCs: boolean,
    onEdit: (question: TestQuestion) => void,
    onDelete: (id: string) => void,
    onToggleActive: (question: TestQuestion) => void
): ColumnDef<TestQuestion>[] => [
        {
            accessorKey: "question_order",
            header: t("admin.testQuestions.table.numberHeader"),
            cell: ({ row }) => <div className="text-center">{row.getValue("question_order")}</div>,
            size: 60,
        },
        {
            id: "question",
            header: t("admin.testQuestions.question"),
            cell: ({ row }) => {
                const q = row.original;
                return (
                    <div className="max-w-lg">
                        <p className="font-medium text-sm">
                            {q.question || q.question_key}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground mb-2">
                            {q.question_key}
                        </p>

                        <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                            <p>
                                <span className="font-semibold">{t("admin.testQuestions.optionA")}:</span> {q.option_a || t(q.option_a_key)}
                            </p>
                            <p>
                                <span className="font-semibold">{t("admin.testQuestions.optionB")}:</span> {q.option_b || t(q.option_b_key)}
                            </p>
                            <p>
                                <span className="font-semibold">{t("admin.testQuestions.optionC")}:</span> {q.option_c || t(q.option_c_key)}
                            </p>
                            {q.option_d_key && (
                                <p>
                                    <span className="font-semibold">{t("admin.testQuestions.optionD")}:</span> {q.option_d || t(q.option_d_key)}
                                </p>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: "correct_answer",
            header: t("admin.testQuestions.answer"),
            cell: ({ row }) => (
                <Badge variant="outline" className="uppercase">
                    {row.getValue("correct_answer")}
                </Badge>
            ),
            size: 80,
        },
        {
            accessorKey: "is_active",
            header: t("admin.testQuestions.active"),
            cell: ({ row }) => (
                <Switch
                    checked={row.getValue("is_active")}
                    onCheckedChange={() => onToggleActive(row.original)}
                />
            ),
            size: 100,
        },
        {
            id: "actions",
            header: t("common.actions"),
            cell: ({ row }) => (
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(row.original)}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(row.original.id)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ),
            size: 100,
        },
    ];

export const getResultColumns = (t: TFunction): ColumnDef<TestResultRow>[] => [
    {
        id: "user",
        header: t("admin.testQuestions.user"),
        cell: ({ row }) => (
            <div>
                <div className="font-medium">{row.original.profiles?.display_name || "-"}</div>
                <div className="text-sm text-muted-foreground">{row.original.profiles?.email}</div>
            </div>
        ),
    },
    {
        accessorKey: "score",
        header: t("admin.testQuestions.score"),
        cell: ({ row }) => (
            <Badge variant={row.original.passed ? "default" : "secondary"}>
                {row.getValue("score")}%
            </Badge>
        ),
    },
    {
        accessorKey: "passed",
        header: t("admin.testQuestions.status"),
        cell: ({ row }) => {
            const passed = row.original.passed;
            if (passed) {
                return (
                    <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle className="h-4 w-4" />
                        {t("admin.testQuestions.passed")}
                    </span>
                );
            }
            return (
                <span className="flex items-center gap-1 text-red-600">
                    <XCircle className="h-4 w-4" />
                    {t("admin.testQuestions.failed")}
                </span>
            );
        },
    },
    {
        id: "date",
        header: t("admin.testQuestions.date"),
        accessorFn: (row) => row.completed_at || row.created_at,
        cell: ({ row }) => {
            const date = row.original.completed_at || row.original.created_at;
            return format(new Date(date || new Date()), "dd.MM.yyyy HH:mm");
        },
    },
];

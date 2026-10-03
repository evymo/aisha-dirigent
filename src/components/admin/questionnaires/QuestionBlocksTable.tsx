import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, ClipboardList } from "lucide-react";
import type { QuestionBlock } from "./types";

interface QuestionBlocksTableProps {
  questionBlocks: QuestionBlock[] | undefined;
  onAdd: () => void;
  onEdit: (block: QuestionBlock) => void;
  onDelete: (id: string) => void;
}

export function QuestionBlocksTable({
  questionBlocks,
  onAdd,
  onEdit,
  onDelete,
}: QuestionBlocksTableProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          {t("admin.questionnaires.blocks.title")} ({questionBlocks?.length || 0})
        </CardTitle>
        <CardDescription>{t("admin.questionnaires.blocks.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-end mb-4">
          <Button onClick={onAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {t("admin.questionnaires.blocks.add")}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.questionnaires.blocks.table.code")}</TableHead>
              <TableHead>{t("admin.questionnaires.blocks.table.type")}</TableHead>
              <TableHead>{t("admin.questionnaires.blocks.table.required")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.status")}</TableHead>
              <TableHead className="text-right">{t("admin.questionnaires.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questionBlocks?.map((block) => (
              <TableRow key={block.id}>
                <TableCell className="font-medium">{block.code}</TableCell>
                <TableCell>{t(`admin.questionnaires.types.${block.question_type}`)}</TableCell>
                <TableCell>
                  <Badge variant={block.is_required_default ? "default" : "secondary"}>
                    {block.is_required_default ? t("common.required") : t("common.optional")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={block.is_active ? "default" : "secondary"}>
                    {block.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(block)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(block.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {questionBlocks?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t("admin.questionnaires.blocks.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
